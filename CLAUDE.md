# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**gg-framework** — Modular TypeScript monorepo for building LLM-powered apps, from raw streaming to a full CLI coding agent.

| Package                 | npm                       | Description                                                          |
| ----------------------- | ------------------------- | -------------------------------------------------------------------- |
| `packages/gg-core`      | `@abukhaled/gg-core`      | Shared primitives: model registry, auth storage, paths, logger, OAuth |
| `packages/gg-ai`        | `@abukhaled/gg-ai`        | Unified LLM streaming API (Anthropic, OpenAI, Gemini, +9 providers)  |
| `packages/gg-agent`     | `@abukhaled/gg-agent`     | Agent loop with tool execution                                       |
| `packages/ggcoder`      | `@abukhaled/ogcoder`      | CLI coding agent (`ogcoder` binary)                                  |
| `packages/ggcoder-eyes` | `@abukhaled/ggcoder-eyes` | Project-agnostic perception probes (screenshots, logs, HTTP capture) |

Also in the workspace: `gg-app/` (Tauri v2 desktop app, from upstream — needs a Rust
toolchain to build, and is not built or installed here) and
`experiments/prompt-bench/`.

**Dependency chain**: `gg-core` → `gg-ai` → `gg-agent` → `ogcoder` (uses `ggcoder-eyes` for perception)

Current published version: **5.58.0** (last app-update sync: 2026-09-07).

This is a rebranded fork of upstream `kenkaiiii/gg-framework`. Every workspace package is
renamed `@kenkaiiii/*` → `@abukhaled/*`, `ggcoder` → `ogcoder` (binary, package name, and
user-facing strings), and "GG Coder" → "OG Coder" (author: Abu Khaled). Two `@kenkaiiii/*`
names are **external npm dependencies**, not workspace packages, and must never be rewritten:
`@kenkaiiii/agent-home-sdk` and `@kenkaiiii/ink` (aliased as `ink`).

The packages upstream retired (`gg-boss`, `gg-pixel`, `gg-pixel-server`, `gg-editor`,
`gg-editor-premiere-panel`, `Matey`) no longer exist on main, so there is nothing to exclude
at merge time any more. `ggcoder-eyes` is the reverse case: upstream **deleted** it, this fork
keeps it — a merge from main will silently drop its ~27 files unless they are restored.

### Fork-only features to preserve when merging from main

- **Windows / WSL support** — `utils/shell.ts` `resolveShell()` (Git Bash), `terminateProcessTree()`,
  the Windows env allowlist in `tools/safe-env.ts`, WSL scroll-pause (`ui/scroll-pause.ts`),
  reduced motion auto-enabled on WSL, OSC 11 theme detection skipped on WSL.
- **`ggcoder-eyes`** package, `EyesOverlay.tsx`, and the `ogcoder eyes …` passthrough in `cli.ts`.
- **Vision / plan-execute / hybrid model router** — `core/model-router.ts` (no upstream equivalent),
  the `model_switch` event in `core/event-bus.ts`, and the `getVisionModel` /
  `getVideoCapableModel` / `getDocumentCapableModel` helpers in `core/model-registry.ts`.
- **Xiaomi fail-fast** — `stream()` throws `ProviderError` when `baseUrl` is missing instead of
  silently defaulting to the `sgp` region. Upstream reintroduces the silent default; keep the throw.
- **`DocumentContent`** type and `glmCodingApiKey` in gg-ai (upstream has `VideoContent` only).
- **Fork UI** — OG Coder banner/logo, `TaskOverlay.tsx`, `ui/buddy/*`, `ThinkingIndicator.tsx`,
  `utils/session-title.ts`, and the `/teach-me` slash command.
- **tsup bundling** — `ogcoder` builds to a bundled single file (`pnpm clean && tsup`), not `tsc`.
  Startup on WSL depends on it; `ui/utils/highlight.ts` carries the matching CJS-interop shim.

## Commands

```bash
pnpm build                          # Build all packages (tsup for gg-ai/gg-agent/ogcoder)
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

After editing ANY file, run:

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
  - OpenAI-compat: IDs remapped to `call_*` prefix, `reasoning_content` field resolved per endpoint via `reasoningFieldKey()`, tool results as `tool` role
  - GLM: merges user text into preceding tool messages to preserve thinking context
- **StreamResult**: dual-interface — async iterable (`for await`) AND thenable (`await` for final response)
- **Zod → JSON Schema** (`utils/zod-to-json-schema.ts`): `z.toJSONSchema(schema)` with `$schema` key stripped

### gg-agent: Agent Loop

`agentLoop()` is a pure async generator in `agent-loop.ts`:

1. Poll steering messages → 2. Transform context (compaction) → 3. Route model → 4. Repair tool pairing → 5. Call LLM with timeouts → 6. Extract & execute tools in parallel → 7. Loop on `tool_use` stop reason

**Error recovery**: context overflow → force compact + retry (3x), overload 429/529 → exponential backoff 2-30s (10x), stream stall → retry (5x) with tiered timeouts (45s first-event, 30s idle, 90s hard cap pre-output, 5min once output is flowing, 5-10min for thinking-heavy models), empty response → retry (2x), abort → graceful exit.

### ggcoder: CLI Application

- **Tools** (`tools/`): Factory functions returning `AgentTool<ZodSchema>`. Each tool gets `ToolOperations` interface for I/O abstraction (local fs by default, injectable for remote).
- **MCP** (`core/mcp/`): Servers configured with command (stdio) or url (HTTP/SSE with fallback). Tools wrapped as `AgentTool` with `mcp__${server}__${tool}` naming. Rate-limited (2s min gap).
- **Model router** (`core/model-router.ts`): Per-turn model switching. Modes: `vision` (auto-switch on images/video/docs), `plan-execute` (heavy planner + light executor), `hybrid` (vision priority, then plan-execute).
- **Compaction** (`core/compaction/compactor.ts`): Triggers at 80% context usage. Keeps system message + recent ~20K tokens intact. Middle section summarized via LLM (tool calls → text, thinking stripped, results truncated). Falls back to extractive summary on failure.
- **Sessions** (`core/session-manager.ts`): Append-only JSONL with DAG structure (leafId for branching). Streams line-by-line for large files. `repairToolPairs()` fixes interrupted sessions on restore.
- **Auth**: OAuth PKCE for Anthropic, OpenAI, Gemini, Kimi and xAI; static API keys for GLM, Moonshot, Xiaomi, MiniMax, DeepSeek, OpenRouter, HuggingFace and Sakana. Credentials live in `~/.gg/auth.json` (mode `0o600`, atomic write under a file lock — `gg-core`'s `auth-storage`). Xiaomi keys are **region-scoped**: a key issued for `ams` returns 401 on `sgp`. `runLogin()` in `cli/auth.ts` therefore runs the Ink region selector **before** `readline.createInterface()` — a raw-mode Ink selector (`ui/login.tsx`) cannot coexist with an active readline interface. Xiaomi's API-Credits endpoint (`XIAOMI_CREDITS_KEY`) is a single global URL and skips region selection.
  - Known gap: the desktop app's provider descriptor (`core/auth-providers.ts` → `app-sidecar.ts`) still hardcodes the `sgp` Token Plan URL, so a desktop login with an `ams` key will 401. The CLI path is region-correct.
- **Models**: The registry lives in `@abukhaled/gg-core` (`gg-core/src/model-registry.ts`); `ggcoder/src/core/model-registry.ts` is a re-export shim that additionally defines the fork's routing helpers — `getVisionModel`, `getVideoCapableModel`, `getDocumentCapableModel`, and `getExecutorModel` (an alias for gg-core's `getFastModel`). gg-core's `ModelInfo` has no `supportsDocuments` flag, so documents ride the image/multimodal path.
- **Eyes (`packages/ggcoder-eyes`)**: Perception probes the agent invokes via the `ogcoder eyes ...` passthrough in `cli.ts`. Driven by the `/setup-eyes` and `/eyes-improve` prompt commands in `core/prompt-commands.ts`. Probes live in `probes/<name>/impl/*.sh`, with `detect.sh`, `install.sh`, and `test.sh` per probe. The agent reads `isEyesActive`/`journalCount`/`readJournal` from `@abukhaled/ggcoder-eyes`; `EyesOverlay.tsx` renders the live journal in the TUI.
- **Startup** (`cli.ts`): Optimized for fast time-to-interactive. Key patterns:
  - Auto-update check is fire-and-forget (never blocks)
  - OSC 11 theme detection is skipped on WSL (always times out)
  - MCP server connections are deferred — `connectInitialMcpTools` starts them in the background and merges tools into the UI once resolved
  - Session resume path, agent/skill discovery, and directory creation all run in parallel
- **Radio**: `core/radio.ts` plays streams via PowerShell on WSL2 rather than `mpv`.
  `core/radio.test.ts` asserts the `mpv` path, so **2 radio tests fail when the suite is run
  under WSL** — expected, and unrelated to any change you just made.
- **UI**: Ink 6 + React 19. Slash commands split between UI-handled (`App.tsx`: `/model`, `/compact`, `/clear`, `/tasks`, `/eyes-view`) and registry (`core/slash-commands.ts`: `/help`, `/settings`, `/session`, `/new`, `/router`, `/buddy`, `/teach-me`, `/quit`).
- **Branding**: the OG mark is defined once per rendering surface and every copy must stay identical — `cli/shared.ts` (`LOGO_LINES`, used by `renderLogoBlock` for login/MCP/serve/agent-home), `ui/components/Banner.tsx` (Ink), `ui/terminal-history.ts`, `ui/login.tsx`, `ui/sessions.ts`, and `cli.ts`. Product name is **OG Coder**, byline **Abu Khaled**. `gg-app/` is inherited upstream surface and is still GG-branded.

## Build: tsup vs upstream's tsc

`ogcoder` builds with **tsup** (bundled output — a deliberate fork choice for WSL startup,
where resolving hundreds of `node_modules` files is slow). Upstream builds with
`tsc -p tsconfig.build.json`, which mirrors the source tree into `dist/`.

The consequence: **tsup only emits the entries it is told about.** Upstream can add a new
entry point or a `package.json` subpath export and it "just works" for them, while here it
silently resolves to a file that was never written. Every `exports` subpath — and every
module spawned as its own process (`app-sidecar.ts`) — needs a matching key in
`tsup.config.ts`'s `entry` map. After a sync, verify with:

```bash
pnpm --filter @abukhaled/ogcoder build
node -e "const e=require('./packages/ggcoder/package.json').exports; \
  for (const [k,v] of Object.entries(e)) require('fs').accessSync('packages/ggcoder/'+(v.import??v).slice(2))"
```

Also keep `EXTERNAL` in `tsup.config.ts` current: `typescript` ships a CJS bundle that reads
`__filename` at module scope, which is undefined in ESM output and crashes the CLI at startup
("`__filename` is not defined in ES module scope"). Anything with that pattern must stay external.

## Build Gotcha

`packages/ggcoder-eyes` builds with a bare `tsc`. If its `tsconfig.json` goes missing,
`tsc` walks up to the root config and emits `.js`/`.d.ts`/`.js.map` **next to every source
file in the monorepo** (~2,600 files). Those stray `.js` files then break the `ogcoder`
tsup build with "The JSX syntax extension is not currently enabled", because tsup globs
them and loads them as plain JS. If you see that error, delete the untracked artifacts
under `packages/*/src` and `gg-app/src` and confirm `packages/ggcoder-eyes/tsconfig.json`
still exists with `outDir: dist`.

## Organization Rules

- Types → `types.ts` in each package
- Providers → `providers/` in gg-ai, one file per provider
- Tools → `tools/` in ggcoder, one file per tool
- UI components → `ui/components/`, one per file
- OAuth flows → `core/oauth/`, one per provider
- Tests → co-located with source files

## Publishing

Publish in dependency order:

```bash
pnpm build
pnpm --filter @abukhaled/gg-core publish --no-git-checks
pnpm --filter @abukhaled/gg-ai publish --no-git-checks
pnpm --filter @abukhaled/gg-agent publish --no-git-checks
pnpm --filter @abukhaled/ggcoder-eyes publish --no-git-checks
pnpm --filter @abukhaled/ogcoder publish --no-git-checks
```

`gg-core` publishes first — `gg-ai` and `ogcoder` both depend on it.

Global install for local testing: `cd packages/ggcoder && npm install -g .` (pnpm's
global install fails without `PNPM_HOME`; the existing `ogcoder` symlink lives
under the active nvm node version's `bin/`).
