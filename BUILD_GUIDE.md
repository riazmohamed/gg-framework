# GG Framework: Complete Build & Teaching Guide

**A step-by-step guide to recreate, build, and teach how to build the GG Framework — a modular TypeScript framework for LLM-powered apps.**

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture & Dependencies](#architecture--dependencies)
3. [Phase 1: Foundation (gg-ai)](#phase-1-foundation-gg-ai)
4. [Phase 2: Agent Loop (gg-agent)](#phase-2-agent-loop-gg-agent)
5. [Phase 3: CLI Application (ggcoder)](#phase-3-cli-application-ggcoder)
6. [Build & Deployment](#build--deployment)
7. [Key Patterns & Conventions](#key-patterns--conventions)
8. [Testing Strategy](#testing-strategy)

---

## Project Overview

**GG Framework** is a modular TypeScript LLM framework with three publishable packages:

| Package | npm | Purpose | Dependency Chain |
|---------|-----|---------|------------------|
| `@abukhaled/gg-ai` | Unified LLM streaming API | Core streaming layer for Anthropic, OpenAI, GLM, Moonshot | **Standalone** |
| `@abukhaled/gg-agent` | Multi-turn agentic loop | Tool execution, context overflow handling, multi-turn reasoning | Depends on `gg-ai` |
| `@abukhaled/ggcoder` | Full CLI coding agent | Terminal UI, OAuth, file tools, MCP integration, slash commands | Depends on both |

**Stacking principle**: Each package works independently. Stack them together to build higher-level abstractions.

```
@abukhaled/gg-ai (core streaming)
    ↓
@abukhaled/gg-agent (agent loop + tool execution)
    ↓
@abukhaled/ggcoder (CLI with Ink/React terminal UI)
```

---

## Architecture & Dependencies

### Tech Stack

- **Language**: TypeScript 5.9 (strict, ES2022, ESM)
- **Package Manager**: pnpm with workspaces
- **Build**: tsc (TypeScript compiler)
- **Testing**: Vitest 4.0
- **Linting**: ESLint 10 + typescript-eslint (flat config)
- **Formatting**: Prettier 3.8
- **CLI UI**: Ink 6 + React 19
- **LLM SDKs**: `@anthropic-ai/sdk`, `openai`
- **Schema Validation**: Zod v4
- **CLI Utilities**: chalk, commander, marked-terminal
- **File Operations**: fast-glob, ignore (gitignore support)
- **Model Context Protocol**: `@modelcontextprotocol/sdk`

### Project Structure

```
packages/
├── gg-ai/
│   ├── src/
│   │   ├── types.ts          # Core types (StreamOptions, ContentBlock, Message)
│   │   ├── stream.ts         # Main dispatch function
│   │   ├── errors.ts         # GGAIError, ProviderError
│   │   ├── providers/        # Anthropic, OpenAI, GLM, Moonshot implementations
│   │   └── utils/            # EventStream, Zod-to-JSON-Schema
│   └── package.json
│
├── gg-agent/
│   ├── src/
│   │   ├── types.ts          # AgentTool, AgentEvent, AgentOptions
│   │   ├── agent.ts          # Agent class wrapper
│   │   ├── agent-loop.ts     # Core async generator loop
│   │   └── index.ts          # Exports
│   └── package.json
│
└── ggcoder/
    ├── src/
    │   ├── cli.ts            # Entry point (891 lines)
    │   ├── config.ts         # App paths, constants
    │   ├── session.ts        # Session state management
    │   ├── system-prompt.ts  # System prompt generation
    │   ├── ui/
    │   │   ├── App.tsx       # Main React component (1732 lines)
    │   │   ├── components/   # 25+ UI components (one per file)
    │   │   ├── hooks/        # useAgentLoop, useSessionManager, etc.
    │   │   └── theme/        # dark.json, light.json
    │   ├── tools/            # Agentic tools (read, write, edit, bash, grep, find, ls, web-fetch, subagent, etc.)
    │   ├── core/
    │   │   ├── oauth/        # PKCE flows for Anthropic, OpenAI
    │   │   ├── mcp/          # Model Context Protocol client
    │   │   ├── compaction/   # Context compaction & token counting
    │   │   ├── agent-session.ts    # Session + agent coordination
    │   │   ├── slash-commands.ts   # Command registry
    │   │   ├── logger.ts     # Singleton debug logger
    │   │   └── extensions/   # Extension system
    │   └── modes/            # Execution modes (interactive, json, rpc, serve)
    └── package.json
```

### Key Constraints

- **No API keys**: Only OAuth tokens stored locally in `~/.gg/auth.json`
- **Workspace dependencies**: All use `workspace:*` to stay in sync
- **Version sync**: All 3 packages must have the same version number
- **Debug logging**: Timestamped logs to `~/.gg/debug.log`, truncated on CLI restart
- **Strict TypeScript**: `strict: true` in all tsconfigs
- **ESLint flat config**: No `.eslintrc.json` — all in `eslint.config.js`

---

# Phase 1: Foundation (gg-ai)

## Goal
Build a **unified LLM streaming API** that works across 4 providers (Anthropic, OpenAI, GLM, Moonshot) with a single entry point.

### Conceptual Requirements

- **One `stream()` function**: Unified interface for all providers
- **Event stream architecture**: Push-based async iteration over deltas
- **Message types**: Support user, assistant, system, and tool_result roles
- **Content blocks**: Text, thinking, images, tool calls
- **Tool definition**: Zod schemas converted to JSON Schema
- **Error handling**: Provider-specific error mapping
- **Multi-provider support**: Registry pattern to add new providers

### Sequential Prompts for Building gg-ai

#### Prompt 1: Define Core Types
```
Create packages/gg-ai/src/types.ts with:
- Provider type: "anthropic" | "openai" | "glm" | "moonshot"
- Message types: SystemMessage, UserMessage, AssistantMessage, ToolResultMessage
- ContentPart types: TextContent, ThinkingContent, ImageContent, ToolCall, ToolResult
- Tool interface with name, description, and Zod parameters
- StreamOptions interface with provider, model, messages, tools, maxTokens, temperature, thinking, cacheRetention, webSearch, etc.
- StreamResponse with message, stopReason, and usage
- StreamEvent types: TextDeltaEvent, ToolCallDeltaEvent, DoneEvent, ErrorEvent, etc.
- StopReason type: "end_turn" | "tool_use" | "max_tokens" | etc.
- Usage interface with inputTokens, outputTokens, cache stats
```

#### Prompt 2: Build Error Handling
```
Create packages/gg-ai/src/errors.ts with:
- GGAIError class extending Error with provider context
- ProviderError class for provider-specific errors
- Include error message mapping to hide sensitive provider details
- Example: map Anthropic "prompt too long" to "context_length_exceeded"
```

#### Prompt 3: Create EventStream Utility
```
Create packages/gg-ai/src/utils/event-stream.ts with:
- EventStream class that is a push-based async iterable
- Methods: push(event), done(value), error(err)
- Support both async iteration (for await) and promise chaining (await result())
- Make it dual-nature: can be iterated over AND awaited for final value
```

#### Prompt 4: Implement Zod-to-JSON-Schema Converter
```
Create packages/gg-ai/src/utils/zod-to-json-schema.ts with:
- Function to convert Zod schemas to JSON Schema
- Support ZodString, ZodNumber, ZodBoolean, ZodObject, ZodArray
- Handle optional/required fields, descriptions, defaults
- Return JSON Schema compatible with OpenAI and Anthropic tool schemas
```

#### Prompt 5: Create Provider Registry
```
Create packages/gg-ai/src/provider-registry.ts with:
- ProviderRegistry class
- Methods: register(name, handler), get(name)
- Handler type: { stream: (options) => StreamResult }
- Throw clear error if provider not found
```

#### Prompt 6: Implement Anthropic Provider
```
Create packages/gg-ai/src/providers/anthropic.ts with:
- streamAnthropic(options: StreamOptions): StreamResult
- Call Anthropic SDK client.messages.create({ stream: true })
- Map event stream to unified StreamEvent types:
  - content_block_start (text, tool_use) → TextDeltaEvent or ToolCallDeltaEvent start
  - content_block_delta → TextDeltaEvent or ToolCallDeltaEvent delta
  - content_block_stop → collect tool args and emit ToolCallDoneEvent
  - message_delta → collect usage
  - message_stop → emit DoneEvent with stopReason
- Handle image inputs (base64 to media_type + data)
- Support tool definitions with Zod-to-JSON-Schema conversion
- Handle thinking blocks (if model supports extended thinking)
```

#### Prompt 7: Implement OpenAI Provider
```
Create packages/gg-ai/src/providers/openai.ts with:
- streamOpenAI(options: StreamOptions): StreamResult
- Call OpenAI SDK client.chat.completions.create({ stream: true })
- Map OpenAI streaming chunks to unified types
- Handle tool_calls (function objects) and convert to ToolCallDeltaEvent/ToolCallDoneEvent
- Support images and usage stats
- Note: OpenAI doesn't stream thinking — include that in response after streaming
```

#### Prompt 8: Implement GLM & Moonshot Providers
```
Create packages/gg-ai/src/providers/glm.ts (or handle in openai.ts adapter) with:
- GLM and Moonshot are OpenAI-compatible
- GLM has two endpoints: coding (subscription) and regular (pay-per-token)
- Add retry logic for GLM (check for "Insufficient balance" or "no resource package")
- Moonshot base URL: https://api.moonshot.ai/v1
- Both should use streamOpenAI as base, with endpoint adaptation
```

#### Prompt 9: Add Transform Layer
```
Create packages/gg-ai/src/providers/transform.ts with:
- Helper functions to normalize responses across providers
- normalizeToolCall(provider, rawToolCall) → ToolCall
- normalizeContentBlock(provider, block) → ContentPart
- normalizeUsage(provider, usage) → Usage
```

#### Prompt 10: Create Main Stream Dispatcher
```
Create packages/gg-ai/src/stream.ts with:
- stream(options: StreamOptions): StreamResult
- Route to correct provider based on options.provider
- If accountId is set and provider is openai, use OpenAI Codex endpoint
- If baseUrl is set, use that instead of default
- Validate options (throw if model or apiKey missing)
- Return StreamResult (dual-nature: async iterable + awaitable)
```

#### Prompt 11: Create index.ts Exports
```
Create packages/gg-ai/src/index.ts with:
- Export types: Provider, Message, Tool, StreamOptions, StreamEvent, StreamResponse, Usage, etc.
- Export main function: stream
- Export utilities: EventStream
- Export errors: GGAIError, ProviderError
```

### Tests for Phase 1 (gg-ai)

**Test locations**: `packages/gg-ai/src/**/*.test.ts`

```typescript
// Test 1: Stream creation and basic iteration
// - Create stream for simple text prompt
// - Verify async iteration yields text_delta events
// - Verify done event has correct stopReason

// Test 2: Tool call detection
// - Create stream with tool definitions
// - Verify tool_call_start, tool_call_delta, tool_call_done events
// - Verify tool args are correctly assembled

// Test 3: Error handling
// - Mock provider throwing context overflow error
// - Verify GGAIError wraps it appropriately
// - Verify error event is yielded

// Test 4: Anthropic-specific behavior
// - Verify image encoding works
// - Verify thinking blocks (if supported)
// - Verify cache control headers

// Test 5: OpenAI-specific behavior
// - Verify function_call streaming
// - Verify image handling differs from Anthropic
// - Verify accountId routes to Codex endpoint

// Test 6: Multi-provider consistency
// - Same prompt to Anthropic and OpenAI
// - Verify both yield compatible event streams
// - Verify both return compatible StreamResponse

// Test 7: Provider registry
// - Register custom provider
// - Verify it can be dispatched to
// - Verify unregistered provider throws

// Test 8: Zod to JSON Schema
// - Convert complex Zod schema
// - Verify JSON Schema is valid
// - Verify all field types are handled
```

### Build & Validate Phase 1

```bash
cd packages/gg-ai
pnpm build              # tsc output
pnpm check              # Type check
pnpm test               # Run tests
cd ../..
pnpm lint               # ESLint
pnpm format:check       # Prettier
```

**Success criteria**:
- ✅ No type errors (`tsc --noEmit` passes)
- ✅ All linting passes
- ✅ All tests pass
- ✅ Built `dist/` contains both `.js` and `.d.ts`
- ✅ Can import from `@abukhaled/gg-ai` in another package

---

# Phase 2: Agent Loop (gg-agent)

## Goal
Build an **autonomous agent loop** that calls LLMs, executes tools, and iterates until completion.

### Conceptual Requirements

- **Async generator loop**: Yield events (text, tool calls, turn completions) to consumer
- **Tool execution**: Call tool functions with proper context (abort signal, tool call ID)
- **Multi-turn reasoning**: Accumulate messages, loop until agent stops
- **Error recovery**: Retry on overload, handle context overflow with compaction
- **Pause handling**: Support `pause_turn` stop reason for server-side tools
- **Token tracking**: Accumulate usage across turns

### Sequential Prompts for Building gg-agent

#### Prompt 1: Define Agent Types
```
Create packages/gg-agent/src/types.ts with:
- AgentTool interface extending Tool with execute(args, context) method
- AgentEvent types: AgentTextDeltaEvent, AgentThinkingDeltaEvent, AgentToolCallStartEvent, AgentToolCallEndEvent, AgentTurnEndEvent, AgentDoneEvent, AgentErrorEvent
- ToolContext interface with signal, toolCallId, onUpdate callback
- ToolExecuteResult: string | { content: string; details?: unknown }
- AgentOptions interface with provider, model, system, tools, maxTurns, maxTokens, transformContext callback
- AgentResult with message, totalTurns, totalUsage
```

#### Prompt 2: Create Error Detection Utilities
```
Create packages/gg-agent/src/agent-loop.ts - first section with:
- isContextOverflow(error) → boolean
  - Detects Anthropic "prompt is too long: N tokens > M"
  - Detects OpenAI "context_length_exceeded" or "maximum context length"
- isBillingError(error) → boolean
  - Detects "Insufficient balance", "no resource package", "quota exceeded"
- isOverloaded(error) → boolean
  - Detects 429, 529, 503, "rate limit", "overloaded"
  - Excludes billing errors (won't resolve with retry)
```

#### Prompt 3: Implement Core Agent Loop
```
Create packages/gg-agent/src/agent-loop.ts with async generator function:
- agentLoop(messages: Message[], options: AgentOptions): AsyncGenerator<AgentEvent, AgentResult>
- Loop while turn < maxTurns
- Before each LLM call:
  - Call options.transformContext(messages) if present (for compaction)
  - Yield transformed messages back to caller
- Call stream() from @abukhaled/gg-ai with current messages and tools
- Consume stream events:
  - text_delta → yield AgentTextDeltaEvent
  - thinking_delta → yield AgentThinkingDeltaEvent
  - toolcall_delta/toolcall_done → yield AgentToolCallStartEvent/EndEvent
- When stream done:
  - If stopReason is "end_turn" → yield AgentTurnEndEvent and return AgentResult
  - If stopReason is "tool_use" → execute tools, add ToolResultMessage, continue loop
  - If stopReason is "pause_turn" → continue loop (up to maxContinuations times)
  - If error:
    - If isContextOverflow && options.transformContext → call with force: true, retry
    - If isOverloaded → exponential backoff retry (max 3 times, 3s delay)
    - Otherwise → yield AgentErrorEvent and return
- Accumulate usage across turns
- Yield AgentDoneEvent at end
```

#### Prompt 4: Implement Tool Execution
```
Extend packages/gg-agent/src/agent-loop.ts with tool execution logic:
- Create AbortController for each tool call
- Call tool.execute(args, { signal, toolCallId, onUpdate })
- Track duration with performance.now()
- Handle both sync and async tool results
- Parse StructuredToolResult (if returned as object with details)
- Build ToolResultMessage with toolCallId, content, isError flag
- On tool error: catch exception, mark isError: true, yield end event
- Handle AbortSignal (user cancellation)
- Emit AgentToolCallUpdateEvent if tool calls onUpdate callback
```

#### Prompt 5: Implement Agent Class Wrapper
```
Create packages/gg-agent/src/agent.ts with:
- Agent class constructor(options: AgentOptions)
- run(messages: Message[]): AgentStream method
- AgentStream class that wraps async generator
- Support both: for await (for ...of agentStream) and await agentStream.then()
- Store and expose totalTurns, totalUsage, finalMessage
- Implement [Symbol.asyncIterator] and then/catch/finally for dual-nature object
```

#### Prompt 6: Create index.ts Exports
```
Create packages/gg-agent/src/index.ts with:
- Export types: AgentTool, AgentEvent, AgentOptions, AgentResult, ToolContext
- Export agentLoop, Agent class
- Re-export from @abukhaled/gg-ai: Message, Tool, Usage, etc.
```

### Tests for Phase 2 (gg-agent)

**Test location**: `packages/gg-agent/src/agent-loop.test.ts`

```typescript
// Test 1: Simple completion (no tools)
// - Mock stream returning text and end_turn
// - Run agentLoop
// - Verify AgentTextDeltaEvent, AgentTurnEndEvent, AgentDoneEvent
// - Verify usage is accumulated

// Test 2: Tool call execution
// - Mock stream returning tool_use stop reason
// - Provide tool that returns "success"
// - Verify AgentToolCallStartEvent, tool execution, AgentToolCallEndEvent
// - Verify ToolResultMessage added to messages for next turn
// - Verify loop continues to next turn

// Test 3: Error on tool execution
// - Mock tool that throws
// - Verify AgentToolCallEndEvent has isError: true
// - Verify loop continues (tool error doesn't stop agent)

// Test 4: Context overflow retry
// - Mock first stream call throws context overflow
// - transformContext callback returns truncated messages
// - Verify agentLoop calls transformContext with force: true
// - Verify retries with truncated context
// - Verify succeeds on second attempt

// Test 5: Overload retry
// - Mock stream throws 429 rate limit error
// - Verify exponential backoff retry
// - Verify succeeds after delay
// - Verify max 3 retries then fails

// Test 6: Max turns enforcement
// - Set maxTurns: 2
// - Mock stream returning tool_use each time
// - Verify loop stops at 2 turns
// - Verify does not attempt 3rd turn

// Test 7: Pause turn continuation
// - Mock stream returning pause_turn stop reason
// - Verify loop continues without adding tool result
// - Verify tracks consecutive pauses
// - Verify stops at maxContinuations (default 5)

// Test 8: isContextOverflow detection
// - Verify detects various overflow error formats

// Test 9: isBillingError detection
// - Verify detects quota/balance errors
// - Verify NOT retried on overload

// Test 10: Tool with onUpdate callback
// - Provide tool that calls onUpdate during execution
// - Verify AgentToolCallUpdateEvent is yielded
```

### Build & Validate Phase 2

```bash
cd packages/gg-agent
pnpm build
pnpm check
pnpm test
cd ../..
pnpm lint
pnpm format:check
```

**Success criteria**:
- ✅ All tests pass
- ✅ No type errors
- ✅ Can be imported by ggcoder
- ✅ agentLoop works with real stream from gg-ai

---

# Phase 3: CLI Application (ggcoder)

## Goal
Build a **production CLI coding agent** with OAuth auth, terminal UI, file tools, and interactive chat.

This is the largest phase. Break it into sub-phases:

### Phase 3a: Core Infrastructure

#### Prompt 1: Create Config & Paths
```
Create packages/ggcoder/src/config.ts with:
- getAppPaths() → { homeDir, ggDir, authFile, sessionsDir, debugLog, commandsDir, mcp-config }
- ensureAppDirs() → creates ~/.gg/ and subdirectories
- DEFAULT_MODEL, CONTEXT_WINDOWS for each model
- DEBUG_MODE from env var
```

#### Prompt 2: Create Logger
```
Create packages/ggcoder/src/core/logger.ts with:
- Singleton logger that writes to ~/.gg/debug.log
- log(level, category, message, metadata?)
- Timestamp each entry
- Truncate log on CLI startup (keep last 100KB)
- Support "startup", "auth", "tool", "turn", "error" categories
```

#### Prompt 3: Create Auth Storage
```
Create packages/ggcoder/src/core/auth-storage.ts with:
- AuthStorage class
- save(provider, token) → writes encrypted JSON to ~/.gg/auth.json
- load(provider) → retrieves token
- delete(provider) → removes token
- loadAll() → returns all stored tokens
- Support Anthropic and OpenAI
```

#### Prompt 4: Implement OAuth PKCE Flows
```
Create packages/ggcoder/src/core/oauth/ with:
- anthropic.ts: loginAnthropic() → launches browser PKCE flow
  - Authorization endpoint
  - Token exchange
  - Store in auth storage
- openai.ts: loginOpenAI() → similar flow for OpenAI
- types.ts: OAuthCredentials, OAuthLoginCallbacks interfaces
- Both should use built-in http.createServer on random port
```

#### Prompt 5: Create Session Management
```
Create packages/ggcoder/src/core/session-manager.ts with:
- SessionManager class
- createSession(name?, provider?, model?) → creates ~/.gg/sessions/{id}.json
- loadSession(id) → reads session file
- listSessions() → returns all sessions
- deleteSession(id) → removes session
- updateSession(id, messages, metadata) → appends messages
- Session structure: { id, name, provider, model, createdAt, messages: Message[], metadata }
```

#### Prompt 6: Create Agent Session Coordinator
```
Create packages/ggcoder/src/core/agent-session.ts with:
- AgentSession class that coordinates agent + session + auth
- Constructor takes SessionManager, AuthStorage, logger
- Methods:
  - switchModel(provider, model)
  - compact(force?) → calls compactor
  - newSession(name?)
  - getSystemPrompt() → includes tools available, date, version
- Property: slashCommandContext → for slash command execution
```

#### Prompt 7: Create Settings Manager
```
Create packages/ggcoder/src/core/settings-manager.ts with:
- SettingsManager class
- loadSettings() → from ~/.gg/settings.json
- saveSettings(settings) → persists
- Settings include: defaultModel, defaultProvider, theme, debug, etc.
```

### Phase 3b: Tool System

#### Prompt 8: Implement File Tools
```
Create packages/ggcoder/src/tools/ with individual files:
- read.ts: read(file_path, offset?, limit?) → returns file contents (truncates large files)
- write.ts: write(file_path, content) → creates/overwrites file, creates parent dirs
- edit.ts: edit(file_path, old_text, new_text) → surgical replacement (old_text must match exactly once)
- find.ts: find(pattern, path?) → glob search respecting .gitignore
- grep.ts: grep(pattern, path?, include?, case_insensitive?, max_results?) → regex search in files
- ls.ts: ls(path?, all?) → directory listing with file types and sizes
- bash.ts: bash(command, timeout?) → shell execution with exit code
- All should use Zod for parameter validation
- All should return structured results (not just strings)
```

#### Prompt 9: Implement web-fetch Tool
```
Create packages/ggcoder/src/tools/web-fetch.ts with:
- web_fetch(url, max_length?) → fetch URL, strip HTML, return text
- Use node-fetch or built-in fetch
- Respect max_length parameter (default 10000 chars)
- Return error message if fetch fails
```

#### Prompt 10: Implement Task System
```
Create packages/ggcoder/src/tools/tasks.ts with:
- tasks(action: "add"|"list"|"done"|"remove", id?, title?, prompt?) → task management
- Store tasks in ~/.gg/tasks.json
- support add, list, mark done, remove operations
- Each task has { id, title, prompt, status, createdAt }
```

#### Prompt 11: Implement Subagent Tool
```
Create packages/ggcoder/src/tools/subagent.ts with:
- subagent(prompt) → spawn isolated Agent with same auth/model
- Return agent result
- Use for parallel/recursive work
- NOT async iterable — returns final result
```

#### Prompt 12: Create Tool Index
```
Create packages/ggcoder/src/tools/index.ts with:
- createTools(agentSession, fileSystem) → AgentTool[]
- Return array of all tools with execute functions wired up
- Tools should have proper error handling and validation
```

### Phase 3c: System Prompt & Commands

#### Prompt 13: Generate System Prompt
```
Create packages/ggcoder/src/system-prompt.ts with:
- buildSystemPrompt(options) → string
- Include:
  - Role: expert coding agent
  - Date and time
  - Tools available (list of tools + descriptions)
  - Instructions for tool use
  - Code style preferences
  - Model-specific capabilities (thinking, web search, etc.)
  - File operation constraints (no destructive operations without asking)
```

#### Prompt 14: Create Slash Commands
```
Create packages/ggcoder/src/core/slash-commands.ts with:
- Registry pattern for commands: { name, aliases, description, usage, execute }
- Built-in commands:
  - /model or /m [provider] [model] → switch model
  - /compact or /c → force context compaction
  - /help or /h or /? → show help
  - /settings or /config → show/edit settings
  - /session or /s [id] → load session
  - /new or /n [name] → create new session
  - /quit or /q or /exit → exit CLI
- SlashCommandContext interface with switchModel, compact, newSession, quit methods
- Execute function parses args and dispatches to handler
```

#### Prompt 15: Create Prompt Commands
```
Create packages/ggcoder/src/core/prompt-commands.ts with:
- Built-in prompt templates (e.g., "fix", "test", "refactor")
- Each is a multi-line prompt stored in ~.gg/commands/
- Support variables: {file}, {selection}, {language}
```

### Phase 3d: Terminal UI (Ink + React)

#### Prompt 16: Create Base UI Components
```
Create packages/ggcoder/src/ui/components/ with individual React components:
- Spinner.tsx: animated spinner (frames: | / - \)
- TextBlock.tsx: markdown-formatted text with syntax highlighting
- ToolCall.tsx: displays tool call (name, args, status)
- ToolResult.tsx: displays tool result (success/error)
- MessageBlock.tsx: renders assistant message with content
- Input.tsx: single-line or multi-line input prompt
- Select.tsx: choice selection (up/down arrows)
- ProgressBar.tsx: progress with percentage
- TokenCounter.tsx: shows input/output/cache tokens
- Each component should be under 100 lines
```

#### Prompt 17: Create App State & Hooks
```
Create packages/ggcoder/src/ui/hooks/ with:
- useAgentLoop(options) → runs agent loop, yields events
- useSessionManager() → CRUD on sessions
- useSlashCommands(registry) → parses /command input
- useTokenCounter() → tracks usage across turns
- useTheme() → loads dark/light theme
```

#### Prompt 18: Create Main App Component
```
Create packages/ggcoder/src/ui/App.tsx with (1700+ lines):
- Main React component using Ink + react-dom
- State: messages[], liveItems[], currentInput, tokenUsage
- Input handler:
  - Parse slash commands first (check if starts with /)
  - Parse prompt commands (check ~/.gg/commands/)
  - Otherwise, send to agent
- Agent loop consumer:
  - Consume each event
  - Update liveItems array
  - Emit user message + assistant response
  - Update token counts
- Render:
  - Token counter at top
  - Message history (scrollable)
  - Live items (current turn)
  - Input field at bottom
- Keyboard handlers:
  - Ctrl+C → quit
  - Ctrl+L → clear
  - Shift+Enter → newline in input
```

#### Prompt 19: Create Render Function
```
Create packages/ggcoder/src/ui/render.ts with:
- renderApp(session, auth, settings) → runs React/Ink app
- Setup React root using Ink
- Handle process signals (SIGINT, SIGTERM)
- Return final session state
```

### Phase 3e: Execution Modes & CLI

#### Prompt 20: Create Interactive Mode
```
Create packages/ggcoder/src/modes/ with:
- interactive.ts: runInteractive(session) → uses Ink/React terminal UI
- Main execution path
- All user input goes through React component
```

#### Prompt 21: Create JSON Mode
```
Create modes/json-mode.ts with:
- runJsonMode(prompt, session) → runs agent, emits JSON events
- Emit AgentEvent as JSON per line (jsonl format)
- Final result as JSON
- Useful for programmatic consumption
```

#### Prompt 22: Create RPC/Serve Mode
```
Create modes/rpc-mode.ts and modes/serve-mode.ts with:
- HTTP server mode for remote agent execution
- Accept prompts via HTTP
- Stream responses as SSE or WebSocket
- Use session auth/model
```

#### Prompt 23: Create CLI Entry Point
```
Create packages/ggcoder/src/cli.ts (891 lines) with:
- #!/usr/bin/env node shebang
- Parse CLI args: --model, --provider, --json, --version, etc.
- Subcommands:
  - login → OAuth flow
  - logout → delete auth token
  - sessions → manage sessions
  - serve → start HTTP server
- Main flow:
  1. Initialize logger, auth, settings
  2. Load or create session
  3. Route to appropriate mode (interactive, json, serve)
  4. Handle errors and cleanup
- Version from package.json
```

### Phase 3f: Advanced Features

#### Prompt 24: Create MCP Integration
```
Create packages/ggcoder/src/core/mcp/ with:
- MCPClientManager class
- Load MCP servers from ~/.gg/mcp-config.json
- For each server: spawn process, connect via stdio
- Translate tools from MCP server format to AgentTool format
- Include in agent tools array
```

#### Prompt 25: Create Context Compaction
```
Create packages/ggcoder/src/core/compaction/ with:
- Token estimator: estimate token count for messages
- Compactor: call Anthropic prompt caching API to summarize old context
- shouldCompact(messages) → boolean based on approaching context limit
- compact(messages, model) → returns compacted messages
- Use only for Anthropic (provider-specific)
```

#### Prompt 26: Create Extension System
```
Create packages/ggcoder/src/core/extensions/ with:
- Extension interface: { name, version, activate(context) }
- ExtensionLoader: discovers and loads ~/.gg/extensions/
- Each extension can:
  - Register tools
  - Register commands
  - Hook into events
```

### Tests for Phase 3 (ggcoder)

**Test locations**: `packages/ggcoder/src/**/*.test.ts`

```typescript
// Test 1: Tool validation (packages/ggcoder/src/tools/)
// - read: verify truncation for large files
// - write: verify file creation and parent dir creation
// - edit: verify exact match requirement
// - find: verify .gitignore respect
// - grep: verify regex patterns

// Test 2: Slash command parsing
// - /model anthropic claude-3-5-sonnet
// - /compact (force compaction)
// - /new my-session (create session)
// - Verify command execution

// Test 3: Session persistence
// - Create session
// - Add messages
// - Save to disk
// - Load from disk
// - Verify messages match

// Test 4: Auth flow
// - Mock OAuth redirect
// - Verify token storage
// - Verify token retrieval

// Test 5: UI rendering
// - Mock agent events
// - Render App component
// - Verify output formatting

// Test 6: Token estimation
// - Estimate token count for prompt
// - Compare against actual usage
// - Verify within 10% accuracy

// Test 7: Tool execution in context
// - Create file with write tool
// - Read file with read tool
// - Verify contents match
// - Clean up (delete file)

// Test 8: Compaction
// - Create long message history
// - Trigger compaction
// - Verify new messages fit in context window
```

### Build & Validate Phase 3

```bash
cd packages/ggcoder
pnpm build
pnpm check
pnpm test
cd ../..
pnpm lint
pnpm format:check
```

**Success criteria**:
- ✅ `ggcoder --help` works
- ✅ `ggcoder login` authenticates
- ✅ Interactive mode starts and accepts input
- ✅ `/model` command switches models
- ✅ Prompt execution calls tools
- ✅ File tools create/read files correctly
- ✅ All tests pass

---

# Build & Deployment

## Local Development

```bash
# Clone repo
git clone https://github.com/abukhaled/gg-framework.git
cd gg-framework

# Install dependencies
pnpm install

# Build all packages (tsc)
pnpm build

# Type check without emit
pnpm check

# Run linter
pnpm lint
pnpm lint:fix    # Auto-fix

# Run formatter
pnpm format
pnpm format:check

# Run tests (all packages)
pnpm test

# Full validation before commit
pnpm check && pnpm lint && pnpm format:check
```

## Publishing to npm

### Prerequisites

- All 3 `package.json` files have **same version** (e.g., `4.2.35`)
- npm token set: `npm set //registry.npmjs.org/:_authToken=<token>`
- Token must be granular access token (can publish specific packages)

### Steps

1. **Bump versions** in all 3 `package.json`:
   ```json
   {
     "name": "@abukhaled/gg-ai",
     "version": "4.2.36",  // ← increment
     ...
   }
   ```

2. **Build all packages**:
   ```bash
   pnpm build
   pnpm check
   pnpm lint
   pnpm format:check
   ```

3. **Publish in dependency order**:
   ```bash
   # 1. Publish gg-ai first (no dependencies)
   pnpm --filter @abukhaled/gg-ai publish --no-git-checks

   # 2. Publish gg-agent (depends on gg-ai)
   pnpm --filter @abukhaled/gg-agent publish --no-git-checks

   # 3. Publish ggcoder (depends on both)
   pnpm --filter @abukhaled/ggcoder publish --no-git-checks
   ```

4. **Verify**:
   ```bash
   npm view @abukhaled/ggcoder versions --json

   # Test install
   npm i -g @abukhaled/ggcoder@4.2.36
   ggcoder --help
   ```

### Troubleshooting

- **ETARGET error after publish**: `npm cache clean --force`
- **Workspace resolution failed**: Ensure `workspace:*` in dependencies
- **Auth token invalid**: Regenerate token from npm account
- **404 on publish**: Ensure all 3 packages have `"publishConfig": { "access": "public" }`

---

# Key Patterns & Conventions

## StreamResult / AgentStream: Dual-Nature Objects

Both `StreamResult` (from gg-ai) and `AgentStream` (from gg-agent) are objects that can be:

1. **Async iterated** (as async generator):
   ```typescript
   for await (const event of stream) {
     console.log(event.type);  // "text_delta", "tool_call_start", etc.
   }
   ```

2. **Awaited** (as promise):
   ```typescript
   const result = await stream;  // StreamResponse or AgentResult
   console.log(result.message);
   ```

Both implement `[Symbol.asyncIterator]` and `then/catch`.

## Message Accumulation Pattern

```typescript
const messages: Message[] = [
  { role: "system", content: "..." },
];

// User turn
messages.push({ role: "user", content: userInput });

// Agent response
const result = await agent.run(messages);
messages.push({ role: "assistant", content: result.message.content });

// Tool results (if any)
if (hadTools) {
  messages.push({ role: "tool", content: toolResults });
}

// Next turn: loop with updated messages array
```

## Tool Definition Pattern (Zod)

```typescript
import { z } from "zod";

const readTool: AgentTool = {
  name: "read",
  description: "Read a file and return its contents",
  parameters: z.object({
    file_path: z.string().describe("Path to file"),
    offset: z.number().optional().describe("Line to start from"),
    limit: z.number().optional().describe("Max lines to read"),
  }),
  execute: async (args, context) => {
    // args is automatically typed as { file_path: string; offset?: number; limit?: number }
    return fs.readFileSync(args.file_path, "utf-8");
  },
};
```

The Zod schema is **automatically converted to JSON Schema** at provider boundary.

## Provider Registry Pattern

```typescript
// Register custom provider
providerRegistry.register("myprovider", {
  stream: (options) => {
    // Return StreamResult
    const eventStream = new EventStream<StreamEvent>();
    // ... fetch from API, push events
    return eventStream;
  },
});

// Use via stream()
const result = await stream({
  provider: "myprovider",
  model: "my-model",
  messages: [...],
});
```

## OAuth-Only Authentication

No API keys stored. Only OAuth tokens in `~/.gg/auth.json`:

```json
{
  "anthropic": {
    "access_token": "sk-...",
    "expires_at": 1234567890
  },
  "openai": {
    "access_token": "Bearer ...",
    "expires_at": 1234567890
  }
}
```

PKCE flow ensures tokens are never exposed in URLs.

## Event Emission Patterns

**In gg-ai** (raw streaming):
```typescript
const eventStream = new EventStream<StreamEvent>();
eventStream.push({ type: "text_delta", text: "..." });
eventStream.push({ type: "toolcall_done", id, name, args });
eventStream.done({ message, stopReason, usage });
```

**In gg-agent** (higher-level events):
```typescript
yield { type: "text_delta", text: "..." };
yield { type: "tool_call_start", toolCallId, name, args };
yield { type: "tool_call_end", toolCallId, result, isError, durationMs };
yield { type: "turn_end", turn, stopReason, usage };
```

**In UI** (Ink React):
```typescript
const liveItems = [
  { kind: "text_delta", text: "..." },
  { kind: "tool_call", name: "read", args: {...}, status: "running" },
];
```

---

# Testing Strategy

## Test Pyramid

```
        ┌─────────────────────────┐
        │   Integration Tests     │  Test real e2e flows
        │  (agent + tools + auth) │
        └─────────────────────────┘
              ↑         ↑
      ┌───────────────┬──────────────┐
      │  Tool Tests   │  Agent Tests  │  Test individual tool execution
      │   (file ops,  │   (loop, tool │  and agent loop logic
      │    bash,      │   execution,  │
      │    web)       │   errors)     │
      └───────────────┴──────────────┘
              ↑         ↑         ↑
  ┌───────────────────┬─────────────┬──────────────┐
  │  Stream Tests     │ Error Tests │  Type Tests  │  Test low-level
  │ (event emission   │  (overflow, │  (Zod, JSON │  building blocks
  │  for each         │  billing,   │  Schema)     │
  │  provider)        │  overload)  │              │
  └───────────────────┴─────────────┴──────────────┘
```

## Per-Package Test Strategy

### gg-ai (Foundation Layer)

**Goal**: Verify stream events are correct and consistent across providers.

```typescript
describe("gg-ai", () => {
  describe("streaming", () => {
    it("yields text_delta events from Anthropic", async () => { ... });
    it("yields text_delta events from OpenAI", async () => { ... });
    it("assembles tool calls correctly", async () => { ... });
  });
  
  describe("providers", () => {
    it("handles Anthropic-specific features (thinking, caching)", async () => { ... });
    it("handles OpenAI-specific features (function_call streaming)", async () => { ... });
  });
  
  describe("error handling", () => {
    it("wraps provider errors as GGAIError", async () => { ... });
    it("preserves error context (provider name, status code)", async () => { ... });
  });
});
```

**Run**: `pnpm --filter @abukhaled/gg-ai test`

### gg-agent (Agent Loop Layer)

**Goal**: Verify agent loop logic, tool execution, and error recovery.

```typescript
describe("gg-agent", () => {
  describe("agentLoop", () => {
    it("yields events for single-turn completion", async () => { ... });
    it("executes tools and continues on tool_use", async () => { ... });
    it("respects maxTurns", async () => { ... });
    it("handles context overflow with transformContext", async () => { ... });
    it("retries on overload with exponential backoff", async () => { ... });
  });
  
  describe("error detection", () => {
    it("detects context overflow from Anthropic", () => { ... });
    it("detects context overflow from OpenAI", () => { ... });
    it("distinguishes overload from billing errors", () => { ... });
  });
});
```

**Run**: `pnpm --filter @abukhaled/gg-agent test`

### ggcoder (CLI Layer)

**Goal**: Verify tools work, sessions persist, commands execute.

```typescript
describe("ggcoder", () => {
  describe("tools", () => {
    it("read: returns file contents", async () => { ... });
    it("write: creates file with parent dirs", async () => { ... });
    it("edit: replaces exact text match", async () => { ... });
    it("find: respects .gitignore", async () => { ... });
    it("grep: searches with regex", async () => { ... });
    it("bash: executes command and returns exit code", async () => { ... });
  });
  
  describe("session", () => {
    it("creates session file", () => { ... });
    it("loads session messages", () => { ... });
    it("appends messages", () => { ... });
  });
  
  describe("auth", () => {
    it("stores OAuth token", () => { ... });
    it("retrieves token", () => { ... });
  });
  
  describe("UI", () => {
    it("renders App component without crashing", () => { ... });
    it("parses /model command", () => { ... });
  });
});
```

**Run**: `pnpm --filter @abukhaled/ggcoder test`

## Mocking Strategy

### Mock LLM Responses

```typescript
// Create mock stream that yields events
function mockStream(events: StreamEvent[], response: StreamResponse) {
  const eventStream = new EventStream<StreamEvent>();
  
  (async () => {
    for (const e of events) {
      eventStream.push(e);
    }
    eventStream.done(response);
  })();
  
  return eventStream;
}

// Usage in test
vi.mocked(stream).mockReturnValue(mockStream(
  [{ type: "text_delta", text: "hello" }],
  { message: {...}, stopReason: "end_turn", usage: {...} }
));
```

### Mock File System

```typescript
// Use temporary directory
import { createTempDir } from "vitest";
const tmpDir = await createTempDir();

// Or mock fs module
vi.mock("node:fs");
const mockFs = vi.mocked(fs);
mockFs.readFileSync.mockReturnValue("file contents");
```

### Mock OAuth

```typescript
// Mock HTTP server
const mockServer = createServer((req, res) => {
  if (req.url.includes("/authorize")) {
    // Simulate redirect back with auth code
  }
});

await loginAnthropic();  // Will call mock server
```

---

## CI/CD Pipeline

### GitHub Actions Example

```yaml
name: Build & Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      
      - run: pnpm install
      - run: pnpm check
      - run: pnpm test
      - run: pnpm lint
      - run: pnpm format:check
```

---

## Checklist for Each Build Phase

### Before Starting

- [ ] Read existing code in that package
- [ ] Understand dependencies (what this phase depends on)
- [ ] Review types/interfaces that will be needed

### During Implementation

- [ ] Follow TypeScript strict mode
- [ ] Use Zod for runtime validation where appropriate
- [ ] Add JSDoc comments to exported functions
- [ ] Write tests as you go (co-located with source)
- [ ] Run type check after each file: `pnpm check`

### Before Merging

- [ ] `pnpm build` succeeds
- [ ] `pnpm check` (no type errors)
- [ ] `pnpm test` (all tests pass)
- [ ] `pnpm lint` (no lint errors)
- [ ] `pnpm format:check` (properly formatted)
- [ ] Verify imports work across packages (no circular deps)
- [ ] Manual smoke test (if phase has CLI, try running it)

---

## Teaching This Framework

### Recommended Teaching Order

1. **Start with gg-ai**: Show how to build a unified API across multiple providers. Teach EventStream, Zod-to-JSON-Schema, provider registration. Real-world value: students can immediately use this to call any LLM API uniformly.

2. **Then gg-agent**: Show how to build an autonomous loop on top of streaming. Teach async generators, event emission, tool execution, error recovery. Real-world value: students understand how modern AI agents actually work.

3. **Finally ggcoder**: Show how to build a production CLI. Teach Ink/React, OAuth, file operations, complex state management. Real-world value: students ship a real product.

### Learning Objectives

**Phase 1 (gg-ai)**:
- Understand streaming vs. polling
- Learn provider adapters pattern
- Practice TypeScript strict mode
- Build async iterable data structures

**Phase 2 (gg-agent)**:
- Understand async generators
- Learn error recovery patterns (retry, backoff, overflow handling)
- Build multi-turn reasoning systems
- Practice event-driven architecture

**Phase 3 (ggcoder)**:
- Build terminal UI with React (Ink)
- Implement OAuth flows
- Handle file I/O securely
- Coordinate complex state (agent + session + auth)
- Debug production code

### Example Workshop Series

**Workshop 1: "Build an LLM Wrapper" (2 hours)**
- Clone gg-framework, checkout `phase-1-skeleton` branch
- Follow gg-ai prompts sequentially
- Test with `curl` against stream endpoint
- Deliverable: students can call any LLM uniformly

**Workshop 2: "Build an Autonomous Agent" (2 hours)**
- Use phase-1 output as dependency
- Follow gg-agent prompts
- Implement custom tools
- Test with mock stream data
- Deliverable: students have agent that reasons and executes tools

**Workshop 3: "Build a Production CLI" (3 hours)**
- Use phase 1+2 outputs
- Build terminal UI components
- Implement auth flow
- Add file operations
- Deliverable: students have working CLI they can install and use

---

## Maintenance & Evolution

### Adding a New Provider

1. Implement `streamMyProvider(options: StreamOptions): StreamResult` in `packages/gg-ai/src/providers/myprovider.ts`
2. Register in `stream.ts`:
   ```typescript
   providerRegistry.register("myprovider", {
     stream: (options) => streamMyProvider(options),
   });
   ```
3. Add to `Provider` type in `types.ts`
4. Write tests in `providers/myprovider.test.ts`
5. Update docs

### Adding a New Tool

1. Create `packages/ggcoder/src/tools/mytool.ts`
2. Implement `AgentTool` with Zod parameters and execute function
3. Add to `createTools()` in `tools/index.ts`
4. Write tests in `tools/mytool.test.ts`
5. Update system prompt (add to description list)

### Adding a Slash Command

**Option A: UI handler** (needs React state access)
- Edit `packages/ggcoder/src/ui/App.tsx` in `handleSubmit()`
- Check for `/mycommand` and update state directly

**Option B: Registry command** (pure logic, no UI)
- Add to `createBuiltinCommands()` in `packages/ggcoder/src/core/slash-commands.ts`
- Implement `execute(args, context)` function
- If needs new capability, add method to `SlashCommandContext` and wire in `AgentSession`

---

## Final Checklist for Production Release

Before publishing to npm:

- [ ] All tests pass (`pnpm test`)
- [ ] No type errors (`pnpm check`)
- [ ] ESLint passes (`pnpm lint`)
- [ ] Prettier formatting OK (`pnpm format:check`)
- [ ] Build succeeds (`pnpm build`)
- [ ] Versions bumped and in sync across all 3 packages
- [ ] package.json `files` array includes `dist/`
- [ ] package.json has `publishConfig: { access: "public" }`
- [ ] README.md updated with changes
- [ ] git commit + push
- [ ] Publish in order: gg-ai → gg-agent → ggcoder
- [ ] Verify npm pages show new versions
- [ ] Test install: `npm i -g @abukhaled/ggcoder@<version>`
- [ ] CLI works: `ggcoder --version`

---

## References & Resources

- **TypeScript Docs**: https://www.typescriptlang.org/docs/
- **Zod**: https://zod.dev/
- **Ink (Terminal UI)**: https://github.com/vadimdemedes/ink
- **Anthropic API**: https://docs.anthropic.com/
- **OpenAI API**: https://platform.openai.com/docs/
- **pnpm Workspaces**: https://pnpm.io/workspaces
- **Vitest**: https://vitest.dev/
- **ESLint**: https://eslint.org/docs/latest/

---

**Created**: March 15, 2026

**Last Updated**: March 15, 2026

This guide covers building GG Framework from scratch through all 3 packages, with sequential AI prompts, testing strategies, and production deployment. Use this to teach others or rebuild the framework in new projects.
