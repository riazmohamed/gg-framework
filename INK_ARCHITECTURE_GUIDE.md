# Ink + React Architecture Guide for GG Framework

**Deep-dive into how Ink 6 and React 19 work together in the ogcoder CLI, with practical examples.**

---

## Table of Contents

1. [What is Ink?](#what-is-ink)
2. [React in Terminal vs Browser](#react-in-terminal-vs-browser)
3. [Ink Rendering Model](#ink-rendering-model)
4. [Component Architecture](#component-architecture)
5. [State Management](#state-management)
6. [Hooks System](#hooks-system)
7. [Input Handling](#input-handling)
8. [Streaming & Live Updates](#streaming--live-updates)
9. [Layout & Flexbox](#layout--flexbox)
10. [Colors & Styling](#colors--styling)
11. [Performance Considerations](#performance-considerations)
12. [Testing Ink Components](#testing-ink-components)

---

## What is Ink?

**Ink** is a React renderer for the terminal. Instead of rendering to DOM in a browser, it renders to ANSI escape sequences that draw in the terminal.

```
React Component Tree
        ↓
React Reconciliation
        ↓
Ink Renderer (virtual terminal)
        ↓
ANSI Escape Sequences
        ↓
Terminal Output
```

### Key Differences from Web React

| Aspect | Web React | Ink |
|--------|-----------|-----|
| **Target** | Browser DOM | Terminal output |
| **Layout** | CSS flexbox (2D) | Yoga flexbox (2D) |
| **Components** | `<div>`, `<button>`, etc. | `<Box>`, `<Text>`, custom components |
| **Styling** | CSS classes/inline | Props (`borderStyle`, `color`, `width`) |
| **Events** | Mouse, keyboard, touch | Keyboard + Readline streams only |
| **Rendering** | Continuous 60fps | On-demand (event-driven) |
| **Text** | HTML text nodes | `<Text>` components |

---

## React in Terminal vs Browser

### Browser React Example
```tsx
import React from "react";

export const WebApp = () => {
  const [count, setCount] = React.useState(0);
  
  return (
    <div className="app">
      <h1>Counter: {count}</h1>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
};
```

**Rendering**: Rendered to DOM, browser shows HTML.

---

### Ink Terminal Example
```tsx
import React from "react";
import { Box, Text } from "ink";

export const TerminalApp = () => {
  const [count, setCount] = React.useState(0);
  
  return (
    <Box flexDirection="column">
      <Text>Counter: {count}</Text>
      <Text>
        Press 'i' to increment (you handle this via useInput hook)
      </Text>
    </Box>
  );
};
```

**Rendering**: Rendered to terminal via ANSI sequences.

---

## Ink Rendering Model

### How Rendering Works

1. **Initial Render**: Component tree rendered to virtual terminal
2. **ANSI Output**: Converted to escape sequences, drawn in terminal
3. **Event Loop**: Process keyboard/stream events
4. **Re-render**: Component re-renders, diff computed
5. **Terminal Update**: Only changed regions redrawn
6. **Loop**: Repeat until app exits

```
┌─────────────────────────────────┐
│  React Component Render         │
│  (produces virtual terminal)    │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│  Diff Detection                 │
│  (what changed?)                │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│  ANSI String Generation         │
│  (position, colors, text)       │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│  Write to stdout                │
│  (process.stdout.write)         │
└──────────────┬──────────────────┘
               ↓
         Terminal Display
               ↑
┌──────────────┴──────────────────┐
│  Listen for Events              │
│  (stdin keyboard, streams)      │
└─────────────────────────────────┘
```

### Important: Ink is NOT Continuous

Unlike web React which re-renders ~60fps:
- Ink re-renders **only when state changes**
- Keyboard input → state update → re-render
- Stream data arrives → state update → re-render
- No "idle" rendering

This is **crucial for CLI performance**.

---

## Component Architecture

### Built-in Ink Components

Ink provides primitive components you build on:

```tsx
import { Box, Text } from "ink";

// <Text> — render text with optional styling
<Text color="blue" bold>Hello</Text>

// <Box> — layout container (like <div> with flexbox)
<Box flexDirection="column" borderStyle="round">
  <Text>Item 1</Text>
  <Text>Item 2</Text>
</Box>
```

### OGCoder's Component Structure

```
ui/
├── App.tsx                    # Main app (1732 lines) — orchestrates everything
├── components/
│   ├── MessageHistory.tsx     # Scrollable message list
│   ├── LiveItems.tsx          # Current turn items (text, tools, results)
│   ├── TokenCounter.tsx       # Display token usage
│   ├── InputField.tsx         # User input with multi-line support
│   ├── ToolCall.tsx           # Display single tool call (name, args, status)
│   ├── ToolResult.tsx         # Display tool result (success/error)
│   ├── TextBlock.tsx          # Markdown text rendering with syntax highlighting
│   ├── Spinner.tsx            # Animated spinner during tool execution
│   └── ... (25+ more)
└── hooks/
    ├── useAgentLoop.ts        # Run agent, consume events
    ├── useSessionManager.ts   # Load/save sessions
    ├── useInput.tsx           # Keyboard input handling
    ├── useTokenCounter.ts     # Track token usage
    └── useTheme.ts            # Load dark/light theme
```

### App.tsx Structure

The main App.tsx is **monolithic** (1732 lines) because:
1. It orchestrates the entire app flow
2. All state lives here (messages, liveItems, currentInput, etc.)
3. Event handlers need access to all state

```tsx
export const App: React.FC<AppProps> = ({ session, auth, settings }) => {
  // ──── STATE ────
  const [messages, setMessages] = useState<Message[]>([]);
  const [liveItems, setLiveItems] = useState<LiveItem[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [tokenUsage, setTokenUsage] = useState<Usage>({ inputTokens: 0, outputTokens: 0 });
  const [isRunning, setIsRunning] = useState(false);

  // ──── HANDLERS ────
  const handleInputChange = (text: string) => { /* ... */ };
  const handleSubmit = (text: string) => { /* ... */ };
  const handleKeyDown = (ch: string, key: Key) => { /* ... */ };

  // ──── RENDER ────
  return (
    <Box flexDirection="column" height="100%">
      <TokenCounter usage={tokenUsage} />
      <MessageHistory messages={messages} />
      <LiveItemsSection items={liveItems} />
      <InputField value={currentInput} onChange={handleInputChange} />
    </Box>
  );
};
```

---

## State Management

### React Hooks for CLI State

Unlike web apps with Redux/Zustand, ogcoder uses **React hooks directly**:

```tsx
// ❌ DON'T use complex state libraries in CLI
// They add too much overhead for event-driven rendering

// ✅ DO use React hooks
const [messages, setMessages] = useState<Message[]>([]);
const [currentInput, setCurrentInput] = useState("");
const [isRunning, setIsRunning] = useState(false);
```

### State Update Pattern

```tsx
// When user submits input
const handleSubmit = async (text: string) => {
  // 1. Add user message to history
  setMessages(prev => [...prev, { role: "user", content: text }]);
  
  // 2. Clear input
  setCurrentInput("");
  
  // 3. Set running flag
  setIsRunning(true);
  
  // 4. Run agent (below)
  const agentStream = agent.run(messages);
  
  for await (const event of agentStream) {
    if (event.type === "text_delta") {
      // 5. Update live items as text arrives
      setLiveItems(prev => [...prev, {
        kind: "text_delta",
        text: event.text,
      }]);
    }
    
    if (event.type === "tool_call_start") {
      // 6. Show tool call in progress
      setLiveItems(prev => [...prev, {
        kind: "tool_call",
        name: event.name,
        args: event.args,
        status: "running",
      }]);
    }
    
    if (event.type === "tool_call_end") {
      // 7. Update tool status to complete
      setLiveItems(prev => prev.map(item =>
        item.id === event.toolCallId
          ? { ...item, status: "done", result: event.result }
          : item
      ));
    }
    
    if (event.type === "turn_end") {
      // 8. Add complete assistant message
      setMessages(prev => [...prev, {
        role: "assistant",
        content: agentStream.finalMessage,
      }]);
      
      // 9. Clear live items and reset running
      setLiveItems([]);
      setIsRunning(false);
    }
  }
};
```

### Why Hooks Work Well for CLI

1. **Simple mental model**: State → component tree
2. **No subscription library**: One source of truth
3. **Direct control**: No middleware or interceptors
4. **Fast**: Hooks are lightweight
5. **Testable**: Easy to mock useState

---

## Hooks System

### Built-in Ink Hooks

#### 1. `useInput` — Keyboard Input

```tsx
import { useInput } from "ink";

const MyComponent = () => {
  useInput((input, key) => {
    // input: single character ('a', 'b', etc.)
    // key: { upArrow, downArrow, return, ctrl, etc. }
    
    if (input === "q") {
      process.exit(0);  // Exit on 'q'
    }
    
    if (key.return) {
      // Handle Enter key
    }
    
    if (key.ctrl && input === "c") {
      // Handle Ctrl+C
      process.exit(0);
    }
  });
  
  return <Text>Press 'q' to quit</Text>;
};
```

#### 2. `useStdin` — Read from stdin

```tsx
import { useStdin } from "ink";

const MyComponent = () => {
  const { stdin, isRawMode } = useStdin();
  
  // stdin is the Node.js stdin stream
  // isRawMode indicates if terminal is in raw mode
  
  React.useEffect(() => {
    if (!stdin || !isRawMode) return;
    
    // Listen to data events
    stdin.on("data", (chunk) => {
      console.log("Raw input:", chunk);
    });
  }, [stdin, isRawMode]);
  
  return <Text>Listening to stdin</Text>;
};
```

#### 3. `useStdout` — Write to stdout

```tsx
import { useStdout } from "ink";

const MyComponent = () => {
  const { stdout } = useStdout();
  
  React.useEffect(() => {
    // stdout is process.stdout
    stdout.write("Direct output\n");
  }, [stdout]);
  
  return <Text>Hello</Text>;
};
```

### Custom Hooks for OGCoder

#### `useAgentLoop` — Consume agent events

```tsx
// packages/ogcoder/src/ui/hooks/useAgentLoop.ts

export function useAgentLoop(options: AgentLoopOptions) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const agentStream = agent.run(options.messages);
        
        // Consume events as they arrive
        for await (const event of agentStream) {
          if (!isMounted) break;
          
          setEvents(prev => [...prev, event]);
          
          if (event.type === "agent_done") {
            const finalResult = await agentStream.response;
            if (isMounted) setResult(finalResult);
          }
        }
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [options.messages, options.signal]);

  return { events, result, error };
}
```

**Usage in App.tsx:**

```tsx
const handleSubmit = async (text: string) => {
  const { events, result, error } = useAgentLoop({
    messages: [...messages, { role: "user", content: text }],
    signal: abortController.signal,
  });

  for await (const event of events) {
    setLiveItems(prev => [...prev, mapEventToLiveItem(event)]);
  }

  if (result) {
    setMessages(prev => [...prev, result.message]);
  }
};
```

#### `useSessionManager` — CRUD sessions

```tsx
// packages/ogcoder/src/ui/hooks/useSessionManager.ts

export function useSessionManager(sessionManager: SessionManager) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [current, setCurrent] = useState<Session | null>(null);

  const loadSessions = useCallback(async () => {
    const list = await sessionManager.listSessions();
    setSessions(list);
  }, [sessionManager]);

  const createSession = useCallback(async (name?: string) => {
    const session = await sessionManager.createSession(name);
    setCurrent(session);
    setSessions(prev => [...prev, session]);
    return session;
  }, [sessionManager]);

  const saveMessages = useCallback(async (messages: Message[]) => {
    if (!current) return;
    await sessionManager.updateSession(current.id, messages);
  }, [current, sessionManager]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  return { sessions, current, createSession, saveMessages, loadSessions };
}
```

---

## Input Handling

### Multi-line Input in Terminal

Terminal input is challenging because:
- By default, terminal is in "cooked" mode (line-buffered)
- Ink puts terminal in "raw" mode (character-by-character)
- You must manually handle backspace, arrow keys, etc.

### InputField Component

```tsx
// packages/ogcoder/src/ui/components/InputField.tsx

interface InputFieldProps {
  value: string;
  onChange: (text: string) => void;
  onSubmit: (text: string) => void;
  multiline?: boolean;
}

export const InputField: React.FC<InputFieldProps> = ({
  value,
  onChange,
  onSubmit,
  multiline = false,
}) => {
  const { stdin } = useStdin();

  useInput((input, key) => {
    // Handle Shift+Enter for multiline
    if (input === "\n" && !multiline) {
      // Regular Enter
      onSubmit(value);
      onChange(""); // Clear
      return;
    }

    if (input === "\n" && multiline && key.shift) {
      // Shift+Enter adds newline
      onChange(value + "\n");
      return;
    }

    if (input === "\n" && multiline && !key.shift) {
      // Regular Enter submits
      onSubmit(value);
      onChange("");
      return;
    }

    if (key.backspace) {
      // Delete last character
      onChange(value.slice(0, -1));
      return;
    }

    if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) {
      // Terminal doesn't support text cursor positioning in Ink
      // You'd need to implement custom handling here
      return;
    }

    // Regular character
    onChange(value + input);
  });

  const prompt = multiline ? ">>>" : ">";

  return (
    <Box flexDirection="column">
      <Text>{prompt} {value}</Text>
      {multiline && <Text dimColor>Shift+Enter for newline</Text>}
    </Box>
  );
};
```

### Slash Command Detection

```tsx
// In App.tsx handleSubmit

const handleSubmit = (text: string) => {
  const trimmed = text.trim();

  // Check for slash commands first
  if (trimmed.startsWith("/")) {
    const [command, ...args] = trimmed.split(" ");
    
    if (command === "/model") {
      // /model anthropic claude-3-5-sonnet
      switchModel(args[0] as Provider, args[1]);
      setCurrentInput("");
      return;
    }
    
    if (command === "/quit" || command === "/q") {
      process.exit(0);
    }
    
    if (command === "/compact" || command === "/c") {
      compact();
      return;
    }
    
    // Unknown command
    setLiveItems(prev => [...prev, {
      kind: "error",
      text: `Unknown command: ${command}`,
    }]);
    setCurrentInput("");
    return;
  }

  // Not a command, send to agent
  handleAgentSubmit(text);
};
```

---

## Streaming & Live Updates

### Key Challenge: Agent Events Arrive Asynchronously

The agent loop yields events **as they arrive** (text deltas, tool calls, results).

You need to:
1. Display each event as it arrives (streaming UX)
2. NOT block the component render
3. Update live items in real-time

### Solution: State Queue Pattern

```tsx
// Instead of one liveItems array, use a queue

const [liveItems, setLiveItems] = useState<LiveItem[]>([]);

const addLiveItem = (item: LiveItem) => {
  setLiveItems(prev => [...prev, { ...item, id: generateId() }]);
};

const updateLiveItem = (id: string, updates: Partial<LiveItem>) => {
  setLiveItems(prev =>
    prev.map(item => item.id === id ? { ...item, ...updates } : item)
  );
};

const clearLiveItems = () => {
  setLiveItems([]);
};
```

### Processing Agent Events

```tsx
const processAgentEvent = (event: AgentEvent) => {
  switch (event.type) {
    case "text_delta":
      // Append text to current live item or create new one
      addLiveItem({
        kind: "text_delta",
        text: event.text,
      });
      break;

    case "tool_call_start":
      addLiveItem({
        kind: "tool_call",
        id: event.toolCallId,
        name: event.name,
        args: event.args,
        status: "running",
      });
      break;

    case "tool_call_end":
      updateLiveItem(event.toolCallId, {
        status: "done",
        result: event.result,
        isError: event.isError,
        durationMs: event.durationMs,
      });
      break;

    case "turn_end":
      // Add to permanent message history
      addMessage({
        role: "assistant",
        content: assembleContent(liveItems),
      });
      clearLiveItems();
      break;

    case "error":
      addLiveItem({
        kind: "error",
        text: event.error.message,
      });
      break;
  }
};
```

---

## Layout & Flexbox

### Ink Uses Yoga Flexbox

Ink implements the same flexbox as web CSS, so the model is familiar:

```tsx
import { Box, Text } from "ink";

// Row layout (default)
<Box>
  <Text>Left</Text>
  <Text>Right</Text>
</Box>

// Column layout
<Box flexDirection="column">
  <Text>Top</Text>
  <Text>Bottom</Text>
</Box>

// Flex grow
<Box width={80}>
  <Text>Label</Text>
  <Box flex={1}>
    <Text>Expands to fill</Text>
  </Box>
</Box>

// Padding & margins
<Box padding={1} marginBottom={1}>
  <Text>Padded text</Text>
</Box>

// Borders
<Box borderStyle="round" borderColor="cyan">
  <Text>Bordered</Text>
</Box>
```

### Full-Height App Layout

```tsx
// App.tsx main render

return (
  <Box flexDirection="column" height="100%">
    {/* Header */}
    <Box height={3} paddingBottom={1}>
      <TokenCounter usage={tokenUsage} />
    </Box>

    {/* Main content area (grows) */}
    <Box flex={1} flexDirection="column" overflowY="hidden">
      <MessageHistory messages={messages} />
      <LiveItemsSection items={liveItems} />
    </Box>

    {/* Footer - input field */}
    <Box height={3}>
      <InputField value={currentInput} onChange={setCurrentInput} />
    </Box>
  </Box>
);
```

### Scrolling Messages

Terminal scrolling is **manual** (Ink doesn't auto-scroll):

```tsx
// packages/ogcoder/src/ui/components/MessageHistory.tsx

interface MessageHistoryProps {
  messages: Message[];
  height: number; // Available height
}

export const MessageHistory: React.FC<MessageHistoryProps> = ({ messages, height }) => {
  // Render only visible messages (slice from end)
  const visibleMessages = messages.slice(-Math.floor(height / 2));

  return (
    <Box flexDirection="column" overflowY="hidden">
      {visibleMessages.map((msg, i) => (
        <MessageBlock key={i} message={msg} />
      ))}
    </Box>
  );
};
```

---

## Colors & Styling

### Available Props on `<Text>`

```tsx
<Text
  color="blue"              // "blue", "cyan", "red", "green", "yellow", "magenta", "white", "gray", or RGB hex
  backgroundColor="black"   // Same colors
  bold                      // Bold text
  dim                       // Dimmed (gray-ish)
  italic                    // Italic
  underline                 // Underlined
  strikethrough             // Strikethrough
  inverse                   // Reverse video (invert colors)
>
  Styled text
</Text>
```

### Syntax Highlighting Example

```tsx
// packages/ogcoder/src/ui/components/CodeBlock.tsx

import { Text, Box } from "ink";

interface CodeBlockProps {
  code: string;
  language?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  // Use a library like highlight.js to tokenize
  const tokens = highlightCode(code, language);

  return (
    <Box flexDirection="column" paddingX={1}>
      {tokens.map((token, i) => (
        <Text key={i} color={token.color} bold={token.bold}>
          {token.text}
        </Text>
      ))}
    </Box>
  );
};
```

### Theme System

```tsx
// packages/ogcoder/src/ui/theme/index.ts

export const themes = {
  dark: {
    background: "black",
    text: "white",
    primary: "cyan",
    success: "green",
    error: "red",
    warning: "yellow",
  },
  light: {
    background: "white",
    text: "black",
    primary: "blue",
    success: "green",
    error: "red",
    warning: "orange",
  },
};

// Load from ~/.gg/settings.json
export function loadTheme(userSettings?: Settings): typeof themes.dark {
  const themeName = userSettings?.theme || "dark";
  return themes[themeName];
}
```

---

## Performance Considerations

### Ink Rendering Performance

Unlike web React (60fps), Ink only re-renders on state changes. This is **much faster**, but you still need to be careful:

### 1. Avoid Expensive Computations

```tsx
// ❌ BAD: Runs on every render
const MyComponent = () => {
  const [data, setData] = useState([]);

  const sorted = expensiveSortFunction(data); // Expensive!

  return <Text>{sorted}</Text>;
};

// ✅ GOOD: Memoize
const MyComponent = () => {
  const [data, setData] = useState([]);

  const sorted = useMemo(
    () => expensiveSortFunction(data),
    [data]
  );

  return <Text>{sorted}</Text>;
};
```

### 2. Manage LiveItems Size

Don't let `liveItems` grow unbounded:

```tsx
// Keep only last 100 items
const addLiveItem = (item: LiveItem) => {
  setLiveItems(prev => {
    const updated = [...prev, item];
    return updated.length > 100 ? updated.slice(-100) : updated;
  });
};
```

### 3. Debounce Rapid Updates

```tsx
// Debounce text deltas (don't re-render every character)
const debouncedSetText = useMemo(
  () => debounce((text: string) => setText(text), 50),
  []
);

const handleTextDelta = (text: string) => {
  debouncedSetText(text);
};
```

### 4. Pause Rendering During Large Operations

```tsx
const [isPaused, setIsPaused] = useState(false);

const processLargeDataset = async (data: unknown[]) => {
  setIsPaused(true);
  
  // Do expensive work off-thread (if possible)
  const result = await new Promise(resolve => {
    setTimeout(() => {
      resolve(expensiveComputation(data));
    }, 0);
  });
  
  setLiveItems(result);
  setIsPaused(false);
};

if (isPaused) {
  return <Text>Processing...</Text>;
}
```

---

## Testing Ink Components

### Challenge: Rendering Ink in Tests

Vitest runs in Node.js, not a terminal. You need to mock the terminal:

### Example Test

```tsx
// packages/ogcoder/src/ui/components/InputField.test.tsx

import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { InputField } from "./InputField";

describe("InputField", () => {
  it("renders input prompt", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();

    const { lastFrame } = render(
      <InputField
        value=""
        onChange={onChange}
        onSubmit={onSubmit}
      />
    );

    // lastFrame() returns rendered output as string
    expect(lastFrame()).toContain(">");
  });

  it("calls onChange when input changes", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();

    const { stdin } = render(
      <InputField
        value=""
        onChange={onChange}
        onSubmit={onSubmit}
      />
    );

    // Simulate typing 'a'
    stdin.write("a");

    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("calls onSubmit when Enter is pressed", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();

    const { stdin } = render(
      <InputField
        value="hello"
        onChange={onChange}
        onSubmit={onSubmit}
      />
    );

    // Simulate pressing Enter
    stdin.write("\r");

    expect(onSubmit).toHaveBeenCalledWith("hello");
  });
});
```

### Testing with `ink-testing-library`

```bash
npm install --save-dev ink-testing-library
```

```tsx
import { render } from "ink-testing-library";

const { lastFrame, stdin, stdout } = render(<App />);

// Check output
const output = lastFrame();
expect(output).toContain("Hello World");

// Simulate user input
stdin.write("a");

// Check async behavior
await waitFor(() => {
  expect(lastFrame()).toContain("New content");
});
```

---

## OGCoder Ink Architecture Diagram

```
┌─────────────────────────────────────────┐
│            App.tsx (Main)               │
│  - messages[], liveItems[], tokenUsage  │
│  - handleSubmit, handleInput            │
└────────────┬────────────────────────────┘
             │
    ┌────────┴──────────┬──────────────┬──────────────┐
    │                   │              │              │
    ▼                   ▼              ▼              ▼
┌─────────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐
│TokenCounter │  │MessageHist │  │LiveItems │  │InputField  │
│   (header)  │  │  (middle)  │  │ (middle) │  │  (footer)  │
└─────────────┘  └────────────┘  └──────────┘  └────────────┘
                      │                │
                      │                │
        ┌─────────────┴───┐    ┌───────┴──────────┐
        │                 │    │                  │
        ▼                 ▼    ▼                  ▼
    ┌────────┐      ┌─────────┐    ┌──────────┐
    │Message │      │TextBlock│    │ToolCall │
    │ Block  │      │(md + hl)│    │ + Result │
    └────────┘      └─────────┘    └──────────┘
        │                │              │
        └────────────────┴──────────────┘
               Updates state up to App.tsx
               via callbacks

Event Flow:
user input
    ↓
useInput hook detects keystroke
    ↓
handleInputChange fires
    ↓
setCurrentInput updates state
    ↓
App.tsx re-renders
    ↓
InputField receives new props
    ↓
Ink re-renders changed region
    ↓
ANSI sent to terminal
```

---

## Summary: Key Takeaways

1. **Ink is React for terminal** — Same component/hook model, different rendering target
2. **Event-driven, not continuous** — Re-renders only on state changes
3. **Layout with flexbox** — `<Box>`, `<Text>`, familiar props like `flex`, `padding`, `borderStyle`
4. **Input via hooks** — `useInput`, `useStdin`, custom hooks for complex logic
5. **State management is simple** — React hooks, no Redux/Zustand needed
6. **Streaming UX with live items** — Queue pattern for real-time events (agent text, tool calls)
7. **Colors & styling with props** — No CSS, use `color`, `bold`, `dim`, etc.
8. **Performance is good by default** — Only re-render on change, but manage large data carefully
9. **Testing is different** — Use `ink-testing-library` to mock terminal
10. **App orchestration in one file** — Main App.tsx holds all state because it needs to coordinate everything

---

## References

- **Ink Docs**: https://github.com/vadimdemedes/ink
- **Yoga Flexbox**: https://yogalayout.com/
- **React Docs**: https://react.dev/
- **ink-testing-library**: https://github.com/vadimdemedes/ink-testing-library
- **ANSI Escape Codes**: https://en.wikipedia.org/wiki/ANSI_escape_code

---

**Created**: March 15, 2026

**For**: GG Framework ogcoder CLI

This guide bridges the gap between React knowledge and building production Ink terminal UIs.
