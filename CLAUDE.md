# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**gg-framework** — Modular TypeScript monorepo for building LLM-powered apps, from raw streaming to a full CLI coding agent.

| Package | npm | Description |
|---|---|---|
| `packages/gg-ai` | `@abukhaled/gg-ai` | Unified LLM streaming API (Anthropic + OpenAI-compatible providers) |
| `packages/gg-agent` | `@abukhaled/gg-agent` | Agent loop with tool execution |
| `packages/ggcoder` | `@abukhaled/ogcoder` | CLI coding agent (`ogcoder` binary) |
| `packages/ggcoder-eyes` | `@abukhaled/ggcoder-eyes` | Project-agnostic perception probes — screenshots, logs, HTTP, capture sinks |
| `packages/gg-pixel` | `@kenkaiiii/gg-pixel` | Universal error tracking SDK (Node + Browser + Deno + Workers) |
| `packages/gg-pixel-server` | (private — Cloudflare Worker) | Ingest backend (Workers + D1) |
| `packages/gg-editor` | `@kenkaiiii/gg-editor` | Video editing agent (DaVinci Resolve / Premiere) |
| `packages/gg-editor-premiere-panel` | `@kenkaiiii/gg-editor-premiere-panel` | CEP panel bridge for Premiere |
| `packages/gg-boss` | `@kenkaiiii/gg-boss` | Orchestrator (`ggboss` binary) — drives multiple ogcoder workers across projects from one chat |

**Install**: `npm i -g @abukhaled/ogcoder`

**Dependency chain**: `gg-ai` → `gg-agent` → `ogcoder` (with `ggcoder-eyes` as a sibling perception layer consumed by `ogcoder`). `gg-boss` consumes `gg-ai` + `gg-agent` + `ogcoder` to spawn worker sessions.

> **Branch note (rebrand/abukhaled, 2026-05-05)**: The three core packages were renamed from `@kenkaiiii/{gg-ai,gg-agent,ggcoder}` to `@abukhaled/{gg-ai,gg-agent,ogcoder}` (binary renamed `ggcoder → ogcoder`). The auxiliary packages (`gg-editor`, `gg-boss`, `gg-pixel`) still publish under `@kenkaiiii/*` but their workspace deps and source imports were rewritten to point at `@abukhaled/*` so the monorepo builds. `gg-editor` currently has pre-existing typecheck errors on `main` (the auth-refactor commit calls a richer `renderLoginSelector` and `Footer` API that ggcoder hasn't shipped yet) — they merge through unchanged on this branch and are not regressions.

## Commands

```bash
pnpm build                          # Build all packages (tsup for gg-ai/gg-agent, tsc for ogcoder)
pnpm check                          # tsc --noEmit (all packages)
pnpm lint                           # ESLint
pnpm lint:fix                       # ESLint --fix
pnpm format                         # Prettier write
pnpm format:check                   # Prettier check
pnpm test                           # Vitest (all packages)

# Always run after editing any file:
pnpm check && pnpm lint && pnpm format:check

# Single package
pnpm --filter @abukhaled/gg-ai test          # Test one package
pnpm --filter @abukhaled/ogcoder test -- src/tools/read.test.ts  # Single test file
pnpm test -- -t "should read files"          # Test by name pattern
```

## Architecture

### Data Flow

`stream()` (gg-ai) → `agentLoop()` (gg-agent) → tools + session (ggcoder)

### gg-ai: Provider-Agnostic Streaming

- **Provider registry** (`provider-registry.ts` + `stream.ts`): Map-based dispatch. Built-in providers registered at module load: `anthropic` and `minimax` → `streamAnthropic()` (MiniMax uses an Anthropic-compatible endpoint); `openai`, `glm`, `moonshot`, `xiaomi`, `ollama`, `deepseek`, `openrouter` → `streamOpenAI()` with provider-specific baseUrl/config.
- **Message transform** (`providers/transform.ts`): Converts unified `Message[]` to provider format. Key quirks:
  - Anthropic: `toolu_*` IDs, `thinking` content blocks with signatures, tool results wrapped in user messages
  - OpenAI-compat: IDs remapped to `call_*` prefix, `reasoning_content` field (GLM/Moonshot only), tool results as `tool` role
  - GLM: merges user text into preceding tool messages to preserve thinking context
  - MiniMax: silently strips image/video/document content (unsupported)
- **StreamResult**: dual-interface — async iterable (`for await`) AND thenable (`await` for final response)
- **Zod → JSON Schema** (`utils/zod-to-json-schema.ts`): `z.toJSONSchema(schema)` with `$schema` key stripped. Bypassed when tool has `rawInputSchema` (MCP tools).
- **Test provider**: `providers/palsu.ts` — deterministic mock provider used in tests; `providers/openai-codex.ts` is a legacy OpenAI Codex endpoint variant.

### gg-agent: Agent Loop

`agentLoop()` is a pure async generator in `agent-loop.ts`:

1. Poll steering messages → 2. Transform context (compaction) → 3. Route model → 4. Repair tool pairing → 5. Call LLM with timeouts → 6. Extract & execute tools in parallel → 7. Loop on `tool_use` stop reason

**Error recovery**: context overflow → force compact + retry (3x), overload 429/529 → exponential backoff 2-30s (10x), stream stall → retry (5x) with tiered timeouts (45s first-event, 30s idle, 90s hard cap pre-output, 5min once output is flowing, 5-10min for thinking-heavy models), empty response → retry (2x), abort → graceful exit.

**Agent events**: `text_delta`, `thinking_delta`, `toolcall_delta`, `tool_call_start/update/end`, `turn_end`, `agent_done`, `retry` (with `silent` flag for hidden retries), `model_switch`, `steering_message`, `follow_up_message`, `server_tool_call/result`, `error`.

### ggcoder: CLI Application

- **Tools** (`tools/`): Factory functions returning `AgentTool<ZodSchema>`. Each tool gets `ToolOperations` interface for I/O abstraction (local fs by default, injectable for remote). Core tools: `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`, `web-fetch`, `web-search`. Advanced tools: `subagent` (spawns child `ogcoder` process in json-mode, streams NDJSON back), `skill` (injects skill markdown into context), `tasks`/`task-output`/`task-stop` (background task management), `enter-plan`/`exit-plan` (plan mode gating).
- **MCP** (`core/mcp/`): Servers configured with command (stdio) or url (HTTP/SSE with fallback). Tools wrapped as `AgentTool` with `mcp__${server}__${tool}` naming. Rate-limited (2s min gap).
- **Model router** (`core/model-router.ts`): Per-turn model switching. Modes: `vision` (auto-switch on images/video/docs), `plan-execute` (heavy planner + light executor), `hybrid` (vision priority, then plan-execute). Vision fallback chain: GLM-4.6V → MiMo Omni → Moonshot → OpenAI (Claude excluded for cost).
- **Compaction** (`core/compaction/compactor.ts`): Triggers at 80% context or `contextWindow - 16384` tokens (whichever is lower). Keeps system message + recent ~20K tokens intact. Middle section summarized via LLM. Falls back to extractive summary on failure.
- **Sessions** (`core/session-manager.ts`): Append-only JSONL with DAG structure (leafId for branching). Streams line-by-line for large files. `repairToolPairs()` fixes interrupted sessions on restore.
- **Auth** (`core/auth-storage.ts`, `core/oauth/`): OAuth PKCE for Anthropic and OpenAI (with token refresh + 401 retry); static API keys for GLM, Moonshot, Xiaomi, MiniMax, DeepSeek, Ollama, and OpenRouter. All credentials stored in `~/.gg/auth.json`. Provider selection at startup uses `resolveActiveProvider()` in `cli.ts` — falls back to the first authenticated provider if the saved one isn't logged in.
- **Themes** (`ui/theme/`): Six themes — `dark`, `light`, `dark-ansi`, `light-ansi`, `dark-daltonized`, `light-daltonized` — plus `auto` (detects from terminal). ANSI variants use 16-color palette for limited terminals; daltonized variants are color-blind friendly. `loadTheme(name)` in `theme.ts` returns the JSON config; `ThemeContext` + `useTheme()` for read, `SetThemeContext` + `useSetTheme()` for runtime switching.
- **UI**: Ink 6 + React 19. `useAgentLoop` hook drives the agent and surfaces events to React state. Throttled streaming flush at ~16ms intervals to avoid saturating renders. Markdown rendering uses `utils/token-to-ansi.ts` (custom tokenizer → ANSI) instead of marked-terminal for theme-aware output. Terminal hyperlinks via `utils/hyperlink.ts` (gated by `supports-hyperlinks.ts`). Cross-component state (taskbar, etc.) lives in `ui/stores/` using a tiny `create-store` pattern.
- **Debug logging**: `~/.gg/debug.log` — timestamped log of startup, auth, tool calls, turn completions, errors. Truncated on each CLI restart. Singleton logger in `src/core/logger.ts`.

### Execution Modes

All modes live in `ggcoder/src/modes/` and are dispatched from `cli.ts`:

- **interactive** (default): Ink/React terminal UI, full session management.
- **print**: Single-turn, streams output to stdout, no UI.
- **json**: Non-interactive NDJSON mode — each agent event is a JSON line on stdout. Used internally by the `subagent` tool when spawning child processes.
- **serve**: Telegram bot integration (`core/telegram.ts`). Maps chat IDs to project directories (`~/.gg/serve.json`). Voice messages transcribed locally via `core/voice-transcriber.ts` (Whisper-based, model downloaded on first use).
- **agent-home**: Persistent background agent workspace (`~/.gg/agent-home.json`), used for long-running autonomous sessions.
- **rpc**: JSON-RPC interface for programmatic control.

### Plan Mode

The plan mode system lets the agent propose a structured plan before executing. Tools: `enter-plan` (agent enters plan-drafting state, pauses execution) and `exit-plan` (submits the plan for user approval). UI components `PlanApproval`, `PlanBanner`, `PlanOverlay`, and `PlanProgress` render the approval flow. `/plan` and `/plans` slash commands are UI-handled (need `agentLoop.reset()` access).

### Extensibility: Agents, Skills, Custom Commands

All three systems discover markdown files with YAML frontmatter from two locations (merged, project-local wins on conflict):
- **Global**: `~/.gg/{agents,skills}/`
- **Project-local**: `{cwd}/.gg/{agents,skills}/`

**Agents** (`core/agents.ts`): Frontmatter keys: `name`, `description`, `tools` (comma-separated). Body is the system prompt. Two built-in agents seeded on first run (won't overwrite edits):
  - `owl` — read-only codebase explorer (tools: read, grep, find, ls, bash)
  - `bee` — general task worker (tools: read, write, edit, bash, find, grep, ls)

**Skills** (`core/skills.ts`): Frontmatter: `name`, `description`. Body is injected into context by the `skill` tool when the agent invokes it by name.

**Custom Commands** (`core/custom-commands.ts`): User-defined slash commands loaded alongside built-ins. Frontmatter: `name`, `description`. Body defines behavior.

### Eyes — Perception Probes (`ggcoder-eyes`)

Project-agnostic probes that let the agent *see* what's happening in the running project (UI screenshots, runtime logs, HTTP responses, captured emails) and persist signals it would otherwise have to guess about.

- **Activation gate**: `isEyesActive(cwd)` checks for `.gg/eyes/manifest.json`. The system prompt only injects the "Open Improvement Signals" section when active, so projects without eyes pay no prompt cost.
- **CLI**: invoked from agents as `ogcoder eyes <subcommand>` (passes through to the `@abukhaled/ggcoder-eyes` CLI via `_require.resolve(...)/cli`). `ogcoder` is guaranteed on PATH for the agent's bash shell, which avoids nested-bin visibility issues in global pnpm/npm installs.
- **Journal**: `readJournal({ status, order, limit }, cwd)` / `journalCount(...)` over `.gg/eyes/journal.jsonl`. Open entries surface in the startup banner ("👁 Eyes: N open improvement signals — run /eyes-improve to triage") and in the `EyesOverlay` UI component.
- **Probes** (each is a self-contained shell module with `install.sh` / `detect.sh` / `test.sh` and platform impls under `impl/`): `visual` (simctl / adb / window / playwright / generic), `runtime_logs` (tail / docker / simctl / adb-logcat), `http` (curl), `capture_email` (mailpit). Add a probe by dropping a new directory under `packages/ggcoder-eyes/probes/`.
- **Slash commands**: `/setup-eyes` (install probes for the current project) and `/eyes-improve` (triage open journal signals into actionable improvements). Both are loaded from `core/prompt-commands.ts`.

### Slash Commands

Two kinds — UI-handled take precedence over registry:

1. **UI-handled** — see `handleSubmit` in `ggcoder/src/ui/App.tsx`. These short-circuit before the registry because they need direct React state access (overlays, token counters, `agentLoop.reset()`).
2. **Registry** — see `createBuiltinCommands()` in `ggcoder/src/core/slash-commands.ts`. Receive a `SlashCommandContext` with methods like `switchModel()`, `compact()`, `newSession()`.

To add a UI command: add a condition in `handleSubmit` before the registry check.
To add a registry command: add an entry in `createBuiltinCommands()` array. If it needs new capabilities, extend `SlashCommandContext` and wire it in `AgentSession.createSlashCommandContext()`.

## Key Patterns

- **StreamResult/AgentStream**: dual-nature objects — async iterable (`for await`) + thenable (`await`)
- **EventStream**: push-based async iterable in `@abukhaled/gg-ai/utils/event-stream.ts`
- **agentLoop**: pure async generator — call LLM, yield deltas, execute tools, loop on tool_use
- **resolveActiveProvider**: `cli.ts` helper that picks the logged-in provider at startup with fallback
- **Zod schemas**: tool parameters defined with Zod, converted to JSON Schema at provider boundary

## Pixel — error tracking + auto-fix queue

`@kenkaiiii/gg-pixel` is a drop-in error tracking SDK. Errors flow to a Cloudflare Worker (`gg-pixel-server`) backed by D1. `ogcoder pixel` opens an in-Ink overlay that lists open errors per project and hands each one off to the existing agent loop — same UX as the Task pane.

### CLI

```bash
ogcoder pixel install          # Detect framework, wire up SDK + .env, register project key
ogcoder pixel                  # Open the in-Ink overlay (also: Ctrl+E inside running ogcoder)
ogcoder pixel fix <error_id>   # Fix one error end-to-end (subprocess flow, for non-TTY use)
ogcoder pixel run              # Auto-fix every open error (non-interactive)
```

### In-Ink fix flow (the main path)

`Ctrl+E` from inside ogcoder, or `ogcoder pixel`, opens `PixelOverlay`. Keys: `↑↓ navigate · Enter fix one · f fix all · d delete · Esc close`.

When a fix starts, `startPixelFix(errorId)` in `App.tsx` swaps four things in lockstep before calling `agentLoop.run(prep.prompt)`: `process.chdir(prep.projectPath)`, rebuild all cwd-baked tools, swap system prompt with new project root, and update `setDisplayedCwd` (also bump `staticKey` so Banner remounts). Reset chat state AFTER chdir is committed.

`onDone` in `useAgentLoop` finalizes the fix: `finalizePixelFix(prep)` observes the `fix/pixel-{id}` branch + commits and patches the D1 status to `awaiting_review` or `failed`. Run-all picks up the next open error via the same path.

### Backend

`packages/gg-pixel-server/` — Hono on Workers + D1. Routes: `POST /ingest` (SDK auth via publishable `project_key`, dedupes by `(project_id, fingerprint)`, capped at 10K unique fingerprints); `POST /api/projects` (rate-limited, returns `{ id, key, secret }`); `GET/PATCH/DELETE /api/errors/:id` and `GET /api/projects/:id/errors` (all bearer-authed via project secret, scoped to owner). `~/.gg/projects.json` stores `{ name, path, secret }` per project.

## Organization Rules

- Types → `types.ts` in each package
- Providers → `providers/` in gg-ai, one file per provider
- Tools → `tools/` in ggcoder, one file per tool
- UI components → `ui/components/`, one per file
- OAuth flows → `core/oauth/`, one per provider
- Tests → co-located with source files

## Publishing

Publish in dependency order. The three core packages (`gg-ai`, `gg-agent`, `ogcoder`) must share the same version. `ggcoder-eyes` versions independently.

```bash
pnpm build
pnpm --filter @abukhaled/gg-ai publish --no-git-checks
pnpm --filter @abukhaled/gg-agent publish --no-git-checks
pnpm --filter @abukhaled/ggcoder-eyes publish --no-git-checks
pnpm --filter @abukhaled/ogcoder publish --no-git-checks
```

All packages use `"publishConfig": { "access": "public" }` (required for scoped packages). Use `--no-git-checks` to skip git dirty/tag checks.
