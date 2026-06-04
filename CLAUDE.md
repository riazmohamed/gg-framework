# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**gg-framework** — Modular TypeScript monorepo for building LLM-powered apps, from raw streaming to a full CLI coding agent.

| Package                 | npm                       | Description                                                          |
| ----------------------- | ------------------------- | -------------------------------------------------------------------- |
| `packages/gg-ai`        | `@abukhaled/gg-ai`        | Unified LLM streaming API (Anthropic, OpenAI, Gemini)                |
| `packages/gg-agent`     | `@abukhaled/gg-agent`     | Agent loop with tool execution                                       |
| `packages/ggcoder`      | `@abukhaled/ogcoder`      | CLI coding agent (`ogcoder` binary)                                  |
| `packages/ggcoder-eyes` | `@abukhaled/ggcoder-eyes` | Project-agnostic perception probes (screenshots, logs, HTTP capture) |

**Dependency chain**: `gg-ai` → `gg-agent` → `ogcoder` (uses `ggcoder-eyes` for perception)

Current published version: **4.3.217** (last app-update sync: 2026-05-25 from `main`).

This windows fork is a slimmer subset of the upstream `kenkaiiii/gg-framework`: it keeps only `gg-ai`, `gg-agent`, `ggcoder` (binary `ogcoder`), and `ggcoder-eyes`. Upstream packages introduced after the previous sync (`gg-boss`, `gg-pixel`, `gg-pixel-server`, `gg-editor`, `gg-editor-premiere-panel`, and pixel-language variants `gg-pixel-go`/`-py`/`-rb`/`-rs`/`-swift`, `gg-voice`) and the in-app Pixel error-tracking flow (`pixel.ts`, `pixel-fix.ts`, `PixelOverlay.tsx`, `core/auth/index.ts`, `utils/open-browser.ts`) are intentionally excluded. When merging from upstream, drop those packages/files and rewrite any `@kenkaiiii/*` workspace imports to `@abukhaled/*`. Prefer merging from `rebrand/abukhaled` over `main` — it already carries the `@abukhaled` scope rewrites.

### Brand

User-visible name is **"OG Coder by abukhaled"** — rendered with the "OG" ASCII logo by the TUI banner in `terminal-history.ts` and by the duplicate help-screen banner in `cli.ts` (printed for `ogcoder --help`). The Goal-mode system prompts and the default agent identity in `system-prompt.ts` use **"OG Coder by Abu Khaled"** (title-case attribution) — that form is reserved for prompts the agent reads about itself; everything the human sees uses lowercase "abukhaled".

The literal string `"ggcoder"` is still load-bearing in several internal places and must NOT be rebranded:

- `ErrorSource` discriminator in `packages/gg-ai/src/errors.ts` and the `f.source === "ggcoder"` comparison in `App.tsx`
- Default `promptCacheKey` in the OpenAI / OpenAI-Codex providers (stable cache routing)
- `/tmp/ggcoder-img-*` temp-file naming
- The `@abukhaled/ggcoder-eyes` package import and the `packages/ggcoder/` directory name
- `GGCODER_BUG_REPORT_URL` in `App.tsx` (still points at the upstream issue tracker — no fork-owned tracker has been set up)

When upstream merges reintroduce "GG Coder" / "Ken Kai" / "ggcoder" in user-visible strings, rebrand only those — leave the internal IDs alone.

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

# Single test file — use `exec vitest` directly.
# `pnpm --filter <pkg> test -- <path>` does NOT forward the path; it runs the
# whole suite. Use `exec vitest run <path>` instead:
pnpm --filter @abukhaled/ogcoder exec vitest run src/tools/read.test.ts

# Test by name pattern
pnpm --filter @abukhaled/ogcoder exec vitest run -t "should read files"
```

## Code Quality — Zero Tolerance

Run targeted verification that is appropriate to the change before calling work complete. Do not run the full quality suite after every edit by default; reserve it for broad code changes, release work, or when explicitly requested.

For full verification, use:

```bash
pnpm check && pnpm lint && pnpm format:check
```

Fix ALL errors before continuing. Quick fixes: `pnpm lint:fix` and `pnpm format`.

## Architecture

### Data Flow

`stream()` (gg-ai) → `agentLoop()` (gg-agent) → tools + session (ggcoder)

### gg-ai: Provider-Agnostic Streaming

- **Provider registry** (`provider-registry.ts` + `stream.ts`): Map-based dispatch. Built-in providers registered at module load: `anthropic` and `minimax` → `streamAnthropic()` (MiniMax uses an Anthropic-compatible endpoint); `openai`, `glm`, `moonshot`, `xiaomi`, `ollama`, `deepseek`, `openrouter` → `streamOpenAI()` with provider-specific baseUrl/config. Extensions can register custom providers via `providerRegistry.register()`.
- **Fail-fast dispatch**: Provider handlers must throw `ProviderError` when required config is missing (e.g. region-scoped `baseUrl`) rather than silently defaulting. Silent fallbacks mask real failures — the canonical example is `xiaomi`, whose keys are region-scoped and which throws if `baseUrl` is not supplied.
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
- **Compaction** (`core/compaction/compactor.ts`): Triggers at 80% context or `contextWindow - 16384` tokens (whichever is lower). Keeps system message + recent ~20K tokens intact. Middle section summarized via LLM (tool calls → text, thinking stripped, results truncated). Falls back to extractive summary on failure.
- **Sessions** (`core/session-manager.ts`): Append-only JSONL with DAG structure (leafId for branching). Streams line-by-line for large files. `repairToolPairs()` fixes interrupted sessions on restore.
- **Auth**: OAuth PKCE for Anthropic and OpenAI; static API keys for GLM, Moonshot, Xiaomi, MiniMax, Ollama, DeepSeek, and OpenRouter. All credentials stored in `~/.gg/auth.json` (file mode `0o600`, written atomically with a file lock via `core/auth-storage.ts`). Xiaomi keys are **region-scoped** — the correct regional `baseUrl` must be captured at login via `core/xiaomi-regions.ts` (a key from `ams` returns 401 on `sgp`). The `runLogin()` flow in `cli.ts` runs a region selector before opening readline; raw-mode Ink-style selectors (see `ui/login.tsx`) cannot coexist with an active readline interface.
- **Models**: Defined in `core/model-registry.ts`. Each `ModelInfo` carries a `maxThinkingLevel: ThinkingLevel` field used by `getMaxThinkingLevel()` to pick the strongest reasoning tier per model. Vision-routing pairs: `mimo-v2-pro` (text) ↔ `mimo-v2-omni`/`mimo-v2-flash` (vision); GLM `glm-5.1`/`glm-4.7` (text) ↔ `glm-4.6v`/`glm-5v-turbo`/`glm-4.6v-flashx`/`glm-4.6v-flash` (vision). MiniMax M2.7 reports `supportsImages: false` because the Anthropic-compat endpoint silently drops multimodal blocks.
- **Themes** (`ui/theme/`): Six themes — `dark`, `light`, `dark-ansi`, `light-ansi`, `dark-daltonized`, `light-daltonized` — plus `auto` (detects from terminal). ANSI variants use 16-color palette for limited terminals; daltonized variants are color-blind friendly. `loadTheme(name)` in `theme.ts` returns the JSON config; `ThemeContext` + `useTheme()` for read, `SetThemeContext` + `useSetTheme()` for runtime switching.
- **UI**: Ink 6 + React 19. `useAgentLoop` hook drives the agent and surfaces events to React state. Throttled streaming flush at ~16ms intervals to avoid saturating renders. Markdown rendering uses `utils/token-to-ansi.ts` (custom tokenizer → ANSI) instead of marked-terminal for theme-aware output. Terminal hyperlinks via `utils/hyperlink.ts` (gated by `supports-hyperlinks.ts`). Cross-component state (taskbar, etc.) lives in `ui/stores/` using a tiny `create-store` pattern. Slash commands split between UI-handled (`App.tsx`: `/model`, `/compact`, `/quit`, `/clear`) and registry (`core/slash-commands.ts`: `/help`, `/settings`, `/session`, `/new`, `/router`).
- **Live item flushing** (`ui/live-item-flush.ts`): Ink re-renders all live items on every state change, so unbounded growth causes expensive cursor math and visible jank. Items are flushed to `Static` history when safe — after turns complete, on overflow, or when tool-only turns finish. The `liveItems` state array is kept under ~8 items by aggressive overflow flushing. Flushed items' large payloads (tool results, server data) are trimmed to prevent multi-GB memory retention.
- **Ink layout pitfalls**: Avoid `flexShrink={1}` on small status message items (info, error, plan_transition, etc.) — when combined with parent `flexGrow={1}`, it causes Ink's layout calculator to miscalculate available space, clipping subsequent items. These resolve only on window resize. Status messages should have no shrink directive.
- **Static + history**: The `<Static>` component (Ink's write-once history area) is keyed with `resizeKey` and `staticKey` to handle terminal resize and overlay transitions. When overlays open, history is hidden by rendering an empty items array. Use `setStaticKey((k) => k + 1)` to force a Static re-mount.
- **SessionStore pattern** (`App.tsx`): React state (history, messages, planSteps, sessionTitle, overlay, runAllTasks, etc.) is mirrored to an external `sessionStore` object via useEffects. This allows state to survive `resetUI()` remounts (e.g., when starting a task, closing an overlay). Always sync new stateful features through this pattern — initialize from `props.sessionStore?.key ?? default`, and add a `useEffect(() => { if (sessionStore) sessionStore.key = localState; }, [localState, sessionStore])`.
- **Tasks run-all**: Ctrl+T → r spawns tasks sequentially. The `runAllTasks` state flag must be persisted via sessionStore so it survives the component remount after the first task completes.
- **Debug logging**: `~/.gg/debug.log` — timestamped log of startup, auth, tool calls, turn completions, errors. Truncated on each CLI restart. Singleton logger in `src/core/logger.ts`.
- **Language style packs** (`core/language-detector.ts` + `core/style-packs/`): Detects active languages per-project (TS, Python, Rust, etc.) and injects per-language guidance into the system prompt. `core/verify-commands.ts` discovers concrete typecheck/lint/test commands for each detected language so the model has explicit feedback-loop anchors.
- **Errors**: User-facing errors flow through `formatError()` (gg-ai) → `toErrorItem()` (App.tsx), which logs the full structured error into `~/.gg/debug.log` and routes ggcoder bugs to the fork's issue tracker.
- **Eyes (`packages/ggcoder-eyes`)**: Perception probes the agent invokes via the `ggcoder eyes ...` passthrough in `cli.ts`. Probes live in `probes/<name>/impl/*.sh`, with `detect.sh`, `install.sh`, and `test.sh` per probe. The agent reads `isEyesActive`/`journalCount`/`readJournal` from `@abukhaled/ggcoder-eyes`; `EyesOverlay.tsx` renders the live journal in the TUI.
- **Startup** (`cli.ts`): Optimized for fast time-to-interactive. Key patterns:
  - Auto-update check is fire-and-forget (never blocks)
  - OSC 11 theme detection is skipped on WSL (always times out)
  - Only the active provider's credentials are resolved at startup; other providers are checked locally without network calls
  - MCP server connections are deferred — started in background, tools merged into UI via `pendingMCPTools` promise + `useEffect`
  - Session resume path, agent/skill discovery, and directory creation all run in parallel

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

## MCP Servers

`ogcoder mcp` adds and manages Model Context Protocol servers. Configs are stored in the same `{ "mcpServers": { … } }` shape Claude Code uses, so they're portable both directions.

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
- **WebSocket transport** is parsed but rejected (no WS client today).
- **Env var expansion** (`${VAR}`) in `.mcp.json` is NOT expanded in v1 — values pass through literally.

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

Global install for local testing: `cd packages/ggcoder && npm install -g .` (pnpm's
global install fails without `PNPM_HOME`; the existing `ogcoder` symlink lives
under the active nvm node version's `bin/`).
