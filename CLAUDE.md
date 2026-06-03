# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Last updated:** 2026-06-03 — Synced from main (main@1277132), version 4.3.243, with @abukhaled namespace preservation. Major upstream changes in this sync: **multimodal expansion** — gg-ai now has a first-class `gemini` provider (`providers/gemini.ts` + `streamGemini`, registered in `stream.ts`; OAuth via `core/oauth/gemini.ts`), and **native video** support across the transport layer (`VideoContent` accepted by MiniMax-M3 over the Anthropic transport and by Moonshot/GLM-5V via OpenAI-compatible `video_url`; non-video models are downgraded to text by `downgradeUnsupportedVideos`). The MiniMax model was renamed **M2.7 → M3** (1M context, image + video), and new vision models were added (GLM-4.6V family, Xiaomi MiMo V2 Omni/Flash). `model-registry.ts` capability flags `supportsVideo`/`supportsDocuments` are **optional** in the @abukhaled registry (omitted ⇒ unsupported). Video attachments flow through the chat input via `extractMediaPaths` (formerly `extractImagePaths`, kept as an alias) and `VIDEO_MEDIA_TYPES` in `utils/image.ts`. New error helper `isHardBillingMessage` (gg-ai `errors.ts`). Logo rendering was consolidated into the shared `renderLogoBlock` helper (`cli/shared.ts`), used by serve/agent-home modes, login, pixel, sessions, and mcp screens — OG Coder keeps a blank (text-only) logo. New `experiments/prompt-bench/` harness for prompt/tools-section A/B benchmarking.

**@abukhaled-preserved feature: PDF documents.** gg-ai carries a `DocumentContent` block type (PDF base64) that upstream's `M3` video work does not have. It is wired through `transform.ts` (Anthropic `document` block; OpenAI `file` content part) and `UserMessage` content. When resolving future merges, keep `DocumentContent` in `types.ts`/`index.ts` and the document branches in `transform.ts` (`stripImages`/`stripVideos` strip it for non-vision/non-video models).

## Project

**gg-framework** — Modular TypeScript monorepo for building LLM-powered apps, from raw streaming to a full CLI coding agent.

| Package | npm | Description |
|---|---|---|
| `packages/gg-ai` | `@abukhaled/gg-ai` | Unified LLM streaming API (Anthropic + OpenAI-compatible providers) |
| `packages/gg-agent` | `@abukhaled/gg-agent` | Agent loop with tool execution |
| `packages/ggcoder` | `@abukhaled/ogcoder` | CLI coding agent (`ogcoder` binary) |
| `packages/ggcoder-eyes` | `@abukhaled/ggcoder-eyes` | Project-agnostic perception probes — screenshots, logs, HTTP, capture sinks |
| `packages/gg-voice` | `@kenkaiiii/gg-voice` | Provider-agnostic realtime voice orchestration for GG tools/agents |
| `packages/gg-pixel` | `@kenkaiiii/gg-pixel` | Universal error tracking SDK (Node + Browser + Deno + Workers) |
| `packages/gg-pixel-server` | (private — Cloudflare Worker) | Ingest backend (Workers + D1) |
| `packages/gg-pixel-{go,py,rb,rs,swift}` | (native) | Language ports of the gg-pixel SDK (Go, Python, Ruby, Rust, Swift) — **not** pnpm workspaces; built with their own toolchains |
| `packages/gg-editor` | `@kenkaiiii/gg-editor` | Video editing agent (DaVinci Resolve / Premiere) |
| `packages/gg-editor-premiere-panel` | `@kenkaiiii/gg-editor-premiere-panel` | CEP panel bridge for Premiere |
| `packages/gg-boss` | `@kenkaiiii/gg-boss` | Orchestrator (`ggboss` binary) — drives multiple ogcoder workers across projects from one chat |
| `Matey` | `matey` (private) | Electron desktop app (top-level dir, not under `packages/`); included in lint/format/build scope |

**Dependency chain**: `gg-ai` → `gg-agent` → `ogcoder` (with `ggcoder-eyes` as a sibling perception layer consumed by `ogcoder`). `gg-boss` consumes `gg-ai` + `gg-agent` + `ogcoder` to spawn worker sessions. `gg-voice` provides voice transcription consumed by ogcoder's serve mode.

**Workspace globs** (`pnpm-workspace.yaml`): `packages/*`, `Matey`, `experiments/*`. The native pixel ports (`gg-pixel-{go,py,rb,rs,swift}`) have no `package.json`, so `pnpm -r` skips them.

## Development Approach

**og-framework** is being developed as an independent product under the `@abukhaled` scope. Currently in Phase 1 (learning-first development):

- **Branch strategy**: `main` = independent codebase. `rebrand/abukhaled` = temporary feature branch (will rebase onto main when ready to diverge completely).
- **Selective cherry-picks**: When useful code appears in upstream, cherry-pick it into main as needed.
- **Build method**: Build from source locally via `pnpm build`, then link globally with `pnpm --filter @abukhaled/ogcoder link --global`. This avoids npm dependency lock-in until publishing infrastructure is ready.
- **Three phases**:
  1. **Phase 1 (now)**: Learn codebase deeply by working with a copy. Understand agent loop, LLM streaming, tool execution, UI patterns.
  2. **Phase 2 (future)**: Implement own features and improvements as expertise grows. Diverge from upstream where beneficial.
  3. **Phase 3 (long-term)**: Publish independently to npm under `@abukhaled` scope.

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
pnpm --filter matey lint                     # The Matey Electron app lints separately
```

`lint`/`format` cover both `packages/*/src/**` and the top-level `Matey/**`; `build`/`check`/`test` run recursively (`pnpm -r`) across all workspace packages. `ggcoder` builds with `tsc`; `gg-ai`/`gg-agent`/`gg-voice`/`gg-boss` build with `tsup` (ESM + CJS + DTS).

## Architecture

### Data Flow

`stream()` (gg-ai) → `agentLoop()` (gg-agent) → tools + session (ggcoder)

### gg-ai: Provider-Agnostic Streaming

- **Provider registry** (`provider-registry.ts` + `stream.ts`): Map-based dispatch. Built-in providers registered at module load: `anthropic` and `minimax` → `streamAnthropic()` (MiniMax-M3 uses an Anthropic-compatible endpoint); `gemini` → `streamGemini()` (native Gemini transport, OAuth via `core/oauth/gemini.ts`); `openai`, `glm`, `moonshot`, `xiaomi`, `ollama`, `deepseek`, `openrouter` → `streamOpenAI()` with provider-specific baseUrl/config.
- **Message transform** (`providers/transform.ts`): Converts unified `Message[]` to provider format. Key quirks:
  - Anthropic: `toolu_*` IDs, `thinking` content blocks with signatures, tool results wrapped in user messages
  - OpenAI-compat: IDs remapped to `call_*` prefix, `reasoning_content` field (GLM/Moonshot only), tool results as `tool` role
  - GLM: merges user text into preceding tool messages to preserve thinking context
  - Video: `VideoContent` rides Anthropic transport for MiniMax-M3 and `video_url` content parts for Moonshot/GLM-5V; `downgradeUnsupportedVideos` swaps video → text placeholder for non-video models before transform
  - Documents: `DocumentContent` (PDF) → Anthropic `document` block / OpenAI `file` content part; `stripImages`/`stripVideos` strip it for models lacking vision/video
- **StreamResult**: dual-interface — async iterable (`for await`) AND thenable (`await` for final response)
- **Zod → JSON Schema** (`utils/zod-to-json-schema.ts`): `z.toJSONSchema(schema)` with `$schema` key stripped. Bypassed when tool has `rawInputSchema` (MCP tools).
- **Test provider**: `providers/palsu.ts` — deterministic mock provider used in tests; `providers/openai-codex.ts` is a legacy OpenAI Codex endpoint variant.

### gg-agent: Agent Loop

`agentLoop()` is a pure async generator in `agent-loop.ts`:

1. Poll steering messages → 2. Transform context (compaction) → 3. Route model → 4. Repair tool pairing → 5. Call LLM with timeouts → 6. Extract & execute tools in parallel → 7. Loop on `tool_use` stop reason

**Error recovery**: context overflow → force compact + retry (3x), overload 429/529 → exponential backoff 2-30s (10x), stream stall → retry (5x) with tiered timeouts (45s first-event, 30s idle, 90s hard cap pre-output, 5min once output is flowing, 5-10min for thinking-heavy models), empty response → retry (2x), abort → graceful exit.

**Agent events**: `text_delta`, `thinking_delta`, `toolcall_delta`, `tool_call_start/update/end`, `turn_end`, `agent_done`, `retry` (with `silent` flag for hidden retries), `model_switch`, `steering_message`, `follow_up_message`, `server_tool_call/result`, `error`.

### ggcoder: CLI Application

- **Tools** (`tools/`): Factory functions returning `AgentTool<ZodSchema>`. Each tool gets `ToolOperations` interface for I/O abstraction (local fs by default, injectable for remote). Core tools: `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`, `web-fetch`, `web-search`. Content tools: `web-fetch` (multi-URL with bounded concurrency, Markdown extraction via `html-extract.ts` using turndown, PDF text via `pdf-extract.ts` using unpdf, prefers `/llms.txt` for docs), `screenshot` (Playwright-driven page capture). Advanced tools: `subagent` (spawns child `ogcoder` process in json-mode, streams NDJSON back), `skill` (injects skill markdown into context), `tasks`/`task-output`/`task-stop` (background task management), `enter-plan`/`exit-plan` (plan mode gating).
- **MCP** (`core/mcp/`): Servers configured with command (stdio) or url (HTTP/SSE with fallback). Tools wrapped as `AgentTool` with `mcp__${server}__${tool}` naming. Rate-limited (2s min gap).
- **Model router** (`core/model-router.ts`): Per-turn model switching. Modes: `vision` (auto-switch on images/video/docs), `plan-execute` (heavy planner + light executor), `hybrid` (vision priority, then plan-execute). Vision fallback chain: GLM-4.6V → MiMo Omni → Moonshot → OpenAI (Claude excluded for cost).
- **Compaction** (`core/compaction/compactor.ts`): Triggers at 80% context or `contextWindow - 16384` tokens (whichever is lower). Keeps system message + recent ~20K tokens intact. Middle section summarized via LLM. Falls back to extractive summary on failure.
- **Sessions** (`core/session-manager.ts`): Append-only JSONL with DAG structure (leafId for branching). Streams line-by-line for large files. `repairToolPairs()` fixes interrupted sessions on restore.
- **Auth** (`core/auth-storage.ts`, `core/oauth/`): OAuth PKCE for Anthropic and OpenAI (with token refresh + 401 retry); static API keys for GLM, Moonshot, Xiaomi, MiniMax, DeepSeek, Ollama, and OpenRouter. All credentials stored in `~/.gg/auth.json`. Provider selection at startup uses `resolveActiveProvider()` in `cli.ts` — falls back to the first authenticated provider if the saved one isn't logged in.
- **Themes** (`ui/theme/`): Six themes — `dark`, `light`, `dark-ansi`, `light-ansi`, `dark-daltonized`, `light-daltonized` — plus `auto` (detects from terminal). ANSI variants use 16-color palette for limited terminals; daltonized variants are color-blind friendly. `loadTheme(name)` in `theme.ts` returns the JSON config; `ThemeContext` + `useTheme()` for read, `SetThemeContext` + `useSetTheme()` for runtime switching.
- **UI**: Ink 6 + React 19. `useAgentLoop` hook drives the agent and surfaces events to React state. Throttled streaming flush at ~16ms intervals to avoid saturating renders. Markdown rendering uses `utils/token-to-ansi.ts` (custom tokenizer → ANSI) instead of marked-terminal for theme-aware output. Terminal hyperlinks via `utils/hyperlink.ts` (gated by `supports-hyperlinks.ts`). Cross-component state (taskbar, etc.) lives in `ui/stores/` using a tiny `create-store` pattern. **Recent refactoring** splits rendering logic into focused modules: `app-items.ts` (unified item types), `layout-decisions.ts` (layout routing per state), `item-helpers.ts` (item transforms), `terminal-history-format.ts`/`terminal-history-spacing.ts`/`terminal-history-status-renderers.ts` (separated terminal rendering concerns). `ui/thinking-level.ts` manages thinking level cycling per model.
- **Live item flushing** (`ui/live-item-flush.ts`): Ink re-renders all live items on every state change, so unbounded growth causes expensive cursor math and visible jank. Items are flushed to `Static` history when safe — after turns complete, on overflow, or when tool-only turns finish. The `liveItems` state array is kept under ~8 items by aggressive overflow flushing. Flushed items' large payloads (tool results, server data) are trimmed to prevent multi-GB memory retention.
- **Ink layout pitfalls**: Avoid `flexShrink={1}` on small status message items (info, error, plan_transition, etc.) — when combined with parent `flexGrow={1}`, it causes Ink's layout calculator to miscalculate available space, clipping subsequent items. These resolve only on window resize. Status messages should have no shrink directive.
- **Static + history**: The `<Static>` component (Ink's write-once history area) is keyed with `resizeKey` and `staticKey` to handle terminal resize and overlay transitions. When overlays open, history is hidden by rendering an empty items array. Use `setStaticKey((k) => k + 1)` to force a Static re-mount (used when closing overlays or handling pixel fix transitions).
- **SessionStore pattern** (`App.tsx`): React state (history, messages, planSteps, sessionTitle, overlay, runAllTasks, etc.) is mirrored to an external `sessionStore` object via useEffects. This allows state to survive `resetUI()` remounts (e.g., when starting a task, closing an overlay, or beginning pixel fixes). Always sync new stateful features through this pattern — initialize from `props.sessionStore?.key ?? default`, and add a `useEffect(() => { if (sessionStore) sessionStore.key = localState; }, [localState, sessionStore])`.
- **Tasks run-all**: Ctrl+T → r spawns tasks sequentially. The `runAllTasks` state flag must be persisted via sessionStore so it survives the component remount after the first task completes (see pattern above). Without this, only the first task would run.
- **Debug logging**: `~/.gg/debug.log` — timestamped log of startup, auth, tool calls, turn completions, errors. Truncated on each CLI restart. Singleton logger in `src/core/logger.ts`.

### CLI Command Routing

`cli/command-routing.ts` abstracts execution mode dispatch logic — routes arguments like `json`, `serve`, `agent-home`, `rpc`, `pixel`, and default `interactive` mode. Tests in `cli/command-routing.test.ts` ensure arguments are parsed correctly for each mode.

### Execution Modes

All modes live in `ggcoder/src/modes/` and are dispatched via command routing:

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

### Checkpoints & Rewind

> **Note:** The standalone Goals System (goal-store/goal-worker/goal-worktree/goal-verifier/goal-prerequisites and the `/goals` UI) was **removed** upstream in the 4.3.237 sync (2026-06-01). Its responsibilities are now covered by lighter, focused modules below plus the existing Task Management System.

- **Checkpoint Store** (`core/checkpoint-store.ts`): Snapshots conversation/work state so the agent can roll back. Backs the `RewindOverlay` UI and the `checkpoint-hook` that captures restore points around risky edits.
- **Loop Breaker** (`core/loop-breaker.ts`): Detects repetition in the agent's output — `detectTextRepetition()` and `toolCallSignature()` flag when the model is stuck repeating text or identical tool calls (`LoopBreakStats`), surfaced through `useAgentLoop`.
- **Regrounding** (`core/regrounding.ts`): Periodically re-anchors the agent to the original task to counter drift on long runs.
- **Ideal Review** (`core/ideal-review.ts`): Produces `IdealReviewStats` and an `IdealHookMessage` that nudge the agent toward higher-quality completion before declaring done.

### Task Management System

A lightweight persistent task queue for agents to manage work items within a session.

- **Task Store** (`core/tasks-store.ts`): Persists tasks in `~/.gg-tasks/projects/{hash}/tasks.json`. Each task has `id`, `title`, `prompt`, `status` (pending/in-progress/done), `createdAt`. The prompt is the standalone instruction sent to a task agent — it should be complete and context-free.
- **Tasks Tool** (`tools/tasks.ts`): Agent tool with actions: `add` (title + prompt), `list`, `done` (mark complete), `remove`. Tasks are stored per-project and persist across sessions. The UI renders pending tasks in the task pane; agents see them via the tool.
- **Task Execution**: When a task is picked via UI (Ctrl+T), a new agent session opens with the task prompt as input. On completion, the task is marked done and the next one can be picked. Tasks are NOT related to goals — they're for ad-hoc work queuing within a session.

### Slash Commands

Two kinds — UI-handled take precedence over registry:

1. **UI-handled** — see `handleSubmit` in `ggcoder/src/ui/App.tsx`. These short-circuit before the registry because they need direct React state access (overlays, token counters, `agentLoop.reset()`).
2. **Registry** — see `createBuiltinCommands()` in `ggcoder/src/core/slash-commands.ts`. Receive a `SlashCommandContext` with methods like `switchModel()`, `compact()`, `newSession()`.

To add a UI command: add a condition in `handleSubmit` before the registry check.
To add a registry command: add an entry in `createBuiltinCommands()` array. If it needs new capabilities, extend `SlashCommandContext` and wire it in `AgentSession.createSlashCommandContext()`.

## Code Quality

After code changes that need compiled outputs, also run `pnpm build`.

Fix errors from checks you do run before continuing. Quick fixes:
- `pnpm lint:fix` — auto-fix ESLint issues
- `pnpm format` — auto-fix Prettier formatting
- Use `/fix` to run all checks and spawn parallel agents to fix issues

## Key Patterns

- **StreamResult/AgentStream**: dual-nature objects — async iterable (`for await`) + thenable (`await`)
- **EventStream**: push-based async iterable in `@abukhaled/gg-ai/utils/event-stream.ts`
- **agentLoop**: pure async generator — call LLM, yield deltas, execute tools, loop on tool_use
- **resolveActiveProvider**: `cli.ts` helper that picks the logged-in provider at startup with fallback
- **Zod schemas**: tool parameters defined with Zod, converted to JSON Schema at provider boundary

## MCP Servers

`ggcoder mcp` adds and manages Model Context Protocol servers. Configs are stored in the same `{ "mcpServers": { … } }` shape Claude Code uses, so they're portable both directions.

### Scopes & file locations

- **Global** → `~/.gg/mcp.json` — available in all OG Coder sessions.
- **Project** → `./.gg/mcp.json` — only the current project root.
- On a name collision, **project wins**. Provider defaults (e.g. `kencode-search`) stay authoritative — a user server can only add a new name, never override a default.

### Commands

```bash
ogcoder mcp                              # interactive dashboard (🟢/🔴 status, tool counts, scope)
ogcoder mcp list                         # list servers with live connection status
ogcoder mcp get <name>                   # show one server's config (secrets masked)
ogcoder mcp add <args…>                  # add a server (claude-compatible grammar)
ogcoder mcp remove <name> [--scope s]    # remove a server
```

The `add` grammar mirrors `claude mcp add` 1:1 — you can paste a `claude mcp add …` (or `ogcoder mcp add …`) line and the prefix is stripped automatically:

```bash
ogcoder mcp add --transport http notion https://mcp.notion.com/mcp
ogcoder mcp add --transport sse asana https://mcp.asana.com/sse
ogcoder mcp add --env AIRTABLE_API_KEY=key airtable -- npx -y airtable-mcp-server
```

`--scope user` maps to global; `local`/`project` map to project. Code lives in `core/mcp/` (`store.ts` persistence, `parse-add-command.ts` parser, `client.ts` `connectAllDetailed`/`probe`) and `cli/mcp.ts` + `ui/mcp.tsx`.

### Caveats

- **Connection is startup-only.** MCP connects once at launch (`connectInitialMcpTools` in `cli.ts`). Adding a server via `ogcoder mcp` mid-session won't hot-load it — restart ogcoder.
- **Pixel chdir flow.** Project-scoped servers load relative to `process.cwd()` at startup. The Pixel fix flow swaps cwd mid-session (`process.chdir` + `rebuildToolsForCwd`); project MCP servers won't follow that swap.
- **WebSocket transport** is parsed but rejected (no WS client today).
- **Env var expansion** (`${VAR}`) in `.mcp.json` is NOT expanded in v1 — values pass through literally.

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
