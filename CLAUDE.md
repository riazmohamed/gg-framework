# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**gg-framework** — Modular TypeScript monorepo for building LLM-powered apps, from raw streaming to a full CLI coding agent.

| Package | npm | Description |
|---|---|---|
| `packages/gg-ai` | `@abukhaled/gg-ai` | Unified LLM streaming API (Anthropic, OpenAI) |
| `packages/gg-agent` | `@abukhaled/gg-agent` | Agent loop with tool execution |
| `packages/ggcoder` | `@abukhaled/ogcoder` | CLI coding agent (`ogcoder` binary) |

**Install**: `npm i -g @abukhaled/ogcoder`

**Dependency chain**: `gg-ai` → `gg-agent` → `ogcoder`

## Project Structure

```
packages/
  ├── gg-ai/                 # @abukhaled/gg-ai — Unified LLM streaming API
  │   └── src/
  │       ├── types.ts       # Core types (StreamOptions, ContentBlock, events)
  │       ├── errors.ts      # GGAIError, ProviderError
  │       ├── stream.ts      # Main stream() dispatch function
  │       ├── providers/     # Anthropic, OpenAI streaming implementations
  │       └── utils/         # EventStream, Zod-to-JSON-Schema
  │
  ├── gg-agent/              # @abukhaled/gg-agent — Agent loop with tool execution
  │   └── src/
  │       ├── types.ts       # AgentTool, AgentEvent, AgentOptions
  │       ├── agent.ts       # Agent class + AgentStream
  │       └── agent-loop.ts  # Pure async generator loop
  │
  └── ggcoder/               # @abukhaled/ogcoder — CLI (ogcoder)
      └── src/
          ├── cli.ts         # CLI entry point
          ├── config.ts      # Configuration constants
          ├── core/          # Auth, OAuth, settings, sessions, extensions
          │   ├── oauth/     # PKCE OAuth flows (anthropic, openai)
          │   ├── compaction/ # Context compaction & token estimation
          │   ├── mcp/       # Model Context Protocol client
          │   └── extensions/ # Extension system
          ├── tools/         # Agentic tools (bash, read, write, edit, grep, find, ls, web-fetch, subagent)
          ├── ui/            # Ink/React terminal UI components & hooks
          │   ├── components/ # UI components (one per file)
          │   ├── hooks/     # useAgentLoop, useSessionManager, useSlashCommands, etc.
          │   └── theme/     # dark.json, light.json, etc.
          ├── modes/         # Execution modes (interactive, print, json, serve, agent-home)
          └── utils/         # Error handling, git, shell, formatting, image
```

## Commands

```bash
pnpm build                          # Build all packages (tsup for gg-ai/gg-agent, tsc for ogcoder)
pnpm check                          # tsc --noEmit (all packages)
pnpm lint                           # ESLint
pnpm lint:fix                       # ESLint --fix
pnpm format                         # Prettier write
pnpm format:check                   # Prettier check
pnpm test                           # Vitest (all packages)

# Single package
pnpm --filter @abukhaled/gg-ai test          # Test one package
pnpm --filter @abukhaled/ogcoder test -- src/tools/read.test.ts  # Single test file
pnpm test -- -t "should read files"          # Test by name pattern
```

## Code Quality — Zero Tolerance

After editing ANY file, run:

```bash
pnpm check && pnpm lint && pnpm format:check
```

Fix ALL errors before continuing. Quick fixes: `pnpm lint:fix` and `pnpm format`.

## Architecture

### Data Flow

`stream()` (gg-ai) → `agentLoop()` (gg-agent) → tools + session (ggcoder)

### gg-ai: Provider-Agnostic Streaming

- **Provider registry** (`provider-registry.ts` + `stream.ts`): Map-based dispatch. Built-in providers registered at module load: `anthropic` and `minimax` → `streamAnthropic()` (MiniMax uses an Anthropic-compatible endpoint); `openai`, `glm`, `moonshot`, `xiaomi`, `ollama`, `openrouter` → `streamOpenAI()` with provider-specific baseUrl/config.
- **Message transform** (`providers/transform.ts`): Converts unified `Message[]` to provider format. Key quirks:
  - Anthropic: `toolu_*` IDs, `thinking` content blocks with signatures, tool results wrapped in user messages
  - OpenAI-compat: IDs remapped to `call_*` prefix, `reasoning_content` field (GLM/Moonshot only), tool results as `tool` role
  - GLM: merges user text into preceding tool messages to preserve thinking context
  - MiniMax: silently strips image/video/document content (unsupported)
- **StreamResult**: dual-interface — async iterable (`for await`) AND thenable (`await` for final response)
- **Zod → JSON Schema** (`utils/zod-to-json-schema.ts`): `z.toJSONSchema(schema)` with `$schema` key stripped. Bypassed when tool has `rawInputSchema` (MCP tools).

### gg-agent: Agent Loop

`agentLoop()` is a pure async generator in `agent-loop.ts`:

1. Poll steering messages → 2. Transform context (compaction) → 3. Route model → 4. Repair tool pairing → 5. Call LLM with timeouts → 6. Extract & execute tools in parallel → 7. Loop on `tool_use` stop reason

**Error recovery**: context overflow → force compact + retry (3x), overload 429/529 → exponential backoff 2-30s (10x), stream stall → retry (5x) with tiered timeouts (45s first-event, 30s idle, 90s hard cap pre-output, 5min once output is flowing, 5-10min for thinking-heavy models), empty response → retry (2x), abort → graceful exit.

**Agent events**: `text_delta`, `thinking_delta`, `toolcall_delta`, `tool_call_start/update/end`, `turn_end`, `agent_done`, `retry` (with `silent` flag for hidden retries), `model_switch`, `steering_message`, `follow_up_message`, `server_tool_call/result`, `error`.

### ggcoder: CLI Application

- **Tools** (`tools/`): Factory functions returning `AgentTool<ZodSchema>`. Each tool gets `ToolOperations` interface for I/O abstraction (local fs by default, injectable for remote).
- **MCP** (`core/mcp/`): Servers configured with command (stdio) or url (HTTP/SSE with fallback). Tools wrapped as `AgentTool` with `mcp__${server}__${tool}` naming. Rate-limited (2s min gap).
- **Model router** (`core/model-router.ts`): Per-turn model switching. Modes: `vision` (auto-switch on images/video/docs), `plan-execute` (heavy planner + light executor), `hybrid` (vision priority, then plan-execute). Vision fallback chain: GLM-4.6V → MiMo Omni → Moonshot → OpenAI (Claude excluded for cost).
- **Compaction** (`core/compaction/compactor.ts`): Triggers at 80% context or `contextWindow - 16384` tokens (whichever is lower). Keeps system message + recent ~20K tokens intact. Middle section summarized via LLM. Falls back to extractive summary on failure.
- **Sessions** (`core/session-manager.ts`): Append-only JSONL with DAG structure (leafId for branching). Streams line-by-line for large files. `repairToolPairs()` fixes interrupted sessions on restore.
- **Auth** (`core/auth-storage.ts`, `core/oauth/`): OAuth PKCE for Anthropic and OpenAI (with token refresh + 401 retry); static API keys for GLM, Moonshot, Xiaomi, MiniMax, and OpenRouter. Ollama runs locally — no credentials needed. All credentials stored in `~/.gg/auth.json`. Provider selection at startup uses `resolveActiveProvider()` in `cli.ts` — falls back to the first authenticated provider if the saved one isn't logged in.
- **Themes** (`ui/theme/`): Six themes — `dark`, `light`, `dark-ansi`, `light-ansi`, `dark-daltonized`, `light-daltonized` — plus `auto` (detects from terminal). ANSI variants use 16-color palette for limited terminals; daltonized variants are color-blind friendly. `loadTheme(name)` in `theme.ts` returns the JSON config; `ThemeContext` + `useTheme()` for read, `SetThemeContext` + `useSetTheme()` for runtime switching.
- **UI**: Ink 6 + React 19. `useAgentLoop` hook drives the agent and surfaces events to React state. Throttled streaming flush at ~16ms intervals to avoid saturating renders. Markdown rendering uses `utils/token-to-ansi.ts` (custom tokenizer → ANSI) instead of marked-terminal for theme-aware output. Terminal hyperlinks via `utils/hyperlink.ts` (gated by `supports-hyperlinks.ts`). Cross-component state (taskbar, etc.) lives in `ui/stores/` using a tiny `create-store` pattern.
- **Debug logging**: `~/.gg/debug.log` — timestamped log of startup, auth, tool calls, turn completions, errors. Truncated on each CLI restart. Singleton logger in `src/core/logger.ts`.

### Slash Commands

Two kinds — UI-handled take precedence over registry:

1. **UI-handled** (`App.tsx` `handleSubmit`): `/model`, `/compact`, `/quit`, `/clear`, `/theme`, `/teach-me`, `/plan`, `/plans` — these need direct React state access (overlays, token counters, `agentLoop.reset()`).
2. **Registry** (`core/slash-commands.ts` `createBuiltinCommands()`): `/help`, `/settings`, `/session`, `/new`, `/router` — receive `SlashCommandContext` with methods like `switchModel()`, `compact()`, `newSession()`.

To add a UI command: add a condition in `handleSubmit` before the registry check.
To add a registry command: add an entry in `createBuiltinCommands()` array. If it needs new capabilities, extend `SlashCommandContext` and wire it in `AgentSession.createSlashCommandContext()`.

## Key Patterns

- **StreamResult/AgentStream**: dual-nature objects — async iterable (`for await`) + thenable (`await`)
- **EventStream**: push-based async iterable in `@abukhaled/gg-ai/utils/event-stream.ts`
- **agentLoop**: pure async generator — call LLM, yield deltas, execute tools, loop on tool_use
- **resolveActiveProvider**: `cli.ts` helper that picks the logged-in provider at startup with fallback
- **Zod schemas**: tool parameters defined with Zod, converted to JSON Schema at provider boundary

## Organization Rules

- Types → `types.ts` in each package
- Providers → `providers/` in gg-ai, one file per provider
- Tools → `tools/` in ggcoder, one file per tool
- UI components → `ui/components/`, one per file
- OAuth flows → `core/oauth/`, one per provider
- Tests → co-located with source files

## Publishing

Publish in dependency order. All three packages must share the same version.

```bash
pnpm build
pnpm --filter @abukhaled/gg-ai publish --no-git-checks
pnpm --filter @abukhaled/gg-agent publish --no-git-checks
pnpm --filter @abukhaled/ogcoder publish --no-git-checks
```

All packages use `"publishConfig": { "access": "public" }` (required for scoped packages). Use `--no-git-checks` to skip git dirty/tag checks.
