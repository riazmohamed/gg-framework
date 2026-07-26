# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Last updated:** 2026-07-26 — sync from main (main@c0a0c3d0). Framework spine now at version **5.24.0** (@abukhaled scope preserved). Major upstream changes in this sync: **Local models — a first-class `local` provider.** `gg-core/src/local-models.ts` discovers models served by Ollama, LM Studio, llama.cpp (`llama-server`), vLLM, and any other OpenAI-compatible server; everything rides the OpenAI-compatible `/v1` transport (the `local` provider registered in gg-ai's `stream.ts`), and only *capability* probing differs per server kind (`LocalEndpointKind` = `ollama` | `lmstudio` | `llamacpp` | `vllm` | `custom`, since `GET /v1/models` reports nothing useful). Probing never throws — an unreachable server is a normal state, not an error. Model ids are namespaced `local/<endpointId>/<rawId>` with auth keys `local:<id>`. User endpoints are persisted by `ggcoder/src/core/local-endpoint-store.ts` (`addCustomEndpoint`/`listAllEndpoints`/`removeCustomEndpoint`/`syncEndpointCredentials`/`LocalEndpointError`), surfaced through app-sidecar and the new gg-app `LocalModelsModal`. Paired with **`gg-agent/src/local-backend.ts`** (`isLocalBackendUrl`): a loopback backend can spend minutes prefilling a large prompt, so the first-event stream watchdog is **disabled** for local URLs — otherwise the abort → retry → cold-prefill loop never converges. **Network egress allowlist** (`ggcoder/src/core/network-guard.ts`) — two deliberately unequal layers: real enforcement on the agent's own egress (`web-fetch`/`web-search` check every URL *and every redirect hop*), plus bypassable defence-in-depth where `extractCommandHosts` recognises common network command shapes (`curl`, `wget`, `git`, `ssh`/`scp`, package installs) so `bash` can refuse an obvious egress. It is **not** a sandbox — `python -c`, a shell variable, or a base64'd URL walks straight past it; it catches accidents, not a hostile model. Allow-shaped, not deny-shaped: a command with no recognised host is never blocked. `isHostAllowed` supports exact and `*.example.com` wildcard matches. **Session storage overhaul** (`core/session-storage.ts`) — cold sessions (>`COLD_SESSION_AGE_DAYS` = 7) are gzipped to `.jsonl.gz` with a `.jsonl` redirect stub, media is externalized to a `.jsonl.assets` sidecar behind markers, and persisted tool text is capped at `MAX_PERSISTED_TOOL_TEXT_CHARS` (40 000). **Markdown transcript export** (`core/session-export.ts` + gg-app's `ExportChatButton`) — renders a session's *persisted messages* (deliberately NOT the webview's `Item[]`, which omits tool activity) through the same `restoreUserRow`/`restoreAssistantTexts` helpers `/history` uses. **`reasoning-field.ts` in gg-ai** — OpenAI-compatible endpoints disagree on the reasoning field name (`reasoning_content` on DeepSeek/GLM/Moonshot/Xiaomi vs `reasoning` on newer vLLM builds and several gateways); `REASONING_FIELD_ALIASES` reads both, order-stable so shipping endpoints stay byte-identical. Previously the thinking content was lost 100% and *silently* on the others. **Anthropic empty-text filter** — user content parts with `text === ""` are dropped before transform (a guaranteed-400 body otherwise); merged carefully around this branch's `DocumentContent` branch. **`setStreamDiagnostic`** on the gg-agent surface, **`mcpServersForAgent`** (parses `mcp__<server>__<tool>`, splitting on the double-underscore delimiter only, so server names containing single underscores survive) wired into subagent + agent MCP passthrough, **`isKimiCodingEndpoint`**, **`MEMORY_TEXT_LIMIT`**, **`isGgApp()`** (`core/runtime-mode.ts` — true when `GG_APP_PORT` is set, used to phrase notices in desktop-app terms and hide TUI-only surfaces), and new `utils/{github,http-body,process}.ts`. **Thinking levels**: `xhigh` is now Opus 5 / 4.8 / 4.7-only; `max` is supported by every adaptive model. **Grok 4.5** ships under the `xai` provider. **Test isolation**: `src/test-support/fake-home.ts` (`useFakeHome`) sets every variable libuv consults (`HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`) — setting `HOME` alone does nothing on Windows, which silently read the real user profile. gg-app up to **v0.29.0** with provider logos/labels (`provider-logos.ts`, `provider-labels.ts`, `assets/providers/*`), `ModelSelect`, and `submit-disposition.ts`. CI gained a cross-OS **`app` job** (stages the per-platform Node runtime, bundles + boots the sidecar, runs the Rust path/window-chrome tests) and split ggcoder's tests into their own blocking step. Rebrand cleanup this sync: new/merged files (`core/{local-endpoint-store,session-export,session-storage,agent-session-add-dir,agent-session-marker-anchors}.ts`, `core/lsp/windows.test.ts`, `gg-core/src/thinking-level.test.ts`) had their `@kenkaiiii/*` spine imports re-scoped to `@abukhaled/*`; the "OG Coder" identity, `ogcoder` binary/User-Agent strings, CI `actions/*@v6`, the `mcp__grep__searchGitHub` `/compare` fallback (kept alongside main's new `KENCODE_UNLOCK_NOTE`), and the removed fart easter-egg were all preserved over main; and main's new BOM custom-command test was given `useFakeHome` isolation, since this branch's global `~/.gg/commands` feature otherwise leaks the developer's real commands into its count. Previous sync: 2026-07-20 — sync from main (main@ad570bcf), version **5.20.1**. Major upstream changes in that sync: **Pixel error-tracking REMOVED** — the entire `pixel` feature and all `gg-pixel*` SDK packages (`gg-pixel`, `gg-pixel-server`, and the Go/Py/Rb/Rs/Swift native ports) were deleted upstream; `cli/pixel.ts`, `ui/pixel.ts`, `ui/hooks/usePixelFixFlow.ts`, `utils/session-title.ts`, and the pixel-chdir fix-flow are gone. **ggcoder-eyes integration REMOVED** — ogcoder no longer depends on `@abukhaled/ggcoder-eyes`; the perception-probe wiring, the system-prompt "Open Improvement Signals" section, and the `/setup-eyes` + `/eyes-improve` commands are gone (the standalone package dir survives in the tree but is no longer consumed). **Error Mom** monitoring replaces pixel (`gg-app/.error-mom.json`, `scripts/error-mom-sidecar.mjs`, server-side `formatError` surfaced through app-sidecar's `broadcastError` chokepoint — the webview never sees a raw provider string). **Async subagent orchestration** — `core/subagent-manager.ts` (`SubAgentManager`/`SubAgentSnapshot`, `buildSubAgentCompletionFollowUp`), `modes/subagent-worker-mode.js`, plus subagent token-accounting and pipe-race fixes. **Token-efficiency guards** — per-turn tool-result budget (`getToolResultCharLimit`), stale tool-output pruning (`core/compaction/tool-result-pruner.ts`), active-context thresholds (`core/compaction/active-context.ts`), `cleanupToolOutputs` (`tools/overflow.js`), and autopilot Ideal-review suppression. **New models**: **Kimi K3** and **MiMo-V2.5-Pro-UltraSpeed** (API-only — `authStorageKeys: [XIAOMI_CREDITS_KEY]`); MiMo entries now carry `authStorageKeys` (`["xiaomi", XIAOMI_CREDITS_KEY]`) alongside the branch-preserved `supportsDocuments` flags. **Subscription usage** — `fetchSubscriptionUsage`/`SubscriptionUsageSnapshot`/`SubscriptionUsageError` in gg-core, surfaced in app-sidecar. **Session progress files** — `progressFile`/`progressBackupFile` added to `AppPaths` (alongside this branch's `commandsDir`). **Compaction hardening** — compacted state is persisted to a *new* session file carrying `conversationId`/`preview`, guarded so transient (Ken chat/autopilot/subagent) sessions never touch the session store, with re-persist of turn metrics + Ken turns + autopilot/app markers; plus a 30s resume-freeze fix and 429 usage backoff. **gg-ai**: `transportSessionId` (stable Codex conversation identity, distinct from `promptCacheKey`), `redactValue`/`environmentSecrets` redaction, Anthropic many-image handling + Codex request-buffer fixes, and `isUsageLimitError`/`AgentTurnEndEvent`/`AgentTurnTiming`/`TransformContextOptions` on the gg-agent surface. **web_fetch**: two user-agents — a real Chrome `BROWSER_USER_AGENT` vs. an honest `ogcoder/1.0`, toggled per-request by `honestUserAgent` (replaces the old single `FETCH_HEADERS`). **Grok support**, Kimi fallback + refreshed Ideal-review flow, Jiwa behavior memory in GG Chat, radio controls, a root-level `bench/` suite (`a-mcp-tools`, `b-render-cpu`, `c-partial-loss`, `d-cache-audit`, `lib.mjs`, `RESULTS.md`), and gg-app up to **v0.24.1**. Rebrand cleanup this sync: merged spine files (`agent-session.ts`, `app-sidecar.ts`, `session-manager.ts`, the compaction modules, `tools/{index,subagent,web-search,web-fetch}.ts`, `ui/App.tsx`, and the `useAgentLoop`/`useContextCompaction`/`useModeState`/`useTerminalTitle` hooks) had their `@kenkaiiii/{gg-ai,gg-agent,gg-core}` spine imports re-scoped to `@abukhaled/*`; the "OG Coder"/"OG Coder by Abu Khaled" identity, the `ogcoder` binary/User-Agent strings, and CI `actions/*@v6` were preserved over main's "GG Coder"/`ggcoder`/`@v5`; and the duplicate Xiaomi MiMo block was collapsed onto main's richer entries (adding `authStorageKeys` + the UltraSpeed model) while keeping the branch's `supportsDocuments` flags. Previous sync: 2026-06-24 — sync from main (main@e236e7f), version **4.14.1**, with @abukhaled namespace preservation. Major upstream changes in that sync: **Sakana Fugu provider** (`sakana` in gg-ai's provider registry → OpenAI-compatible `https://api.sakana.ai/v1`; models `fugu` + heavier `fugu-ultra`, both 1M context, added to the registry and `getDefaultModel()`); **MCP OAuth** (`core/mcp/oauth-provider.ts` + `oauth-store.ts` + `loopback.ts` — PKCE auth for HTTP MCP servers, catching `UnauthorizedError`); **MCP stdio resolution** (`core/mcp/resolve-stdio.ts` — rewrites `npx -y @kenkaiiii/kencode-search` to a direct `node <binScript>` call since kencode-search now ships as a ggcoder dependency, skipping the npx wrapper; Windows IPv4/IPv6 loopback retry via `alternateLoopback`); new agent/perf tooling: **`code-skeleton` tool** (TS-AST API-skeleton extraction — public signatures with bodies stubbed, for cheap file comprehension), **`compress` tool** (signal-preserving tool-output compression vs blunt head/tail truncation), **`generate-image` tool** (registered when OpenAI is connected), **`safe-env.ts`** (env redaction for bash), **`shell.ts`** + **`encode-cwd.ts`**; a `benchmarks/` suite at repo root plus in-package benches (`api-benchmark.ts`, `speed-benchmark.ts`, `cache-warm-benchmark.ts`, `fast-apply-benchmark.ts`); new gg-app screens (`WakeScreen`, `HomeBackdrop`, `McpModal`, `NotesModal`, `SoundButton`, `fugu.mp3`); and a documented **two-track release model** (npm Changesets + tag-triggered gg-app desktop — see Publishing below). Rebrand cleanup this sync: new merged files (`app-sidecar.ts`, `tools/generate-image.ts`, the four `*-benchmark.ts`, `core/mcp/oauth-store.ts`) had their `@kenkaiiii/{gg-ai,gg-agent,gg-core,ggcoder}` spine imports re-scoped to `@abukhaled/*`; `parseMcpAddTokens` tests updated for the new `config.transport` field; the deliberately-removed fart easter-egg stayed removed while keeping main's improved "How to Talk" formatting guidance. Previous sync: 2026-06-18 — sync from main (main@16186c4), version **4.11.3**. Major upstream change in that sync: **`gg-app/` — the Tauri 2 desktop app** (React 19 + Vite webview over the ogcoder agent spine via a per-window `app-sidecar.ts`; now the primary shipped product). See the new **gg-app — Desktop App** section below. Also new: **LSP integration** (`ggcoder/src/core/lsp/` — jsonrpc client + manager + server registry, feeding diagnostics into edit/write), **project discovery** moved into ggcoder (`core/project-discovery.ts`; gg-boss's `discover.ts` is now a thin re-export — preserved `@abukhaled/ogcoder` scope), **`resolve-start.ts`** (logged-out-safe startup provider resolution + `getDefaultModel()` in the model registry), **`radio.ts`** + serve-mode wiring, **agent self-correction `hook` event** (`ideal`/`loop_break`/`regrounding`) on the EventBus alongside this branch's `model_switch`, **Claude Mythos 5** added to `isAdaptiveThinkingModel()` and the registry (commented out, limited availability), **Kimi K2.7** (`kimi-k2.7-code`) and **GLM-5.2** model defaults, plus `.github/workflows/` CI + release. Rebrand cleanup: the merged files (`app-sidecar.ts`, `resolve-start.ts`, `ui/render.ts`, `ui/terminal-history.ts`) had their `@kenkaiiii/*` spine imports re-scoped to `@abukhaled/*`; a stale duplicate `getDefaultModel` (pointing at the removed `kimi-k2.6`) was dropped in favor of main's. Previous sync: 2026-06-07 — sync from main (main@15d5ced), version **4.7.0**. Upstream changes in that sync: **`task_send` tool** (`tools/task-send.ts`) — background processes started with `run_in_background` now spawn with a stdin pipe, and the agent drives them interactively (answer prompts, type into REPLs, optional Enter/EOF) pairing with `task_output`/`task_stop`; **Xiaomi MiMo-V2.5 migration** — `mimo-v2.5-pro` (text-only default) and omnimodal `mimo-v2.5` replace the legacy `mimo-v2-*` ids (auto-routed upstream, fully deprecated 2026-06-30; this branch keeps its `supportsDocuments` flags — `mimo-v2-flash` removed, no V2.5 equivalent); **foreign raw-block filtering in gg-ai** — `ANTHROPIC_INPUT_BLOCK_TYPES` allowlist in `transform.ts` drops non-Anthropic raw blocks (e.g. OpenAI Codex encrypted `reasoning` items) when replaying history against Anthropic after a model switch; **OpenAI OAuth account switching fix** (`prompt=login` on the authorize URL); provider stream-cancellation/usage-limit fixes and Codex tool-call ID sanitization. Branch-only addition this sync: **global custom commands** — `~/.gg/commands/*.md` load alongside project `.gg/commands/` (project wins on collision; `commandsDir` added to `AppPaths`). Previous sync: 2026-06-04 from main (main@e6c357e), version 4.5.0. Major upstream changes in that sync: **new `gg-core` package** — provider-agnostic, UI-free shared foundation extracted from ggcoder/gg-boss (model registry, thinking levels, app paths, OAuth + auth storage, file-writer logger core, telegram + voice transcription, self-updater). ggcoder keeps thin re-export shims (`core/model-registry.ts`, `core/auth-storage.ts`, `core/oauth/*`, etc.) so existing relative imports and subpath exports keep resolving. On this branch gg-core is published as **`@abukhaled/gg-core`**. Also new: **Changesets-based versioning/publishing** (`.changeset/`, fixed version group for the framework spine), **Kimi OAuth** (`oauth/kimi.ts`, `MOONSHOT_OAUTH_KEY` — OAuth preferred over the Moonshot API key when both exist), **error classification in gg-ai** (`classifyProviderError` in `error-classification.ts`), **Moonshot video file-service upload** (`providers/moonshot-video.ts`; uploaded clips referenced as `ms://<fileId>` via `VideoContent.fileId`), and `maxVideoBytes`/`getVideoByteLimit` in the model registry (per-transport video payload caps).

**@abukhaled-preserved feature: PDF documents.** gg-ai carries a `DocumentContent` block type (PDF base64) that upstream's `M3` video work does not have. It is wired through `transform.ts` (Anthropic `document` block; OpenAI `file` content part) and `UserMessage` content. When resolving future merges, keep `DocumentContent` in `types.ts`/`index.ts` and the document branches in `transform.ts` (`stripImages`/`stripVideos` strip it for non-vision/non-video models).

## Project

**gg-framework** — Modular TypeScript monorepo for building LLM-powered apps, from raw streaming to a full CLI coding agent.

| Package | npm | Description |
|---|---|---|
| `packages/gg-ai` | `@abukhaled/gg-ai` | Unified LLM streaming API (Anthropic + OpenAI-compatible providers) |
| `packages/gg-agent` | `@abukhaled/gg-agent` | Agent loop with tool execution |
| `packages/gg-core` | `@abukhaled/gg-core` | Provider-agnostic, UI-free shared foundation: model registry, thinking levels, app paths, OAuth + auth storage, file-writer logger core, telegram + voice transcription, self-updater |
| `packages/ggcoder` | `@abukhaled/ogcoder` | CLI coding agent (`ogcoder` binary) + `app-sidecar` (the gg-app backend) |
| `gg-app` | (private — Tauri desktop app) | **The desktop app — primary product** (wraps the ogcoder agent spine) |
| `packages/ggcoder-eyes` | `@abukhaled/ggcoder-eyes` | Perception-probe package — **no longer wired into ogcoder** (the eyes integration was removed upstream in the 2026-07-20 sync); the dir survives but nothing consumes it |
| `packages/gg-voice` | `@kenkaiiii/gg-voice` | Provider-agnostic realtime voice orchestration for GG tools/agents |
| `packages/gg-editor` | `@kenkaiiii/gg-editor` | Video editing agent (DaVinci Resolve / Premiere) |
| `packages/gg-editor-premiere-panel` | `@kenkaiiii/gg-editor-premiere-panel` | CEP panel bridge for Premiere |
| `packages/gg-boss` | `@kenkaiiii/gg-boss` | Orchestrator (`ggboss` binary) — drives multiple ogcoder workers across projects from one chat |
| `Matey` | `matey` (private) | Electron desktop app (top-level dir, not under `packages/`); included in lint/format/build scope |

**Dependency chain**: `gg-ai` → `gg-agent` → `gg-core` → { `ogcoder`, `gg-boss`, `gg-editor`, `gg-voice` }. `gg-boss` consumes `gg-ai` + `gg-agent` + `gg-core` + `ogcoder` to spawn worker sessions. `gg-voice` provides voice transcription consumed by ogcoder's serve mode. The **gg-app** Tauri desktop app wraps the same `ogcoder` agent spine via a per-window `app-sidecar`.

**One home for provider-coupled code**: anything coupled to provider behavior — model registry, context windows, thinking levels, app paths, auth/OAuth — has exactly one home in `@abukhaled/gg-core` (depends only on gg-ai for `Provider`/`ThinkingLevel` types; must NOT import gg-agent or React/Ink). Raw provider error *wording* lives in `@abukhaled/gg-ai` (`classifyProviderError`, `isHardBillingMessage`). Fix a model entry or error string once and ogcoder, gg-boss, gg-editor, and gg-voice all inherit it on their next build — do not re-add per-app copies. The logger's `attachToEventBus` bridge (needs the gg-agent `EventBus` type) stays in the apps; only the pure file-writer logger core lives in gg-core.

**Workspace globs** (`pnpm-workspace.yaml`): `packages/*`, `gg-app`, `experiments/*`. (An in-progress branch change is decoupling `Matey` into its own standalone workspace with its own lockfile — driven via `pnpm --dir Matey <script>` rather than a `pnpm -r` member.)

**Models & multimodal**: **Sakana Fugu** (provider `sakana`, OpenAI-compatible `https://api.sakana.ai/v1`) is a multi-agent system surfaced as a standard LLM — models `fugu` (routes across providers) and `fugu-ultra` (heavier tier, may need larger client timeouts); both 1M context, top thinking tier `xhigh`. The MiniMax provider defaults to **MiniMax M3** (1M context, image + video). Video-capable models are Gemini 3.x, Kimi K3/K2.7, MiniMax M3, and Xiaomi **MiMo-V2.5** (the omnimodal model; the coding-focused MiMo-V2.5-Pro is text-only — the legacy `mimo-v2-*` ids auto-route to v2.5 and are fully deprecated 2026-06-30). The Xiaomi lineup now also includes **MiMo-V2.5-Pro-UltraSpeed** (a lower-latency, premium-priced sibling of the Pro coding flagship — API-only, so credentials resolve from the API Credits key alone: `authStorageKeys: [XIAOMI_CREDITS_KEY]`, while `mimo-v2.5-pro`/`mimo-v2.5` use `["xiaomi", XIAOMI_CREDITS_KEY]`). **Kimi K3** joins the video-capable set. MiMo-V2.5 rides the OpenAI-compatible transport: video/image go as base64 data URLs (`video_url`/`image_url`); its base64 payload cap is 50 MB, so the registry's `maxVideoBytes` is ~36 MB raw to stay under it after base64 inflation. Video attachments work in the chat input (drag, paste, or type a path); for non-video models the clip is saved to a temp file and the model is told to inspect it with ffmpeg (mirrors the GLM image fallback). `supportsVideo`/`maxVideoBytes` (and this branch's `supportsDocuments`) live in `packages/gg-core/src/model-registry.ts`.

## gg-app — Desktop App (primary product)

`gg-app/` is the **Tauri 2 desktop app** — a React 19 + Vite webview shell over the full
ogcoder agent. This is the main product shipped to users; the CLI is the engine, the
app is the face. Reuse the agent spine unchanged — never fork agent logic into the app.

**Run**: `cd gg-app && pnpm tauri dev` (rebuild `@abukhaled/ogcoder` first if you touched the
sidecar: `pnpm --filter @abukhaled/ogcoder build`). Restart the app after Rust/sidecar
changes; pure webview edits hot-reload via Vite HMR.

### Architecture: per-window sidecar

Each window runs its **own** Node agent sidecar (`packages/ggcoder/src/app-sidecar.ts`) bound
to its **own project cwd** — separate agents, separate projects, fully isolated. This is the
core model: multiple windows = multiple projects open at once (one could be ogcoder, another
Claude Code, another Codex).

```
React webview ──invoke()──▶ Rust commands ──HTTP──▶ Node sidecar (AgentSession)
     ▲                          │                         │
     └────── emit_to(window) ◀──┴──── SSE /events ◀────────┘
```

- **`gg-app/src-tauri/src/lib.rs`** — Rust shell. Owns a `Sidecars` registry keyed by window
  label (`main`, `project-1`, …). Each command (`agent_prompt`, `agent_state`, `select_project`,
  …) resolves the calling window's sidecar port via `port_for(&webview)`. SSE frames are
  re-emitted with `emit_to(webview_window(label))` so **windows never see each other's events**.
  Window background is painted `#111317` before first frame (no white flash). New windows are
  tiled like macOS fill&arrange (`setup_windows` → `arrange_windows`, 2-up halves / 4-up quads).
- **`gg-app/src/agent.ts`** — the ONLY bridge to Rust. Listens on the **current** webview target
  (`getCurrentWebviewWindow().listen`) — a global `listen` would miss window-scoped events. All
  IPC wrappers (`sendPrompt`, `listProjects`, `selectProject`, `createProject`, …) live here.
- **`app-sidecar.ts`** — HTTP+SSE seam over `AgentSession`. Endpoints: `/state`, `/events`,
  `/prompt`, `/cancel`, `/thinking`, `/model(s)`, `/commands`, `/projects`, `/sessions`,
  `/settings`, `/create-project`. Slash-command expansion is delegated to `AgentSession.prompt()`
  (single source of truth — built-in + `.gg/commands` custom). Env: `GG_APP_CWD` (project root),
  `GG_APP_PORT` (0 = ephemeral), `GG_APP_SESSION_ID` (resume a session file).

### UI components (`gg-app/src/`)

One component per file; mirror the TUI's look. Reusable primitives: `Modal`, `BackButton`
(chevron), `Badge` + `sourceStyle` (ogcoder=blue, Claude Code=clay `#d97757`, Codex=green
`#10a37f`). Key screens/controls: `ProjectPicker` (shown per window on load — lists discovered
projects + their recent 5 sessions, New Project, Settings), `NewProjectModal`,
`SettingsModal` (projects-root folder), `ModelMenu`, `SlashMenu`, `LiveToolPanel`,
`ActivityBar` (spinner + thinking timer + tokens), `PlanModeLogo` (amber ASCII banner),
`WindowLayoutButton` (2/4 tiling), `Markdown`. Theme mirrors `ui/theme/dark.json` in `theme.ts`.

### Project discovery + app settings

- **Discovery** lives in `packages/ggcoder/src/core/project-discovery.ts` (one home — gg-boss
  re-exports it via `discover.ts`). `discoverProjects()` scans ggcoder + Claude Code + Codex
  session stores; `listRecentSessions(cwd)` fast-paths the newest 5 ggcoder sessions (mtime sort
  → single-pass parse, no full-store scan). Decoded ggcoder paths are `path.resolve`d so
  traversal segments don't surface as a stray `..` project.
- **App settings** are app-specific in `~/.gg/gg-app.json` (separate from the CLI's
  `~/.gg/settings.json`). Currently `projectsRoot` — the folder new projects are created inside
  (default `~/gg-projects`). New projects: name validated to `^[a-z0-9]+(?:-[a-z0-9]+)*$`, folder
  created under the root, then the window re-points at it via `select_project`.

### Rules

- The agent spine (gg-ai → gg-agent → gg-core → ggcoder `AgentSession`) is reused **verbatim**.
  App-only concerns (windows, IPC, picker, settings) live in `gg-app/`; anything provider- or
  agent-coupled stays in its existing home and the app consumes it.
- New IPC = add a Rust `#[tauri::command]` that proxies the sidecar + register it in
  `invoke_handler!`, expose a typed wrapper in `agent.ts`, never `fetch` the sidecar from the
  webview (mixed-content blocked on the `tauri://` origin).
- Webview calls that hit the sidecar must `await waitForReady()` first (startup/respawn race).

> **Adding/changing an Anthropic model is a two-package edit.** The `MODELS` entry in `gg-core/src/model-registry.ts` is necessary but not sufficient — thinking transport is gated separately by `isAdaptiveThinkingModel()` (a model-ID regex) in `gg-ai/src/providers/transform.ts`. That regex decides `adaptive` thinking + `output_config.effort` vs. legacy `budget_tokens`, whether the `interleaved-thinking-2025-05-14` beta header is sent (`anthropic.ts`), and `xhigh` effort eligibility. New adaptive-thinking models (Fable 5, Opus 4.6+, Sonnet 4.6) must be added to that regex too. Note Fable 5 also rejects an explicit `thinking: {type: "disabled"}` (omit the param instead) — the provider already omits `thinking` when it's off, so no change is needed there.

## Development Approach

**og-framework** is being developed as an independent product under the `@abukhaled` scope. Currently in Phase 1 (learning-first development):

- **Branch strategy**: `main` = independent codebase. `rebrand/abukhaled` = temporary feature branch (will rebase onto main when ready to diverge completely).
- **Selective cherry-picks**: When useful code appears in upstream, cherry-pick it into main as needed.
- **Build method**: Build from source locally via `pnpm build`, then link globally with `pnpm --filter @abukhaled/ogcoder link --global`. This avoids npm dependency lock-in until publishing infrastructure is ready.
- **Three phases**:
  1. **Phase 1 (now)**: Learn codebase deeply by working with a copy. Understand agent loop, LLM streaming, tool execution, UI patterns.
  2. **Phase 2 (future)**: Implement own features and improvements as expertise grows. Diverge from upstream where beneficial.
  3. **Phase 3 (long-term)**: Publish independently to npm under `@abukhaled` scope.

## Related Docs

Deep-dive guides at the repo root (this file stays the operational summary; link out for depth):

- `README.md` — installation, quick start, package overview
- `DESIGN_PATTERNS_GUIDE.md` — canonical reference for the core design patterns (Provider Registry, Dual-Nature Objects, EventStream, Async Generator loop, Error Recovery, Command Registry, …) summarized in **Key Patterns** below
- `INK_ARCHITECTURE_GUIDE.md` — Ink 6 + React 19 terminal UI deep dive (rendering model, layout, input, performance)
- `BUILD_GUIDE.md` — learning-track guide for rebuilding the framework from scratch (Phase 1–3 progression)
- `AGENTS.md` — **legacy** Codex-targeted variant of this file; partially stale (predates gg-core). CLAUDE.md is authoritative.

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

`lint`/`format` cover both `packages/*/src/**` and the top-level `Matey/**`; `build`/`check`/`test` run recursively (`pnpm -r`) across all workspace packages. `ggcoder` builds with `tsc`; `gg-ai`/`gg-agent`/`gg-core`/`gg-voice`/`gg-boss` build with `tsup` (ESM + CJS + DTS).

## Architecture

### Data Flow

`stream()` (gg-ai) → `agentLoop()` (gg-agent) → tools + session (ggcoder)

### gg-ai: Provider-Agnostic Streaming

- **Provider registry** (`provider-registry.ts` + `stream.ts`): Map-based dispatch. Built-in providers registered at module load: `anthropic` and `minimax` → `streamAnthropic()` (MiniMax-M3 uses an Anthropic-compatible endpoint); `gemini` → `streamGemini()` (native Gemini transport, OAuth via `core/oauth/gemini.ts`); `openai`, `glm`, `moonshot`, `xiaomi`, `ollama`, `deepseek`, `openrouter`, `sakana`, `xai`, and `local` → `streamOpenAI()` with provider-specific baseUrl/config.
- **Reasoning field aliases** (`providers/reasoning-field.ts`): OpenAI-compatible endpoints disagree on the field name — `reasoning_content` (DeepSeek, GLM, Moonshot, Xiaomi) vs `reasoning` (newer vLLM builds, several gateways). `REASONING_FIELD_ALIASES` reads both, `reasoning_content` first so shipping endpoints stay byte-identical. Reading only one name loses the thinking content *silently* on the others — the turn still succeeds.
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

- **Tools** (`tools/`): Factory functions returning `AgentTool<ZodSchema>`. Each tool gets `ToolOperations` interface for I/O abstraction (local fs by default, injectable for remote). Core tools: `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`, `web-fetch`, `web-search`. Content tools: `web-fetch` (multi-URL with bounded concurrency, Markdown extraction via `html-extract.ts` using turndown, PDF text via `pdf-extract.ts` using unpdf, prefers `/llms.txt` for docs), `screenshot` (Playwright-driven page capture). Advanced tools: `subagent` (spawns child `ogcoder` process in json-mode, streams NDJSON back), `skill` (injects skill markdown into context), `tasks`/`task-output`/`task-send`/`task-stop` (background task management — `task_send` writes to a background process's stdin pipe to answer prompts or drive REPLs, with optional Enter/EOF), `enter-plan`/`exit-plan` (plan mode gating). Context-efficiency tools: `code-skeleton` (TS-AST extraction of a file's public API — signatures kept, bodies stubbed — for a fraction of a full read's tokens), `compress` (signal-preserving tool-output compression — keeps errors/JSON shape/head+tail vs blunt truncation), `generate-image` (registered only when OpenAI is connected).
- **MCP** (`core/mcp/`): Servers configured with command (stdio) or url (HTTP/SSE with fallback). Tools wrapped as `AgentTool` with `mcp__${server}__${tool}` naming. Rate-limited (2s min gap).
- **Model router** (`core/model-router.ts`): Per-turn model switching. Modes: `vision` (auto-switch on images/video/docs), `plan-execute` (heavy planner + light executor), `hybrid` (vision priority, then plan-execute). Vision fallback chain: GLM-4.6V → MiMo-V2.5 (omni) → Moonshot → OpenAI (Claude excluded for cost).
- **Compaction** (`core/compaction/compactor.ts`): Triggers at 80% context or `contextWindow - 16384` tokens (whichever is lower). Keeps system message + recent ~20K tokens intact. Middle section summarized via LLM. Falls back to extractive summary on failure.
- **Sessions** (`core/session-manager.ts`): Append-only JSONL with DAG structure (leafId for branching). Streams line-by-line for large files. `repairToolPairs()` fixes interrupted sessions on restore. Storage mechanics live in `core/session-storage.ts`: sessions older than `COLD_SESSION_AGE_DAYS` (7) are gzipped to `.jsonl.gz` behind a `.jsonl` redirect stub, media is externalized to a `.jsonl.assets` sidecar via markers, and persisted tool text is capped at `MAX_PERSISTED_TOOL_TEXT_CHARS` (40 000). `core/session-export.ts` renders a session to a self-contained Markdown transcript — built from the *persisted messages* (not the webview's `Item[]`, which keeps tool activity in the LiveToolPanel and would export a chat with the work missing), reusing the `restoreUserRow`/`restoreAssistantTexts` helpers `/history` uses.
- **Auth** (`core/auth-storage.ts`, `core/oauth/`): OAuth PKCE for Anthropic and OpenAI (with token refresh + 401 retry); static API keys for GLM, Moonshot, Xiaomi, MiniMax, DeepSeek, Ollama, OpenRouter, Sakana, and xAI. Local endpoints use `local:<id>` keys. All credentials stored in `~/.gg/auth.json`. Provider selection at startup uses `resolveActiveProvider()` in `cli.ts` — falls back to the first authenticated provider if the saved one isn't logged in.
- **Themes** (`ui/theme/`): Six themes — `dark`, `light`, `dark-ansi`, `light-ansi`, `dark-daltonized`, `light-daltonized` — plus `auto` (detects from terminal). ANSI variants use 16-color palette for limited terminals; daltonized variants are color-blind friendly. `loadTheme(name)` in `theme.ts` returns the JSON config; `ThemeContext` + `useTheme()` for read, `SetThemeContext` + `useSetTheme()` for runtime switching.
- **UI**: Ink 6 + React 19. `useAgentLoop` hook drives the agent and surfaces events to React state. Throttled streaming flush at ~16ms intervals to avoid saturating renders. Markdown rendering uses `utils/token-to-ansi.ts` (custom tokenizer → ANSI) instead of marked-terminal for theme-aware output. Terminal hyperlinks via `utils/hyperlink.ts` (gated by `supports-hyperlinks.ts`). Cross-component state (taskbar, etc.) lives in `ui/stores/` using a tiny `create-store` pattern. **Recent refactoring** splits rendering logic into focused modules: `app-items.ts` (unified item types), `layout-decisions.ts` (layout routing per state), `item-helpers.ts` (item transforms), `terminal-history-format.ts`/`terminal-history-spacing.ts`/`terminal-history-status-renderers.ts` (separated terminal rendering concerns). `ui/thinking-level.ts` manages thinking level cycling per model. Other ui/ subdirs: `transcript/` (tool-call presentation in history), `hooks/`, `utils/`, `constants/`, `testing/`. See `INK_ARCHITECTURE_GUIDE.md` for the full rendering model.
- **Live item flushing** (`ui/live-item-flush.ts`): Ink re-renders all live items on every state change, so unbounded growth causes expensive cursor math and visible jank. Items are flushed to `Static` history when safe — after turns complete, on overflow, or when tool-only turns finish. The `liveItems` state array is kept under ~8 items by aggressive overflow flushing. Flushed items' large payloads (tool results, server data) are trimmed to prevent multi-GB memory retention.
- **Ink layout pitfalls**: Avoid `flexShrink={1}` on small status message items (info, error, plan_transition, etc.) — when combined with parent `flexGrow={1}`, it causes Ink's layout calculator to miscalculate available space, clipping subsequent items. These resolve only on window resize. Status messages should have no shrink directive.
- **Static + history**: The `<Static>` component (Ink's write-once history area) is keyed with `resizeKey` and `staticKey` to handle terminal resize and overlay transitions. When overlays open, history is hidden by rendering an empty items array. Use `setStaticKey((k) => k + 1)` to force a Static re-mount (used when closing overlays or handling overlay/cwd transitions).
- **SessionStore pattern** (`App.tsx`): React state (history, messages, planSteps, sessionTitle, overlay, runAllTasks, etc.) is mirrored to an external `sessionStore` object via useEffects. This allows state to survive `resetUI()` remounts (e.g., when starting a task or closing an overlay). Always sync new stateful features through this pattern — initialize from `props.sessionStore?.key ?? default`, and add a `useEffect(() => { if (sessionStore) sessionStore.key = localState; }, [localState, sessionStore])`.
- **Tasks run-all**: Ctrl+T → r spawns tasks sequentially. The `runAllTasks` state flag must be persisted via sessionStore so it survives the component remount after the first task completes (see pattern above). Without this, only the first task would run.
- **Debug logging**: `~/.gg/debug.log` — timestamped log of startup, auth, tool calls, turn completions, errors. Truncated on each CLI restart. Singleton logger in `src/core/logger.ts`.

### CLI Command Routing

`cli/command-routing.ts` abstracts execution mode dispatch logic — routes arguments like `json`, `serve`, `agent-home`, `rpc`, and default `interactive` mode (the `pixel` mode was removed in the 2026-07-20 sync). Tests in `cli/command-routing.test.ts` ensure arguments are parsed correctly for each mode.

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

### Extensibility: Agents, Skills, Custom Commands, Extensions, Style Packs

The first three systems discover markdown files with YAML frontmatter from two locations (merged, project-local wins on conflict):
- **Global**: `~/.gg/{agents,skills,commands}/`
- **Project-local**: `{cwd}/.gg/{agents,skills,commands}/`

**Agents** (`core/agents.ts`): Frontmatter keys: `name`, `description`, `tools` (comma-separated). Body is the system prompt. Two built-in agents seeded on first run (won't overwrite edits):
  - `owl` — read-only codebase explorer (tools: read, grep, find, ls, bash)
  - `bee` — general task worker (tools: read, write, edit, bash, find, grep, ls)

**Skills** (`core/skills.ts`): Frontmatter: `name`, `description`. Body is injected into context by the `skill` tool when the agent invokes it by name.

**Custom Commands** (`core/custom-commands.ts`): User-defined slash commands loaded alongside built-ins from `~/.gg/commands/` (global) and `{cwd}/.gg/commands/` (project wins on collision). Frontmatter: `name`, `description`. Body is the prompt injected into the agent; `/cmd <args>` appends args as a "User Instructions" section.

**Extensions** (`core/extensions/`): JS plugin system — `ExtensionLoader.loadAll()` imports every `*.js` file in `~/.gg/extensions/` at `AgentSession` startup. Each file default-exports (or exports `createExtension`) a factory returning an `Extension` that receives an `ExtensionContext`.

**Style Packs** (`core/style-packs/`): Per-language best-practice prompt sections. `core/language-detector.ts` detects project languages; `loadPack(id, cwd)` injects the matching pack into the system prompt — a project can override any bundled pack via `<cwd>/.gg/styles/<id>.md`. Verification commands for detected languages are injected alongside (`detectVerifyCommands`).

> **Note:** The **Eyes — Perception Probes** integration (`isEyesActive`, `ogcoder eyes`, the journal/overlay, and the `/setup-eyes` + `/eyes-improve` commands) was **removed** upstream in the 2026-07-20 sync. The `packages/ggcoder-eyes` package dir still exists but is no longer wired into ogcoder; do not re-add the eyes dependency or system-prompt section when merging.

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

## Test Isolation — `useFakeHome`

Any test that touches `~/.gg` (auth.json, settings, session store, **and on this branch the
global `~/.gg/commands` custom commands**) must isolate the home directory with
`useFakeHome(dir)` from `ggcoder/src/test-support/fake-home.ts`.

Setting `process.env.HOME` alone silently does **nothing on Windows**: libuv resolves the home
directory from `USERPROFILE`, falling back to `HOMEDRIVE`+`HOMEPATH`, and ignores `HOME`
entirely — so those tests kept reading the real user profile (a wave of `NotLoggedInError` on
fresh CI runners, and a risk of reading or overwriting real auth tokens on a dev machine).
`useFakeHome` sets every variable libuv consults and returns an exact restore function.

**Branch-specific trap:** because this branch merges global `~/.gg/commands/*.md` into
`loadCustomCommands()`, any test asserting a custom-command *count* reads the developer's real
global commands unless it fakes home first. Upstream tests won't do this — add it when merging.

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

## Local Models

Local inference servers are a first-class provider, not a special case. `gg-core/src/local-models.ts`
discovers what a server is offering; everything then rides the OpenAI-compatible `/v1` transport
through the `local` provider in gg-ai's `stream.ts`.

- **Why discovery is per-kind.** `GET /v1/models` reports no useful *capabilities*, so each
  server kind (`LocalEndpointKind`) has its own probe: Ollama → `POST /api/show`
  (`capabilities[]` + `model_info["<arch>.context_length"]`); LM Studio → `GET /api/v0/models`
  (`type`, `state`, `max_context_length`); llama.cpp → `GET /props`
  (`default_generation_settings.n_ctx`); vLLM/custom → nothing reliable (`max_model_len`
  sometimes rides the model object).
- **Probing never throws.** An unreachable server is a normal state — the user simply doesn't
  have it running — not an error to surface.
- **Naming**: model ids are `local/<endpointId>/<rawId>`; auth keys are `local:<id>`.
- **Persistence**: `ggcoder/src/core/local-endpoint-store.ts` — `addCustomEndpoint`,
  `listAllEndpoints`, `removeCustomEndpoint`, `syncEndpointCredentials`, `LocalEndpointError`.
  Surfaced over app-sidecar and in gg-app's `LocalModelsModal`.
- **Do not re-enable the first-event watchdog for loopback.** `gg-agent/src/local-backend.ts`
  (`isLocalBackendUrl`) disables it for local URLs: a local server can spend minutes prefilling a
  large prompt, and the watchdog turns that into an abort → retry → cold-prefill loop that never
  converges.

## Network Egress Allowlist

`ggcoder/src/core/network-guard.ts`. Two layers of **deliberately unequal** strength — read this
before treating it as a security boundary:

1. **Real enforcement** — the agent's own egress paths (`web-fetch`, `web-search`) check every
   request URL *and every redirect hop* against the allowlist. Nothing leaves those tools to a
   disallowed host.
2. **Defence in depth, bypassable by design** — `extractCommandHosts` recognises common network
   command shapes (`curl`, `wget`, `git`, `ssh`/`scp`, package installs) so `bash` can refuse an
   obvious egress. This is **not a sandbox**: `python -c`, a shell variable, a base64'd URL, or
   any unrecognised tool walks straight past it. It catches accidents, not a hostile model. Real
   containment needs OS-level enforcement (sandbox-exec, Landlock/seccomp, a netns proxy).

Allow-shaped, not deny-shaped: a command with **no recognised host is never blocked**, so
ordinary work is unaffected. `isHostAllowed` matches exact hosts and `*.example.com` wildcards.

## LSP Inline Edit Diagnostics

Successful `edit`/`write` tool results get compiler-grade error diagnostics appended
(`Diagnostics in src/a.ts (informational …): L42:7 Type 'string' is not assignable …`)
so the model self-corrects type errors in the same turn it creates them. Code lives in
`packages/ggcoder/src/core/lsp/` (`jsonrpc.ts` zero-dep Content-Length framing,
`servers.ts` catalog + root detection, `client.ts` document sync + push/pull race,
`manager.ts` lazy pool, `format.ts` rendering).

Hard rules:

- **TS/JS works for every user out of the box.** `typescript-language-server` + `typescript`
  ship as ggcoder dependencies (~26MB unpacked) — no postinstall, no downloads, no runtime
  `npx -y`. Resolution order: project's `node_modules` (walking up, its own TS version wins) →
  ggcoder's bundled copy → PATH. Node-based servers spawn via `process.execPath` + the real
  bin script (never `.bin` shims, which need `node` on PATH). Other servers
  (`pyright-langserver`, `gopls`, `rust-analyzer`, `clangd`) resolve from project/PATH only —
  they ship with their language toolchains.
- **Silent graceful degradation.** Missing/crashed/slow server ⇒ tool output is byte-identical
  to before (debug-log only). A failed spawn marks `(server, root)` broken for the session.
- **Lazy + budgeted.** Nothing spawns until the first edit of a matching file; diagnostics are
  capped at 3s warm / 8s first-touch — overruns return nothing and leave the server warm.
- **Errors only, capped at 5**, framed as informational so multi-file sequences aren't derailed.
- Opt out with `"lspDiagnostics": false` in `~/.gg/settings.json`. Pools are per tool set:
  `rebuildToolsForCwd` (mid-session chdir) shuts the old one down; exit handlers call
  `lspManager.shutdownAll()` alongside `processManager`.
- Tests: `src/core/lsp/*.test.ts` run against a fake stdio server fixture
  (`src/tools/__fixtures__/fake-lsp-server.mjs`) — CI never needs real language servers.
  Opt-in real-tsserver test: `GG_LSP_INTEGRATION=1 npx vitest run src/core/lsp/integration.test.ts`.

## MCP Servers

`ggcoder mcp` adds and manages Model Context Protocol servers. Configs are stored in the same `{ "mcpServers": { … } }` shape Claude Code uses, so they're portable both directions.

### Scopes & file locations

- **Global** → `~/.gg/mcp.json` — available in all OG Coder sessions.
- **Project** → `./.gg/mcp.json` — only the current project root.
- On a name collision, **project wins**. Provider defaults stay authoritative — a user server can only add a new name, never override a default.

### Default servers (`core/mcp/defaults.ts`)

- `kencode-search` — stdio, declared as `npx -y @kenkaiiii/kencode-search`. **Keep the `@kenkaiiii` scope**: this is an external published npm package, not part of the rebrand. An over-rename to `@abukhaled/kencode-search` 404'd at startup, the server never connected, and `/compare` failed with "mcp__kencode-search__searchCode is not available". As of the 4.14.1 sync it also ships as a ggcoder dependency, so `connectServer` rewrites the `npx -y` form to a direct `node <binScript>` invocation at connect time (`core/mcp/resolve-stdio.ts`) — skipping the npx wrapper, with graceful fallback to npx if the dep is missing.
- `grep` — HTTP, `https://mcp.grep.app` (grep.app public GitHub code search, tool `mcp__grep__searchGitHub`). Branch-only addition (not upstream); serves as the `/compare` fallback — the `/compare` prompt in `core/prompt-commands.ts` instructs falling back to `mcp__grep__searchGitHub` when kencode-search is unavailable. Preserve both in merges from main.
- `refero` — HTTP, `https://api.refero.design/mcp` (design system API). Global scope. Provides 8 tools for design system exploration and interaction (e.g., design tokens, component catalog, guidance access). Bearer auth via `Authorization: Bearer` header stored in `~/.gg/mcp.json`.

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
- **Mid-session chdir.** Project-scoped servers load relative to `process.cwd()` at startup. Any flow that swaps cwd mid-session (`process.chdir` + `rebuildToolsForCwd`) won't drag project MCP servers along with it.
- **WebSocket transport** is parsed but rejected (no WS client today).
- **Env var expansion** (`${VAR}`) in `.mcp.json` is NOT expanded in v1 — values pass through literally.

## Pixel — REMOVED (2026-07-20 sync)

The **Pixel** error-tracking feature and every `gg-pixel*` package (`gg-pixel`, `gg-pixel-server`, and the Go/Py/Rb/Rs/Swift native ports) were **deleted upstream** in the 2026-07-20 sync. Gone with them: `ogcoder pixel*` CLI subcommands, the `Ctrl+E` `PixelOverlay`, `startPixelFix`/`finalizePixelFix`, the `pixel` execution mode, and the pixel-chdir MCP caveat. Its replacement is **Error Mom** (see the sync note at the top of this file). Do not re-introduce pixel modules or the `@kenkaiiii/gg-pixel` dependency when merging from an older branch.

## Organization Rules

- Types → `types.ts` in each package
- Providers → `providers/` in gg-ai, one file per provider
- Tools → `tools/` in ggcoder, one file per tool
- UI components → `ui/components/`, one per file
- OAuth flows, auth storage, model registry, app paths, logger core → `@abukhaled/gg-core` (`packages/gg-core/src/`), one file per provider under `oauth/`. ggcoder keeps thin re-export shims at `core/oauth/*`, `core/auth-storage.ts`, `core/model-registry.ts`, etc. so existing relative imports + subpath exports (`@abukhaled/ogcoder/auth`, `/models`) keep resolving.
- Provider error classification → `@abukhaled/gg-ai` (`classifyProviderError` in `error-classification.ts`)
- Tests → co-located with source files

## Publishing — two release tracks

There are **two independent release tracks** (main's `/release` command, in
`.gg/commands/release.md`, orchestrates both in order — prefer it over manual steps):

- **Track A — npm framework packages** via Changesets (the CLI engine).
- **Track B — gg-app desktop** (`0.x` line, `private: true`, never on npm) — released by
  pushing a `v*` git tag, which fires `.github/workflows/release.yml` to build/sign/notarize
  installers and publish a **non-draft** GitHub release + updater `latest.json` (macOS arm64
  + Windows only). gg-app builds the spine **from source** (`workspace:*`, not the published
  npm versions) and bundles `packages/ggcoder/dist/app-sidecar.js`, so npm need not be
  published first — but publish Track A first so the shipped CLI and app stay in lockstep.

### Track A — npm packages (Changesets)

Manual multi-package version bumping is gone — do **not** hand-edit `version` fields.
The framework spine — `@abukhaled/gg-ai`, `@abukhaled/gg-agent`, `@abukhaled/gg-core`,
`@abukhaled/ogcoder`, `@kenkaiiii/gg-boss` — is a **fixed group** in
`.changeset/config.json`: a changeset touching any one bumps them all to the same
version together. Dependents like gg-editor / gg-voice get an automatic patch bump.

```bash
pnpm changeset            # describe the change; pick bump level (patch/minor/major)
pnpm changeset version    # apply bumps + update internal deps + write changelogs
pnpm build                # rebuild with the new versions
git commit -am "Version packages"   # COMMIT BEFORE PUBLISH — publish tags HEAD
pnpm changeset publish    # publishes in topological order + creates git tags
git push --follow-tags    # push the version commit + the new tags
```

Commit the version bump **before** `pnpm changeset publish` — publish tags HEAD, so an
uncommitted bump tags the wrong commit. `pnpm changeset status` shows the pending graph.

- npm granular access token must be set: `npm set //registry.npmjs.org/:_authToken=<token>`
- `access: public` is set in `.changeset/config.json` (and each package's `publishConfig`), required for scoped packages.
- `workspace:*` references resolve to real versions at publish time because changesets publishes via pnpm.

### Track B — gg-app desktop (tag-triggered)

The desktop version lives in **four files that must stay in lockstep** (`gg-app/package.json`,
`gg-app/src-tauri/tauri.conf.json`, `Cargo.toml`, `Cargo.lock`). **Never hand-edit them** —
use the helper, which bumps all four at once: `pnpm --filter gg-app bump <patch|minor|major|x.y.z>`
(`scripts/bump-version.mjs`). Then commit the four files, push, `git tag v<NEW> && git push
origin v<NEW>` to fire `release.yml`.
