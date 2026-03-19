# GG Framework: Design Patterns & Architecture

**A comprehensive analysis of the design patterns used throughout the GG Framework.**

---

## Table of Contents

1. [Pattern Overview](#pattern-overview)
2. [Core Patterns](#core-patterns)
3. [Stream & Agent Patterns](#stream--agent-patterns)
4. [CLI & UI Patterns](#cli--ui-patterns)
5. [Data Flow Patterns](#data-flow-patterns)
6. [Error Handling Patterns](#error-handling-patterns)
7. [State Management Patterns](#state-management-patterns)
8. [Pattern Decision Matrix](#pattern-decision-matrix)

---

## Pattern Overview

The GG Framework uses **17 primary design patterns** organized by layer:

| Layer | Patterns | Purpose |
|-------|----------|---------|
| **gg-ai** (streaming) | Provider Registry, Dual-Nature Objects, Event Stream | Multi-provider abstraction |
| **gg-agent** (loop) | Async Generator, Error Recovery, Tool Context | Autonomous reasoning |
| **ogcoder** (CLI) | Command Registry, Session Coordinator, Hook-Based State | User interface & persistence |

---

# Core Patterns

## 1. Provider Registry Pattern

**What it is**: Register implementations at runtime, dispatch by name.

**Where it's used**: `packages/gg-ai/src/provider-registry.ts`

```typescript
// ── REGISTRATION (at startup) ──
providerRegistry.register("anthropic", {
  stream: (options) => streamAnthropic(options),
});

providerRegistry.register("openai", {
  stream: (options) => streamOpenAI(options),
});

// ── DISPATCH (at runtime) ──
const stream = (options: StreamOptions) => {
  const handler = providerRegistry.get(options.provider);
  return handler.stream(options);
};
```

**Why this pattern?**
- ✅ Add providers without modifying core `stream()` function
- ✅ Support multiple providers (Anthropic, OpenAI, GLM, Moonshot)
- ✅ Users can register custom providers
- ✅ Decoupled registration from invocation

**Tradeoffs**:
- ❌ Runtime dispatch cost (minimal, dict lookup)
- ❌ Provider not type-checked until runtime
- ✅ Could use TypeScript discriminated unions, but registry is more flexible

---

## 2. Dual-Nature Objects (Async Iterable + Awaitable)

**What it is**: Objects that work both as async iterables AND promises.

**Where it's used**: `packages/gg-ai/src/utils/event-stream.ts` (StreamResult) and `packages/gg-agent/src/agent.ts` (AgentStream)

```typescript
// ── IMPLEMENTATION ──
class StreamResult<T> {
  private events: T[] = [];
  private _response: Promise<StreamResponse>;

  // Make it async iterable
  async *[Symbol.asyncIterator]() {
    for (const event of this.events) {
      yield event;
    }
  }

  // Make it awaitable (Promise-like)
  then(onFulfilled?: (value: StreamResponse) => any) {
    return this._response.then(onFulfilled);
  }

  catch(onRejected?: (reason?: any) => any) {
    return this._response.catch(onRejected);
  }

  finally(onFinally?: () => void) {
    return this._response.finally(onFinally);
  }
}

// ── USAGE (both work!) ──
// Option 1: Iterate over events
for await (const event of stream) {
  console.log(event.type);  // "text_delta", "tool_call_start", etc.
}

// Option 2: Await final result
const response = await stream;
console.log(response.message);

// Option 3: Mix both
const promise = (async () => {
  for await (const event of stream) {
    if (event.type === "done") break;
  }
  return await stream;  // Get final response
})();
```

**Why this pattern?**
- ✅ **Flexible API**: Consumers choose iteration OR promise
- ✅ **Streaming + completion**: Get updates as they arrive + final result
- ✅ **Familiar to JavaScript developers**: Works like both generators and promises
- ✅ **No callback hell**: Use async/await with either approach

**Tradeoffs**:
- ❌ Slightly more complex implementation
- ❌ Users must understand dual nature
- ✅ Worth it for flexibility

**Real-world analogy**: Like a Netflix stream—you can watch episodes (iterate) or get the full series (await).

---

## 3. Event Stream Architecture (Push-Based)

**What it is**: Producer pushes events to a stream; consumer iterates.

**Where it's used**: `packages/gg-ai/src/utils/event-stream.ts`

```typescript
// ── PRODUCER SIDE (provider) ──
const eventStream = new EventStream<StreamEvent>();

client.messages.stream((event) => {
  if (event.type === "content_block_start") {
    eventStream.push({ type: "text_delta", text: "" });
  }
  if (event.type === "content_block_delta") {
    eventStream.push({ type: "text_delta", text: event.delta.text });
  }
  if (event.type === "message_stop") {
    eventStream.done({ message, stopReason, usage });
  }
});

return eventStream;

// ── CONSUMER SIDE (caller) ──
for await (const event of eventStream) {
  if (event.type === "text_delta") {
    console.log(event.text);  // Show text as it arrives
  }
}

const response = await eventStream;  // Get final result
console.log(response.message);
```

**Why this pattern?**
- ✅ **Real-time streaming**: Display text/tool calls immediately
- ✅ **Decoupled**: Producer doesn't need to know what consumer does
- ✅ **Back-pressure**: Consumer controls iteration speed
- ✅ **Error handling**: Can throw/catch errors naturally

**Tradeoffs**:
- ❌ Async iteration can be slow (one event per iteration)
- ✅ Can batch events if needed
- ❌ Can't easily "reset" a stream (it's consumed)
- ✅ Fine for single-use (one agent call per stream)

**Comparison**:
| Pattern | Push | Pull | Hybrid |
|---------|------|------|--------|
| **Callbacks** | ✅ (push-based) | - | - |
| **Event Emitters** | ✅ | - | - |
| **Generators** | - | ✅ (pull-based) | - |
| **Async Iterables** | - | ✅ | - |
| **EventStream** | ✅ | ✅ | ✅ (both!) |

---

## 4. Async Generator Loop

**What it is**: Agent loop that yields events as agent runs, returns final result.

**Where it's used**: `packages/gg-agent/src/agent-loop.ts`

```typescript
// ── IMPLEMENTATION ──
export async function* agentLoop(
  messages: Message[],
  options: AgentOptions,
): AsyncGenerator<AgentEvent, AgentResult> {
  let turn = 0;
  const totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };

  while (turn < maxTurns) {
    turn++;

    // Call LLM
    const response = await stream({ messages, tools: options.tools });

    // Yield events as they stream
    for await (const event of response) {
      yield event;  // Caller sees this in real-time
    }

    // Accumulate usage
    totalUsage.inputTokens += response.usage.inputTokens;
    totalUsage.outputTokens += response.usage.outputTokens;

    // Decide next turn
    if (response.stopReason === "end_turn") {
      break;  // Stop looping
    }

    if (response.stopReason === "tool_use") {
      // Execute tools, add results to messages
      for (const toolCall of response.toolCalls) {
        const result = await executeTool(toolCall);
        messages.push({ role: "tool", content: result });
      }
      // Loop continues, calls LLM again
    }
  }

  // Return final result (when generator done)
  return {
    message: response.message,
    totalTurns: turn,
    totalUsage,
  };
}

// ── USAGE ──
const gen = agentLoop(messages, options);

// Iterate over events
for await (const event of gen) {
  if (event.type === "text_delta") {
    console.log(event.text);
  }
  if (event.type === "tool_call_end") {
    console.log(`Tool ${event.toolCallId} completed`);
  }
}

// Get final result
const result = gen.next();  // { done: true, value: AgentResult }
console.log(result.value.totalTurns);
```

**Why this pattern?**
- ✅ **Natural flow**: Mirrors multi-turn agent reasoning
- ✅ **Streaming events**: See intermediate steps (text, tools)
- ✅ **Lazy evaluation**: Loop only runs when consumer iterates
- ✅ **Clean code**: No callbacks, no event emitter setup
- ✅ **Familiar**: Works like any async generator

**Tradeoffs**:
- ❌ Can't pause/resume mid-stream (no generator protocol used here)
- ✅ Fine for linear execution
- ❌ Generator protocol is less familiar to some developers
- ✅ But very intuitive once you understand it

**Comparison: How to Handle Multi-Turn Loops**

```typescript
// ❌ Callback hell
agent.run(messages, {
  onTextDelta: (text) => {},
  onToolCall: (tool) => {},
  onToolResult: (result) => {},
  onComplete: (result) => {},
});

// ❌ Event emitter
const emitter = agent.run(messages);
emitter.on("text_delta", (text) => {});
emitter.on("tool_call", (tool) => {});
emitter.on("complete", (result) => {});

// ✅ Async generator (GG Framework)
for await (const event of agent.run(messages)) {
  if (event.type === "text_delta") { /* ... */ }
  if (event.type === "tool_call_start") { /* ... */ }
}
```

---

## 5. Zod Schema + JSON Schema Pattern

**What it is**: Define tool parameters in Zod (for runtime validation), convert to JSON Schema (for LLM).

**Where it's used**: `packages/gg-ai/src/utils/zod-to-json-schema.ts` and every tool

```typescript
// ── DEFINE WITH ZOD ──
const readTool: AgentTool = {
  name: "read",
  description: "Read a file",
  parameters: z.object({
    file_path: z
      .string()
      .describe("Path to file to read"),
    offset: z
      .number()
      .int()
      .optional()
      .describe("Start line number"),
    limit: z
      .number()
      .int()
      .optional()
      .describe("Number of lines to read"),
  }),
  execute: async (args, context) => {
    // args is automatically typed!
    const result = fs.readFileSync(args.file_path, "utf-8");
    return result;
  },
};

// ── CONVERT TO JSON SCHEMA ──
const jsonSchema = zodToJsonSchema(readTool.parameters);
// Result:
{
  type: "object",
  properties: {
    file_path: {
      type: "string",
      description: "Path to file to read",
    },
    offset: {
      type: "integer",
      description: "Start line number",
    },
    limit: {
      type: "integer",
      description: "Number of lines to read",
    },
  },
  required: ["file_path"],
}

// ── PASS TO LLM ──
const response = await anthropic.messages.create({
  tools: [
    {
      name: "read",
      description: "Read a file",
      input_schema: jsonSchema,  // Use converted schema
    },
  ],
});

// ── VALIDATE TOOL ARGS ──
const toolCall = response.content[0];
const parsed = readTool.parameters.parse(toolCall.input);
// If invalid, throws ZodError
// If valid, args are type-safe

const result = await readTool.execute(parsed, context);
```

**Why this pattern?**
- ✅ **Single source of truth**: One Zod schema, not separate definitions
- ✅ **Type-safe**: TypeScript knows parameter types
- ✅ **Runtime validation**: LLM might return invalid JSON
- ✅ **Self-documenting**: Descriptions in schema
- ✅ **Works across providers**: Same schema for Anthropic, OpenAI, GLM

**Tradeoffs**:
- ❌ Extra conversion step (minimal cost)
- ✅ Zod is lightweight
- ✅ Solves a real problem (type safety + validation)

**Comparison: Tool Definition Approaches**

```typescript
// ❌ Manual JSON Schema (error-prone, no validation)
const tool = {
  name: "read",
  input_schema: {
    type: "object",
    properties: { file_path: { type: "string" } },
    required: ["file_path"],
  },
  execute: (args: any) => {  // Not type-safe!
    return fs.readFileSync(args.file_path);
  },
};

// ✅ Zod (type-safe, validated, self-documenting)
const tool: AgentTool = {
  name: "read",
  parameters: z.object({
    file_path: z.string().describe("Path to read"),
  }),
  execute: async (args, context) => {  // Type-safe!
    return fs.readFileSync(args.file_path);
  },
};
```

---

# Stream & Agent Patterns

## 6. PKCE OAuth Pattern

**What it is**: Browser-based OAuth without storing API keys, using PKCE for secure token exchange.

**Where it's used**: `packages/ogcoder/src/core/oauth/`

```typescript
// ── FLOW ──
// 1. Start local HTTP server on random port
// 2. Generate PKCE code_verifier & code_challenge
// 3. Open browser to authorization URL (with code_challenge)
// 4. User authenticates, browser redirects to localhost with auth_code
// 5. Catch redirect, exchange auth_code + code_verifier for token
// 6. Store token in ~/.gg/auth.json

export async function loginAnthropic(): Promise<OAuthCredentials> {
  const server = http.createServer(async (req, res) => {
    // Parse redirect URL
    const url = new URL(req.url, `http://localhost:${port}`);
    const code = url.searchParams.get("code");

    if (code) {
      // Exchange code for token
      const token = await exchangeCodeForToken(code, codeVerifier);
      
      // Store securely
      authStorage.save("anthropic", token);
      
      res.writeHead(200);
      res.end("You can close this window");
      resolve(token);
      server.close();
    }
  });

  server.listen(port);

  // Generate PKCE parameters
  const codeVerifier = generateRandomString(128);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Open browser
  const authUrl = new URL("https://console.anthropic.com/oauth/authorize");
  authUrl.searchParams.set("client_id", ANTHROPIC_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", `http://localhost:${port}`);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  open(authUrl.toString());

  return token;
}
```

**Why this pattern?**
- ✅ **No API keys stored locally**: Only tokens
- ✅ **Works in terminal**: Opens browser, user authenticates there
- ✅ **PKCE secure**: Code verifier never leaves device
- ✅ **Revocable**: User can revoke from OAuth provider dashboard
- ✅ **Supports multiple providers**: Same pattern for Anthropic, OpenAI

**Tradeoffs**:
- ❌ Requires user to open browser (not non-interactive friendly)
- ✅ Can still use with --api-key for non-OAuth
- ❌ Token expiry handling needed
- ✅ Anthropic & OpenAI tokens are long-lived (not a big issue)

---

## 7. Error Recovery Pattern (Retry + Backoff)

**What it is**: Detect errors, classify them, retry with exponential backoff.

**Where it's used**: `packages/gg-agent/src/agent-loop.ts`

```typescript
// ── ERROR CLASSIFICATION ──
export function isContextOverflow(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes("prompt is too long") ||
         msg.includes("context_length_exceeded");
}

export function isBillingError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes("insufficient balance") ||
         msg.includes("quota exceeded");
}

export function isOverloaded(err: Error): boolean {
  if (isBillingError(err)) return false;  // Don't retry billing errors
  const msg = err.message.toLowerCase();
  return msg.includes("rate limit") ||
         msg.includes("429") ||
         msg.includes("overloaded");
}

// ── RETRY LOGIC ──
const MAX_OVERFLOW_RETRIES = 3;
const MAX_OVERLOAD_RETRIES = 3;
const OVERLOAD_RETRY_DELAY_MS = 3_000;

let overloadRetries = 0;

try {
  const response = await stream({ messages, tools });
} catch (err) {
  if (isBillingError(err)) {
    // Don't retry, fail immediately
    yield { type: "error", error: err };
    return;
  }

  if (isContextOverflow(err) && options.transformContext) {
    // Call compaction function to reduce context
    const compacted = await options.transformContext(messages, { force: true });
    messages = compacted;
    // Retry the stream call with compacted messages
    const response = await stream({ messages, tools });
    // Continue normally
  }

  if (isOverloaded(err)) {
    if (overloadRetries < MAX_OVERLOAD_RETRIES) {
      // Exponential backoff: 3s, 6s, 12s
      const delay = OVERLOAD_RETRY_DELAY_MS * Math.pow(2, overloadRetries);
      await sleep(delay);
      overloadRetries++;
      // Retry the stream call
      const response = await stream({ messages, tools });
      // Continue normally
    } else {
      // Max retries exceeded
      yield { type: "error", error: new Error("Service overloaded, too many retries") };
      return;
    }
  }

  // Other errors, fail immediately
  yield { type: "error", error: err };
  return;
}
```

**Why this pattern?**
- ✅ **Graceful degradation**: Temporary errors are retried
- ✅ **Backoff prevents hammering**: Exponential delay
- ✅ **Classification prevents pointless retries**: Don't retry billing errors
- ✅ **Context compaction on overflow**: Automatically reduce context if needed
- ✅ **Production-ready**: Real LLM APIs have rate limits

**Tradeoffs**:
- ❌ Adds latency for overloaded errors (intentional!)
- ✅ Worth it for reliability
- ❌ Can't distinguish some error types
- ✅ Error messages from providers are usually clear

**Decision Tree**:

```
Error Occurred
    ↓
Is it a billing error? (quota, insufficient balance)
    ├─ YES → Don't retry, fail immediately
    └─ NO → continue
    ↓
Is it a context overflow error?
    ├─ YES & compaction available → Compact context, retry
    ├─ YES & no compaction → Fail immediately
    └─ NO → continue
    ↓
Is it a rate limit/overload error?
    ├─ YES & retries < 3 → Wait (exponential backoff), retry
    ├─ YES & retries >= 3 → Fail after max retries
    └─ NO → continue
    ↓
Unknown error
    └─ Fail immediately
```

---

## 8. Tool Context Pattern

**What it is**: Pass execution context (abort signal, callbacks) to tools.

**Where it's used**: `packages/gg-agent/src/agent-loop.ts` and all tools

```typescript
// ── DEFINE TOOL CONTEXT ──
export interface ToolContext {
  signal: AbortSignal;           // User can abort
  toolCallId: string;            // For logging
  onUpdate?: (update: unknown) => void;  // Progress callbacks
}

// ── USE IN AGENT LOOP ──
const abortController = new AbortController();

const toolContext: ToolContext = {
  signal: abortController.signal,
  toolCallId: toolCall.id,
  onUpdate: (update) => {
    yield {
      type: "tool_call_update",
      toolCallId: toolCall.id,
      update,
    };
  },
};

try {
  const result = await tool.execute(toolCall.args, toolContext);
} catch (err) {
  if (err.name === "AbortError") {
    // User cancelled
    return;
  }
  // Other error
}

// ── IMPLEMENT IN TOOL ──
const readTool: AgentTool = {
  name: "read",
  parameters: z.object({ file_path: z.string() }),
  execute: async (args, context) => {
    // Check if user aborted
    context.signal.throwIfAborted();

    // Read file
    const content = fs.readFileSync(args.file_path, "utf-8");

    // Optional: report progress
    context.onUpdate?.({
      bytesRead: content.length,
      lineCount: content.split("\n").length,
    });

    return content;
  },
};

const bashTool: AgentTool = {
  name: "bash",
  parameters: z.object({ command: z.string() }),
  execute: async (args, context) => {
    const child = spawn("bash", ["-c", args.command]);

    // Listen for abort
    context.signal.addEventListener("abort", () => {
      child.kill();
    });

    // Optional: stream output
    child.stdout.on("data", (chunk) => {
      context.onUpdate?.({ chunk: chunk.toString() });
    });

    return new Promise((resolve, reject) => {
      child.on("exit", (code) => resolve(`Exit code: ${code}`));
      child.on("error", reject);
    });
  },
};
```

**Why this pattern?**
- ✅ **Cancellation**: User can Ctrl+C to abort long-running tools
- ✅ **Progress feedback**: Tools can report updates (bytes read, commands running)
- ✅ **Logging**: toolCallId allows tracing
- ✅ **Tool-agnostic**: Works for any tool type (bash, file, web)

**Tradeoffs**:
- ❌ Tools must handle AbortSignal (not automatic)
- ✅ Clear pattern, easy to implement
- ❌ onUpdate is optional, not all tools use it
- ✅ Fine for basic tools

---

# CLI & UI Patterns

## 9. Command Registry Pattern

**What it is**: Register commands with handlers, dispatch by name.

**Where it's used**: `packages/ogcoder/src/core/slash-commands.ts`

```typescript
// ── DEFINE COMMAND ──
export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  execute(args: string[], context: SlashCommandContext): string | Promise<string>;
}

// ── REGISTRY ──
export function createBuiltinCommands(): SlashCommand[] {
  return [
    {
      name: "model",
      aliases: ["m"],
      description: "Switch model",
      usage: "/model <provider> <model>",
      execute: async (args, context) => {
        const [provider, model] = args;
        await context.switchModel(provider as Provider, model);
        return `Switched to ${provider}/${model}`;
      },
    },
    {
      name: "compact",
      aliases: ["c"],
      description: "Compact context",
      usage: "/compact",
      execute: async (args, context) => {
        await context.compact(true);  // force=true
        return "Context compacted";
      },
    },
    {
      name: "help",
      aliases: ["h", "?"],
      description: "Show help",
      usage: "/help [command]",
      execute: (args, context) => {
        if (args[0]) {
          const cmd = context.findCommand(args[0]);
          return cmd ? `${cmd.usage}\n${cmd.description}` : "Unknown command";
        }
        return "Available commands: /model, /compact, /help, /quit";
      },
    },
  ];
}

// ── DISPATCH ──
export function parseAndExecuteCommand(
  input: string,
  commands: SlashCommand[],
  context: SlashCommandContext,
): string | Promise<string> {
  const parts = input.slice(1).split(" ");  // Remove '/' and split
  const [commandOrAlias, ...args] = parts;

  const command = commands.find(
    cmd => cmd.name === commandOrAlias || cmd.aliases.includes(commandOrAlias)
  );

  if (!command) {
    return `Unknown command: ${commandOrAlias}`;
  }

  return command.execute(args, context);
}

// ── USAGE IN APP ──
const handleSubmit = (text: string) => {
  if (text.startsWith("/")) {
    const result = parseAndExecuteCommand(text, commands, slashCommandContext);
    setLiveItems(prev => [...prev, { kind: "info", text: result }]);
    return;
  }
  // Send to agent
};
```

**Why this pattern?**
- ✅ **Extensible**: Add new commands without modifying dispatch
- ✅ **Self-documenting**: Each command has description and usage
- ✅ **Aliases**: Support shortcuts (/m, /c, /?)
- ✅ **Familiar**: Like shell commands or git subcommands
- ✅ **Decoupled**: Command logic separate from UI

**Tradeoffs**:
- ❌ More boilerplate than direct if/else
- ✅ Worth it for structured growth
- ❌ Can't share state between commands easily
- ✅ Use context object for shared functionality

---

## 10. Session Coordinator Pattern

**What it is**: Coordinate between agent, session persistence, and auth.

**Where it's used**: `packages/ogcoder/src/core/agent-session.ts`

```typescript
// ── COORDINATOR CLASS ──
export class AgentSession {
  constructor(
    private sessionManager: SessionManager,
    private authStorage: AuthStorage,
    private logger: Logger,
  ) {}

  async switchModel(provider: Provider, model: string) {
    this.logger.log("turn", "switchModel", { provider, model });
    
    // Update current session
    if (this.current) {
      this.current.provider = provider;
      this.current.model = model;
      await this.sessionManager.updateSession(this.current.id, {
        ...this.current,
      });
    }
  }

  async compact(force: boolean = false) {
    this.logger.log("turn", "compact", { force });

    // Get current session messages
    const { messages } = this.current;

    // Check if compaction needed
    if (!force && !shouldCompact(messages)) {
      return;
    }

    // Compact using compactor
    const compacted = await compact(messages, this.current.model);

    // Update session with compacted messages
    await this.sessionManager.updateSession(this.current.id, compacted);

    this.logger.log("turn", "compact_done", {
      before: messages.length,
      after: compacted.length,
    });
  }

  async newSession(name?: string) {
    const session = await this.sessionManager.createSession(name);
    this.current = session;
    return session;
  }

  getSystemPrompt(): string {
    return buildSystemPrompt({
      provider: this.current.provider,
      model: this.current.model,
      tools: this.tools,
      date: new Date().toISOString(),
    });
  }

  get slashCommandContext(): SlashCommandContext {
    return {
      switchModel: (p, m) => this.switchModel(p, m),
      compact: (force) => this.compact(force),
      newSession: (name) => this.newSession(name),
      quit: () => process.exit(0),
    };
  }
}

// ── USAGE IN APP ──
const agentSession = new AgentSession(sessionManager, authStorage, logger);

const handleSubmit = (text: string) => {
  if (text.startsWith("/")) {
    const result = parseAndExecuteCommand(
      text,
      commands,
      agentSession.slashCommandContext,  // Pass coordinator context
    );
    return;
  }

  // Run agent with coordinator's system prompt
  const systemPrompt = agentSession.getSystemPrompt();
  const agentStream = agent.run([
    { role: "system", content: systemPrompt },
    ...messages,
    { role: "user", content: text },
  ]);
};
```

**Why this pattern?**
- ✅ **Single point of control**: All session operations go through coordinator
- ✅ **Logging**: Every important action is logged
- ✅ **Dependency injection**: SessionManager, AuthStorage, Logger passed in
- ✅ **Consistency**: Guarantees session state stays in sync
- ✅ **Testability**: Can mock dependencies

**Tradeoffs**:
- ❌ Another layer of indirection
- ✅ Necessary for managing 3 interrelated systems
- ❌ Could grow to be a god object
- ✅ Keep it focused on orchestration, not business logic

---

## 11. Hook-Based State Management

**What it is**: Use React hooks directly for CLI state instead of external state library.

**Where it's used**: Throughout `packages/ogcoder/src/ui/`

```typescript
// ── APP COMPONENT ──
export const App: React.FC<AppProps> = ({ session, auth, settings }) => {
  // Separate hooks for separate concerns
  const [messages, setMessages] = useState<Message[]>([]);
  const [liveItems, setLiveItems] = useState<LiveItem[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [tokenUsage, setTokenUsage] = useState<Usage>({
    inputTokens: 0,
    outputTokens: 0,
  });
  const [isRunning, setIsRunning] = useState(false);

  // Custom hooks for complex behavior
  const { sessions, current, createSession } = useSessionManager(sessionManager);
  const { events, result } = useAgentLoop(messages);
  const theme = useTheme(settings.theme);

  // Pure handler functions
  const handleInputChange = (text: string) => {
    setCurrentInput(text);
  };

  const handleSubmit = (text: string) => {
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setCurrentInput("");
    setIsRunning(true);
    // Stream processing...
  };

  // Render
  return (
    <Box flexDirection="column" height="100%">
      <TokenCounter usage={tokenUsage} />
      <MessageHistory messages={messages} />
      <LiveItemsSection items={liveItems} isRunning={isRunning} />
      <InputField value={currentInput} onChange={handleInputChange} />
    </Box>
  );
};

// ── CUSTOM HOOK ──
export function useAgentLoop(messages: Message[]) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [result, setResult] = useState<AgentResult | null>(null);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      const agentStream = agent.run(messages);
      for await (const event of agentStream) {
        if (isMounted) {
          setEvents(prev => [...prev, event]);
        }
      }
      if (isMounted) {
        setResult(await agentStream.response);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [messages]);

  return { events, result };
}
```

**Why this pattern?**
- ✅ **Simple**: No Redux/Zustand setup needed
- ✅ **Lightweight**: Hooks are built-in React
- ✅ **Co-located**: State and logic in component file
- ✅ **Familiar**: JavaScript developers know React
- ✅ **Event-driven**: Perfect for CLI (re-render only on state change)

**Tradeoffs**:
- ❌ No central state store (harder to debug complex state)
- ✅ Fine for single app (ogcoder is monolithic)
- ❌ Prop drilling if deeply nested
- ✅ Not deeply nested in CLI
- ❌ Can lead to spaghetti if not careful
- ✅ Keep component small, extract custom hooks

**Comparison: State Management Approaches**

```typescript
// ❌ Redux (overkill for CLI)
// Need: setup store, actions, reducers, middleware, devtools
// Pros: time-travel debugging, centralized
// Cons: massive boilerplate

// ❌ Zustand (better but still overhead)
// const useStore = create((set) => ({
//   messages: [],
//   addMessage: (msg) => set(state => ({ ... })),
// }));
// Pros: less boilerplate, good dev tools
// Cons: still external dependency

// ✅ React hooks (GG Framework)
// const [messages, setMessages] = useState([]);
// Pros: no setup, simple mental model, built-in
// Cons: scattered state, no central store
```

---

# Data Flow Patterns

## 12. Message Accumulation Pattern

**What it is**: Build up conversation context by appending messages.

**Where it's used**: Throughout agent loop and UI

```typescript
// ── FLOW ──
const messages: Message[] = [
  // Start with system prompt
  { role: "system", content: "You are a coding agent..." },
];

// Turn 1: User sends message
const userInput = "Read package.json";
messages.push({ role: "user", content: userInput });

// Agent processes and responds
const agentStream = await agent.run(messages);
const agentResponse = await agentStream;

// Add agent's response
messages.push({ role: "assistant", content: agentResponse.message });

// If agent called tools, add tool results
if (agentResponse.toolCalls) {
  const toolResults = await executeTools(agentResponse.toolCalls);
  messages.push({ role: "tool", content: toolResults });
}

// Turn 2: User sends another message
// messages now has: system, user1, assistant1, tool, user2, ...
messages.push({ role: "user", content: "Now write a test" });

// Agent sees FULL context from all previous turns
const agentStream2 = await agent.run(messages);

// ── WHY THIS WORKS ──
// - LLM can see conversation history
// - Agent understands previous context
// - Conversation is coherent across turns
// - Tool results inform next steps
```

**Why this pattern?**
- ✅ **Coherent conversations**: Agent remembers previous context
- ✅ **Tool results feedback**: Agent can react to tool output
- ✅ **Simple**: Just append messages, LLM handles context
- ✅ **Persisted**: Easy to save/load conversation

**Tradeoffs**:
- ❌ Context grows unbounded (memory + token usage)
- ✅ Solution: context compaction (Prompt Caching)
- ❌ Longer conversations = higher latency
- ✅ Fine for normal conversations

```typescript
// ── WITH COMPACTION ──
if (shouldCompact(messages)) {
  // Use Anthropic Prompt Caching to summarize old context
  const compacted = await compact(messages);
  messages = compacted;  // Replace with summarized version
}

// Continue with compacted messages
```

---

## 13. Live Items Queue Pattern

**What it is**: Queue of "live" items for current turn, clear after turn completes.

**Where it's used**: `packages/ogcoder/src/ui/App.tsx`

```typescript
// ── STATE ──
const [liveItems, setLiveItems] = useState<LiveItem[]>([]);

// ── STRUCTURE ──
interface LiveItem {
  kind: "text_delta" | "tool_call" | "tool_result" | "error";
  id: string;
  text?: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  status?: "running" | "done";
  isError?: boolean;
}

// ── PROCESSING EVENTS ──
const handleAgentEvent = (event: AgentEvent) => {
  switch (event.type) {
    case "text_delta":
      addLiveItem({
        kind: "text_delta",
        id: generateId(),
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
      // Update existing live item
      updateLiveItem(event.toolCallId, {
        status: "done",
        result: event.result,
        isError: event.isError,
      });
      break;

    case "turn_end":
      // Clear live items, add to permanent history
      const assembled = assembleMessage(liveItems);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: assembled,
      }]);
      setLiveItems([]);  // Clear for next turn
      break;
  }
};

// ── RENDER ──
return (
  <>
    <MessageHistory messages={messages} />
    <LiveItemsSection items={liveItems} />  {/* Current turn items */}
  </>
);
```

**Why this pattern?**
- ✅ **Real-time display**: Show text as it arrives
- ✅ **Status updates**: Tool calls transition from running → done
- ✅ **Clean separation**: Current turn vs permanent history
- ✅ **Fast**: Can batch items, update efficiently

**Tradeoffs**:
- ❌ Another state array to manage
- ✅ Simple to understand
- ❌ Items are temporary (discarded after turn)
- ✅ That's the point—for live display only

---

# Error Handling Patterns

## 14. Typed Error Classification

**What it is**: Classify errors into categories, handle each differently.

**Where it's used**: `packages/gg-agent/src/agent-loop.ts`

```typescript
// ── CLASSIFICATION FUNCTIONS ──
export function isContextOverflow(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("prompt is too long") ||
         msg.includes("context_length_exceeded") ||
         msg.includes("maximum context length");
}

export function isBillingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("insufficient balance") ||
         msg.includes("no resource package") ||
         msg.includes("quota exceeded");
}

export function isOverloaded(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (isBillingError(err)) return false;  // Don't treat billing as overload
  const msg = err.message.toLowerCase();
  return msg.includes("rate limit") ||
         msg.includes("429") ||
         msg.includes("overloaded");
}

// ── USAGE ──
try {
  const response = await stream(options);
} catch (err) {
  if (isContextOverflow(err)) {
    // Special handling: compact context
    yield { type: "error", error: err, recovery: "compact" };
  } else if (isBillingError(err)) {
    // Don't retry
    yield { type: "error", error: err, recovery: "none" };
  } else if (isOverloaded(err)) {
    // Retry with backoff
    yield { type: "error", error: err, recovery: "retry" };
  } else {
    // Unknown
    yield { type: "error", error: err, recovery: "none" };
  }
}
```

**Why this pattern?**
- ✅ **Discriminated handling**: Different error types, different responses
- ✅ **Readable**: Intent is clear
- ✅ **Robust**: Handles different provider error messages
- ✅ **Testable**: Each classification is testable independently

**Tradeoffs**:
- ❌ String matching is fragile (provider changes error message)
- ✅ Accept limitation, update as needed
- ❌ Doesn't cover all error types
- ✅ Good enough for most cases

---

# State Management Patterns

## 15. Dependency Injection Pattern

**What it is**: Pass dependencies (SessionManager, AuthStorage, Logger) rather than global singletons.

**Where it's used**: `packages/ogcoder/src/core/agent-session.ts`

```typescript
// ── CONSTRUCTOR INJECTION ──
export class AgentSession {
  constructor(
    private sessionManager: SessionManager,
    private authStorage: AuthStorage,
    private logger: Logger,
  ) {}

  // Use injected dependencies
  async switchModel(provider: Provider, model: string) {
    this.logger.log("turn", "switchModel", { provider, model });
    // ... use sessionManager
  }
}

// ── COMPOSITION IN MAIN ──
const logger = new Logger(appPaths.debugLog);
const authStorage = new AuthStorage(appPaths.authFile);
const sessionManager = new SessionManager(appPaths.sessionsDir);

const agentSession = new AgentSession(
  sessionManager,
  authStorage,
  logger,
);

// ── TESTING ──
const mockLogger = vi.mocked(Logger);
const mockAuth = vi.mocked(AuthStorage);
const mockSession = vi.mocked(SessionManager);

const agentSession = new AgentSession(mockSession, mockAuth, mockLogger);
agentSession.switchModel("anthropic", "claude-3");
expect(mockLogger.log).toHaveBeenCalled();
```

**Why this pattern?**
- ✅ **Testability**: Easy to mock dependencies
- ✅ **Flexibility**: Can swap implementations
- ✅ **Clarity**: Dependencies are explicit
- ✅ **No globals**: Each instance has its own dependencies

**Tradeoffs**:
- ❌ More constructor parameters
- ✅ TypeScript makes them explicit
- ❌ Slightly more boilerplate
- ✅ Worth it for testability

**Alternative (Singletons)**:

```typescript
// ❌ Hard to test
const logger = Logger.getInstance();  // Global
class AgentSession {
  switchModel() {
    logger.log(...);  // Can't mock
  }
}

// ✅ Easy to test
class AgentSession {
  constructor(private logger: Logger) {}  // Injected
  switchModel() {
    this.logger.log(...);  // Can mock
  }
}
```

---

## 16. Singleton Logger Pattern

**What it is**: One logger instance, shared across app, writes to file.

**Where it's used**: `packages/ogcoder/src/core/logger.ts`

```typescript
// ── IMPLEMENTATION ──
let logger: Logger | null = null;

export function initLogger(logPath: string) {
  if (logger) return;
  logger = new Logger(logPath);
}

export function log(
  level: "INFO" | "DEBUG" | "ERROR",
  category: string,
  message: string,
  metadata?: Record<string, unknown>,
) {
  if (!logger) throw new Error("Logger not initialized");
  logger.write({ level, category, message, metadata, timestamp: Date.now() });
}

export function closeLogger() {
  if (logger) {
    logger.close();
    logger = null;
  }
}

// ── USAGE ──
initLogger(appPaths.debugLog);

log("INFO", "startup", "CLI started", { version });
log("DEBUG", "auth", "Loading tokens", { provider: "anthropic" });
log("ERROR", "tool", "Tool execution failed", { toolName: "bash", error: err.message });

closeLogger();  // Flush and close

// ── OUTPUT FILE ──
// 2025-03-15T10:00:00.000Z [INFO] startup: CLI started { version: "4.2.35" }
// 2025-03-15T10:00:01.234Z [DEBUG] auth: Loading tokens { provider: "anthropic" }
// 2025-03-15T10:00:05.678Z [ERROR] tool: Tool execution failed { toolName: "bash", error: "..." }
```

**Why this pattern?**
- ✅ **Centralized logging**: All logs go to one file
- ✅ **Debugging**: Can read ~/.gg/debug.log to understand what happened
- ✅ **Categories**: Can filter logs by category
- ✅ **No console spam**: Logs go to file, not terminal
- ✅ **Timestamps**: Understand timing of events

**Tradeoffs**:
- ❌ Not visible in real-time without tailing file
- ✅ Intentional—don't clutter terminal
- ❌ Global singleton pattern (hard to test)
- ✅ Acceptable for logging (separate concern)

---

# Pattern Decision Matrix

## When to Use Each Pattern

| Pattern | Use When | Avoid When |
|---------|----------|-----------|
| **Provider Registry** | Multiple implementations of same interface | Only one implementation exists |
| **Dual-Nature Objects** | Need both iteration + awaitable | Simple request-response |
| **Event Stream** | Real-time streaming updates | Batch processing |
| **Async Generator** | Multi-step loops with events | Linear request-response |
| **Zod + JSON Schema** | Runtime validation + type safety | Simple unvalidated parameters |
| **PKCE OAuth** | User-facing auth, no API keys | Backend-to-backend auth |
| **Error Recovery** | Unreliable services (LLMs) | Reliable internal calls |
| **Tool Context** | Long-running tools, cancellation | Quick synchronous operations |
| **Command Registry** | Many commands, dynamic dispatch | Few hardcoded commands |
| **Session Coordinator** | Multiple concerns (auth, persistence) | Simple single-concern app |
| **Hook-Based State** | Single app component | Complex multi-screen app |
| **Message Accumulation** | Conversational AI | Stateless API |
| **Live Items Queue** | Streaming UI updates | Batch updates |
| **Error Classification** | Heterogeneous error sources | Homogeneous errors |
| **Dependency Injection** | Complex dependencies, testing | Simple dependencies |
| **Singleton Logger** | Centralized logging | Per-module logging |

---

## Pattern Combinations

### gg-ai (Streaming Foundation)
```
Provider Registry → Event Stream → Dual-Nature Objects
```
- User calls `stream()`
- Dispatches to provider via registry
- Provider pushes events to EventStream
- Return dual-nature StreamResult (iterable + awaitable)

### gg-agent (Agentic Loop)
```
Async Generator + Error Recovery + Tool Context
```
- Generator yields events
- Catches & classifies errors
- Retries with backoff on overload
- Compacts context on overflow
- Passes ToolContext to each tool

### ogcoder (CLI & UI)
```
Hook-Based State + Command Registry + Session Coordinator + Message Accumulation
```
- React hooks hold state (messages, liveItems, input)
- Commands dispatched via registry
- Coordinator orchestrates session + auth
- Messages accumulate in array
- Live items queue displays current turn

---

## Why This Architecture Works

1. **Separation of Concerns**: Each layer does one thing
   - gg-ai: normalize provider APIs
   - gg-agent: autonomous reasoning loop
   - ogcoder: user interface & persistence

2. **Patterns Enable Composability**: 
   - Provider Registry allows new providers without changing code
   - Async Generator pairs with Event Stream for clean event flow
   - Hook-based state is simple enough for CLI

3. **Type Safety**: 
   - Zod validates at runtime
   - TypeScript ensures compile-time correctness
   - Dual-nature objects type-check both iteration and await

4. **Error Handling is Built-in**:
   - Classification allows targeted recovery
   - Retry with backoff handles transient failures
   - Tool context provides cancellation

5. **No External State Management**:
   - Hooks sufficient for single app
   - Session coordinator enforces consistency
   - Dependency injection enables testing

---

**Created**: March 15, 2026

**For**: GG Framework Architecture Documentation

This guide explains WHY patterns were chosen, not just WHAT they are.
