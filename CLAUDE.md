# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**gg-framework** — Modular TypeScript monorepo for building LLM-powered apps, from raw streaming to a full CLI coding agent.

| Package                 | npm                       | Description                                                          |
| ----------------------- | ------------------------- | -------------------------------------------------------------------- |
| `packages/gg-ai`        | `@abukhaled/gg-ai`        | Unified LLM streaming API (Anthropic, OpenAI)                        |
| `packages/gg-agent`     | `@abukhaled/gg-agent`     | Agent loop with tool execution                                       |
| `packages/ggcoder`      | `@abukhaled/ogcoder`      | CLI coding agent (`ogcoder` binary)                                  |
| `packages/ggcoder-eyes` | `@abukhaled/ggcoder-eyes` | Project-agnostic perception probes (screenshots, logs, HTTP capture) |

**Dependency chain**: `gg-ai` → `gg-agent` → `ogcoder` (uses `ggcoder-eyes` for perception)

Current published version: **4.3.56** (last app-update sync: 2026-04-25).

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
  - OpenAI-compat: IDs remapped to `call_*` prefix, `reasoning_content` field (GLM/Moonshot only), tool results as `tool` role
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
- **Auth**: OAuth PKCE for Anthropic and OpenAI; static API keys for GLM, Moonshot, Xiaomi, MiniMax, Ollama, DeepSeek, and OpenRouter. All credentials stored in `~/.gg/auth.json` (file mode `0o600`, written atomically with a file lock via `core/auth-storage.ts`). Xiaomi keys are **region-scoped** — the correct regional `baseUrl` must be captured at login via `core/xiaomi-regions.ts` (a key from `ams` returns 401 on `sgp`). The `runLogin()` flow in `cli.ts` runs a region selector before opening readline; raw-mode Ink-style selectors (see `ui/login.tsx`) cannot coexist with an active readline interface.
- **Models**: Defined in `core/model-registry.ts`. Vision-routing pairs: `mimo-v2-pro` (text) ↔ `mimo-v2-omni`/`mimo-v2-flash` (vision); GLM `glm-5.1`/`glm-4.7` (text) ↔ `glm-4.6v`/`glm-5v-turbo`/`glm-4.6v-flashx`/`glm-4.6v-flash` (vision). MiniMax M2.7 reports `supportsImages: false` because the Anthropic-compat endpoint silently drops multimodal blocks.
- **Eyes (`packages/ggcoder-eyes`)**: Perception probes the agent invokes via the `ggcoder eyes ...` passthrough in `cli.ts`. Probes live in `probes/<name>/impl/*.sh`, with `detect.sh`, `install.sh`, and `test.sh` per probe. The agent reads `isEyesActive`/`journalCount`/`readJournal` from `@abukhaled/ggcoder-eyes`; `EyesOverlay.tsx` renders the live journal in the TUI.
- **Startup** (`cli.ts`): Optimized for fast time-to-interactive. Key patterns:
  - Auto-update check is fire-and-forget (never blocks)
  - OSC 11 theme detection is skipped on WSL (always times out)
  - Only the active provider's credentials are resolved at startup; other providers are checked locally without network calls
  - MCP server connections are deferred — started in background, tools merged into UI via `pendingMCPTools` promise + `useEffect`
  - Session resume path, agent/skill discovery, and directory creation all run in parallel
- **UI**: Ink 6 + React 19. Slash commands split between UI-handled (`App.tsx`: `/model`, `/compact`, `/quit`, `/clear`) and registry (`core/slash-commands.ts`: `/help`, `/settings`, `/session`, `/new`, `/router`).

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
pnpm --filter @abukhaled/gg-ai publish --no-git-checks
pnpm --filter @abukhaled/gg-agent publish --no-git-checks
pnpm --filter @abukhaled/ggcoder-eyes publish --no-git-checks
pnpm --filter @abukhaled/ogcoder publish --no-git-checks
```

Global install for local testing: `cd packages/ggcoder && npm install -g .` (pnpm's
global install fails without `PNPM_HOME`; the existing `ogcoder` symlink lives
under the active nvm node version's `bin/`).
