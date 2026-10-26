# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Last updated:** 2026-10-26 — synced main@f6f8efa3 (hedged streaming, routine bash-output compaction, project file list in the prompt, Gemini hidden, Trophies, GG Royale, refreshed bundled skills). Spine **5.86.3** (`@abukhaled` scope), gg-app **v0.96.3**. Per-sync history lives in `git log` (`docs: update CLAUDE.md after app-update sync` commits). This file keeps only what is true now.

**Branch merge checklist (re-check on every sync from main):**

- **Scope.** The four spine `package.json` files keep `@abukhaled/{gg-ai,gg-agent,gg-core}` and `@abukhaled/ogcoder` (bin `ogcoder`) and take main's version. External `@kenkaiiii/agent-home-sdk` and the `ink: npm:@kenkaiiii/ink@…` alias stay `@kenkaiiii`. Re-scope every new or merged file that imports `@kenkaiiii/*` spine packages, including `vi.mock("@abukhaled/…")` paths, which must match the source import or the mock does nothing.
- **Strings.** Keep `originator: "ogcoder"` on the non-lite Codex branch, `{ name: "ogcoder" }` in every MCP `new Client(...)`, and the OG Coder identity. `CODEX_CLIENT_VERSION` takes the newer of main's and the branch's pin (currently 0.161.0). `system-prompt.test.ts`'s size budget is main's + 10 (the identity line is longer).
- **Branch-only code to keep:** `Matey/` plus the `pnpm --dir Matey` legs in the root scripts (main deleted Matey; restore with `git checkout HEAD -- Matey`); `DocumentContent` (below) and `supportsDocuments` on all MiMo-V2.6 models; the GLM vision models + `visionSpecialist` (below; `getSummaryModel` skips both vision-specialist and billed models); the `grep` MCP server and the `/compare` fallback to `mcp__grep__searchGitHub`; `/nuclear-commit`; global `~/.gg/commands` plus `$ARGUMENTS` routing; the outside-workspace removal guard in `workspace-guard.ts` plus the shared `workspaceRootsFor` (see **Shell Command Guards**); the `model_switch` event on `event-bus.ts`; the `modelRouter` hook and `turnApiKeyIsRouterOverride` in gg-agent (since 2026-10-26 the `stream()` call sits inside `hedgedStream`'s `start`; it must keep `provider: turnProvider`, `model: turnModel`, `baseUrl: turnBaseUrl`, not main's `options.*`); `githubIdentities` in settings; ACP's per-session cwd (`goal ? goal.dir : requestedCwd` in `acp-mode.ts`); `resolveResumePath` for `--rpc --resume`; gg-app window-arrangement persistence (picker tiles, `rect_on_some_monitor`, `schedule_workspace_snapshot` across `settings.rs`/`state.rs`/`daemon.rs`/`windows.rs`); and the TUI never registering `ask_user`.
- **Accept upstream deletions** of retired packages (`gg-boss`, `gg-editor*`, `gg-voice`, `ggcoder-eyes`, `gg-pixel*`), `bench/`, `experiments/`, Error Mom and Ideal Review. Do not resurrect them.
- **Tests that read `~/.gg`** must use `useFakeHome`. Upstream custom-command count tests need it added on this branch.
- **Known non-failures:** `core/agent-session-diagnostics.test.ts` fails when `pnpm` is a corepack shim (environment-only). `agent-session-subagent-policy.test.ts` and `gg-app/scripts/stage-node.test.mjs` are flaky under full-suite load. An `ERR_MODULE_NOT_FOUND: tslib` after install is fixed by `pnpm install --force`.
- **New upstream files import `@kenkaiiii/gg-*` directly** (2026-10-19: `package-threats.ts`, `threat-feed.ts`; 2026-10-26: `gg-agent/src/hedged-stream.ts` + test, `core/trophies/store.ts`). `git grep "kenkaiiii/gg-"` after every merge. gg-safe's model-facing strings say "GG Coder"; left as upstream wrote them.
- **Upstream remote:** if `git pull origin main` brings nothing, compare with `git log main..upstream/main` (KenKaiii) and fast-forward from there.
- **CLI parity:** port terminal-suited gg-app features each sync (see **CLI parity with gg-app**).

**@abukhaled-preserved feature: PDF documents.** gg-ai carries a `DocumentContent` block type (PDF base64) that upstream's `M3` video work does not have. It is wired through `transform.ts` (Anthropic `document` block; OpenAI `file` content part) and `UserMessage` content. When resolving future merges, keep `DocumentContent` in `types.ts`/`index.ts` and the document branches in `transform.ts` (`stripImages`/`stripVideos` strip it for non-vision/non-video models).

## Project

**gg-framework** — Modular TypeScript monorepo for building LLM-powered apps, from raw streaming to a full CLI coding agent.

| Package                             | npm                                   | Description                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/gg-ai`                    | `@abukhaled/gg-ai`                    | Unified LLM streaming API (Anthropic + OpenAI-compatible providers)                                                                                                                   |
| `packages/gg-agent`                 | `@abukhaled/gg-agent`                 | Agent loop with tool execution                                                                                                                                                        |
| `packages/gg-core`                  | `@abukhaled/gg-core`                  | Provider-agnostic, UI-free shared foundation: model registry, thinking levels, app paths, OAuth + auth storage, file-writer logger core, telegram + voice transcription, self-updater |
| `packages/ggcoder`                  | `@abukhaled/ogcoder`                  | CLI coding agent (`ogcoder` binary) + `app-sidecar` (the gg-app backend)                                                                                                              |
| `gg-app`                            | (private — Tauri desktop app)         | **The desktop app — primary product** (wraps the ogcoder agent spine)                                                                                                                 |
| `Matey`                             | `matey` (private)                     | Electron desktop app (top-level dir, not under `packages/`); included in lint/format/build scope                                                                                      |

**Dependency chain**: `gg-ai` → `gg-agent` + `gg-core` → `ogcoder`. The **gg-app** Tauri desktop app wraps the same `ogcoder` agent spine via a per-window `app-sidecar`. That is the whole release spine as of the 2026-09-07 sync — `gg-boss`, `gg-editor`, `gg-editor-premiere-panel`, `gg-voice`, and `ggcoder-eyes` were retired upstream and their deletions accepted on this branch. Do not resurrect them when merging an older branch.

**One home for provider-coupled code**: anything coupled to provider behavior — model registry, context windows, thinking levels, app paths, auth/OAuth — has exactly one home in `@abukhaled/gg-core` (depends only on gg-ai for `Provider`/`ThinkingLevel` types; must NOT import gg-agent or React/Ink). Raw provider error _wording_ lives in `@abukhaled/gg-ai` (`classifyProviderError`, `isHardBillingMessage`). Fix a model entry or error string once and ogcoder (and therefore gg-app) inherits it on the next build — do not re-add per-app copies. The logger's `attachToEventBus` bridge (needs the gg-agent `EventBus` type) stays in the apps; only the pure file-writer logger core lives in gg-core.

**Workspace globs** (`pnpm-workspace.yaml`): `packages/*`, `gg-app` (`experiments/*` left with the folder on 2026-10-18). The same file now also holds the root pnpm config (`onlyBuiltDependencies`, `ignoredBuiltDependencies`, `overrides`, `patchedDependencies`) — **not** a `"pnpm"` field in `package.json`, which newer pnpm ignores; `packageManager` pins `pnpm@10.17.1`. `Matey/` is intentionally isolated from the root workspace with its own workspace file and lockfile; drive it via `pnpm --dir Matey <script>` from the repo root. **Upstream deleted `Matey/` outright on 2026-08-10 (main@bbc5c7a8); this branch keeps it.** A sync from main will present its files as delete/modify conflicts and will silently stage deletions for the ones you did *not* touch — restore the whole directory (`git checkout HEAD -- Matey`) and keep the `pnpm --dir Matey` legs in the root scripts.

**Models & multimodal**: The OpenAI lineup is headed by **GPT-6 Astra** (`gpt-6-astra`, 1.05M
public / 272K Codex-OAuth context, 128K output) with the new top thinking rung **`ultra`**;
**GPT-6.1 Sol** (`gpt-6.1-sol`, replacing GPT-6 Sol on 2026-09-29) is the provider default and **GPT-6 Luna** (`gpt-6-luna`) is its
`low` tier — both share Astra's 1.05M/272K window split, 128K output and responses-lite
transport, and both need a **Codex client >= 0.155.0** on the ChatGPT OAuth route. **GPT-6.1 Sol
only appears in the ChatGPT account's Codex catalog for clients >= 0.159.0**, even though its
catalog entry declares `minimal_client_version: 0.153.0` — an older advertised client gets
*"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account"*, which
looks like a subscription problem but is not. `CODEX_CLIENT_VERSION` in
`gg-ai/src/providers/openai-codex.ts` is therefore **0.161.0** (main's pin as of the
2026-10-09 sync; this branch had bumped to 0.159.2 on 2026-09-30). When a new OpenAI model lands,
confirm it is actually listed by `GET https://chatgpt.com/backend-api/codex/models?client_version=<v>`
for the advertised version, and bump to the latest `openai/codex` `rust-v*` release if not. Sol's ladder
reaches `ultra`, Luna's tops out at `max`. The whole **GPT-5.6 family was retired 2026-09-22**
(there is no GPT-6 Terra — Codex upgrades 5.6 Terra to 6 Sol). Anthropic's flagship is
**Claude Opus 5.5** (`claude-opus-5-5`, 1M/128K, full low→max ladder including `xhigh`; Opus 5
retired), and xAI's is **Grok 4.7** (4.6 and 4.5 retired). A retired id is never an error: a saved
session on one falls back to the provider default on next start. Astra rides a
**responses-lite** shape in `gg-ai/src/providers/openai-codex.ts` — `usesResponsesLite(model)`
turns `parallel_tool_calls` off, defaults effort to `low` instead of `none`, sends
`context: "all_turns"`, and identifies as `originator: "codex_cli_rs"` with a Codex 0.153.4
User-Agent, because the ChatGPT-OAuth entitlement is checked against the *client*, not the model.
**The non-lite branch keeps `originator: "ogcoder"` — main writes `ggcoder` there, so re-check it
on every sync.** `docs/model-audit-2026-09-05.md` (deleted upstream 2026-10-09; read it from git history) was the standing record of what each entry's
limits were verified against (32 hosted entries), including the DeepSeek `Off`/low/high/max fix,
Fugu Ultra v1.1's real `max` effort, aligned DeepSeek/GLM/Moonshot output caps, and the rule that
**Moonshot-only `ms://` upload handles must never be forwarded to another provider** when video
rides through shared history. **Sakana Fugu** (provider `sakana`, OpenAI-compatible `https://api.sakana.ai/v1`) is a multi-agent system surfaced as a standard LLM — models `fugu` (routes across providers) and `fugu-ultra` (heavier tier, may need larger client timeouts); both 1M context, top thinking tier `xhigh`. The MiniMax provider defaults to **MiniMax M3** (1M context, image + video) and also carries **MiniMax H3** (`MiniMax-H3`, same 1M/131k/`high`-thinking shape as M3 — it is a registry entry only, not the default; the id is never special-cased, since MiniMax handling is provider-level throughout `stream.ts`/`transform.ts`). Note the registry's `supportsImages`/`supportsVideo: true` on both MiniMax entries disagrees with `stream.ts`, which strips every image/video/document block for the whole provider because the Anthropic-compatible endpoint rejects them — pre-existing, and H3 inherits it. Video-capable models are Gemini 3.x, Kimi K3/K2.7, MiniMax M3, and the whole Xiaomi **MiMo-V2.6** series. That series (released 2026-09-22) replaced every V2.5 id, and the shape changed with it: **every V2.6 text model is natively full-modal**, so unlike V2.5 the coding flagship takes image/video too. It is `mimo-v2.6-pro` (the provider default, `medium` tier), `mimo-v2.6-flash` (the provider's `low` tier, so scout sub-agents and compaction summaries land there) and `mimo-v2.6-pro-ultraspeed` (a lower-latency, premium-priced sibling — API-only, so credentials resolve from the API Credits key alone: `authStorageKeys: [XIAOMI_CREDITS_KEY]`, while the other two use `["xiaomi", XIAOMI_CREDITS_KEY]`). **This branch carries `supportsDocuments: true` on all three** — main has no such flag, so re-attach it on every sync. **Kimi K3** joins the video-capable set, and **Kimi K2.8 Preview** (`kimi-for-coding`) shares its effort ladder and wire shape. DeepSeek's cheap tier is **V4.1 Flash** (`deepseek-flash`), Sakana adds **Fugu Max** (`fugu-max`, tops out at `xhigh`), and OpenRouter's Qwen is **Qwen3.8 Max**. MiMo-V2.6 rides the OpenAI-compatible transport: video/image go as base64 data URLs (`video_url`/`image_url`); its base64 payload cap is 50 MB, so the registry's `maxVideoBytes` is ~36 MB raw to stay under it after base64 inflation. Video attachments work in the chat input (drag, paste, or type a path); for non-video models the clip is saved to a temp file and the model is told to inspect it with ffmpeg (mirrors the GLM image fallback). `supportsVideo`/`maxVideoBytes` (and this branch's `supportsDocuments`) live in `packages/gg-core/src/model-registry.ts`.

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

- **`gg-app/src-tauri/src/`** — Rust shell, split into modules on 2026-10-09 (`lib.rs` is now just setup + window events; `windows.rs`, `daemon.rs`, `settings.rs`, `state.rs`, `commands/`, …). Owns a `Sidecars` registry keyed by window
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
Newer surfaces: `AskBand` + `Dropdown` (the `ask_user` question band — clickable options rendered
inline in the transcript, answered from the composer; see **Asking the User** below),
`useSmoothText` + `rehype-animate-words` + `Markdown.animate` (rAF-paced streaming reveal with a
per-word blur-in — deltas arrive in bursts, so pacing the *paint* rhythm off the *network* rhythm
is what makes a stream lurch; honors `prefers-reduced-motion`), `window-glow.ts` (ambient glow
placed from the window label so it is stable per window yet different across tiled windows, with a
`GlowState` of `idle`/`working`/`done` so "busy" is legible from across the room — deliberately
outside React so it is unit-testable; **never put a `filter` on it**, see the note in `App.css`:
the original full-window `filter: blur(80px)` was software-blurred by WebKit on every repaint and
pinned the GPU process above 400% CPU, so hue variation now goes through
`hsl(from … calc(h + var(--glow-hue)) s l)` behind an `@supports` guard), `CIIndicator.tsx`
(current-commit GitHub CI progress in the title bar, fed by `gitHubCI` on the sidecar state from
`ggcoder/src/utils/github-ci.ts`, which polls `gh api --paginate --slurp`; it shows **only runs
observed in flight** and hides a green result 10s later, so old history never decorates the
window — and it is explicitly **not verification evidence**), `QueuedBar` (prompts queued behind a
running turn),
`McpElicitModal` (renders an MCP server's `elicitation/create` form), `ScorecardModal`, `RunningSchedulesButton` +
`ScheduleHint` (see below), `changelog.ts`, `projectAccent.ts` (per-project accent color), and
`collapse.ts` + `Markdown.collapse` (measured collapsing of long messages).

**`/schedule`** (`scheduleCommand.ts`, `useSchedules.ts`, `schedule-labels.ts`) runs a prompt on a
repeating interval: `/schedule <prompt> | <every> [| <times>]`. Segments are resolved
**right-to-left** — that is the whole reason it's a module and not a `text.split("|")`: a coding
prompt very often contains a pipe (`ps aux | grep node`), and splitting on the first bar would
silently truncate the prompt to `ps aux`.

### Workspace persistence (window arrangement)

`~/.gg/gg-app-workspace.json` (owned by Rust: `settings.rs` for the snapshot, `state.rs` for the debounce, `daemon.rs` for restore) records every open window in label
order. A window with a project chosen is saved with its mode, cwd, session and geometry. A window
still on the picker is saved as a geometry-only `picker: true` tile. The file is written on project
select, window close and quit, and also 600 ms after windows stop moving, resizing or tiling
(`schedule_workspace_snapshot`). `restore_or_default_windows` replays the file at launch. It uses
the saved geometry only when **every** rect still lands on a connected display
(`rect_on_some_monitor`), and otherwise re-tiles the whole set. A deliberate window close removes
that window's entry; closes during quit leave the file intact.

### Project discovery + app settings

- **Discovery** lives in `packages/ggcoder/src/core/project-discovery.ts` (its one home; the
  gg-boss re-export shim went away with that package). `discoverProjects()` scans ggcoder + Claude Code + Codex
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

## CLI parity with gg-app (@abukhaled branch)

Upstream ships features to the desktop app first, and the Ink TUI runs its **own** agent loop
(`ui/hooks/useAgentLoop.ts`), not `AgentSession`. So anything the desktop gets through
`AgentSession` or the sidecar is missing from `ogcoder` until it is wired in by hand. **Every
`/app-update` sync checks what upstream added to gg-app and brings the terminal-appropriate
parts here** (step 5b of `~/.claude/commands/app-update.md`). Rules: reuse the shared core
module the sidecar calls, never copy sidecar logic; one commit per feature; ask before anything
large or of unclear fit; keep this list current.

Built 2026-10-09, plus local models, `hf` and `steroids` on 2026-10-11 and four more on 2026-10-18 (all in `packages/ggcoder/src/ui/` unless noted):

| Desktop feature | Terminal equivalent | Wiring |
| --- | --- | --- |
| Shared slash registry | `/help` (commands + shortcuts), `/settings`, `/session`, `/new`, `/add-dir`, `/remove-dir`, `/teach-me`, `/compact <focus>`, `/model provider:model` | `tui-slash-commands.ts` builds `createBuiltinCommands()` minus what App.tsx owns; `/add-dir` roots are one array shared by the write guard and `useModeState` (`core/workspace-roots.ts`, also used by `AgentSession`) |
| `ask_user` band | keyboard picker above the input, **tool not registered** (2026-10-16, by choice: with it the prompt turns every question, even an optional "want me to also…?", into a blocking picker; without it the model asks as a prose last line). Do not re-add on a sync. The desktop keeps it | `ask-user-host.ts` (sidecar bridge + late answers), `ask-user-state.ts` (pure key reducer), `components/AskUserPanel.tsx`; still used by MCP elicitation forms |
| Export chat | `/export [file] [--tools …] [--thinking] [--force]` | `tui-export.ts` over `core/session-export.ts` |
| Health badge + checklist | `/health [review]`, `/checklist [run <id> \| next]` | `tui-health.ts`; the run prompt's `tool_search` step is rewritten because the TUI loads every tool up front |
| CI / dirty files / PR counts | footer `statusLabel` segment | `hooks/useRepoStatus.ts` + `repo-status.ts`; `getCurrentGitHubCI` added to `utils/github-ci.ts` |
| Usage meter | `/usage [provider]` | `tui-usage.ts` reusing `app-sidecar/usage.ts`'s service |
| Run status | one line after each run | `run-verification.ts` over `collectVerificationEvidence` + `describeTurnVerification`, checks after the last edit only; silent on unchecked edits since the 2026-10-11 sync (checks are left to `/commit`) |
| Cache-expiry strip | held send + warning, Enter again sends | `cache-expiry-gate.ts`; the touch lives in `sessionStore.cacheTouch` so remounts keep it |
| Keep-awake | held while a run is in flight | `KeepAwake` from `cli.ts`; `keepAwake` added to `config.ts` `SavedSettings` |
| Prompt enhancer | `/enhance <draft>` → rewrite in the input box | `tui-enhance.ts` |
| MCP elicitation | forms rendered with the `ask_user` picker | `mcp-elicit-form.ts` (schema ↔ questions), `mcp-elicit-host.ts` (queued, sidecar bridge) |
| Foreign session import | `ogcoder sessions` lists Claude Code/Codex rows and imports on pick; `/import <file>` | `sessions.ts` `loadSessionRows`, `tui-import.ts` |
| Local models | scanned at startup (awaited only when starting on one), listed in `/model` as "Local", `ogcoder local [add <url> \| remove <id>]` | `core/local-scan.ts` (the scan, moved out of `app-sidecar.ts`, which now calls it), `cli/local.ts`; `"local"` is in `resolveActiveProvider`'s list and `ModelSelector` reads `getAllModels()` so runtime models show |
| Add from Hugging Face | `ogcoder hf search <query>`, `ogcoder hf pull <org/model>` (progress line, Ctrl+C cancels) | `cli/hf.ts` driving the sidecar's `createHfPullManager` with a printing `broadcast` |
| Steroids install | `ogcoder steroids [install]` | `cli/steroids.ts` over `probeSteroids` / `installSteroids` |
| `/add-dir` without a cache rewrite (2026-10-12) | mid-conversation root changes append a hidden env note | `ui/roots-prompt-update.ts` over `core/env-delta.ts`; falls back to rebuilding the prompt while a run is in flight |
| Slash commands from every root (2026-10-18) | `.gg/commands` of the project and each `/add-dir` root (project wins), re-read every 2 s | `App.tsx` `reloadCustomCommands` over `loadWorkspaceCustomCommands` |
| Deck Git panel (2026-10-18) | `/git`: changed files with line counts, open PRs and issues | `tui-git.ts` over `utils/git-overview.ts` + `getGitHubRepoSlug` |
| Paid-model confirmation (2026-10-18) | picker asks to confirm; a typed `/model <paid>` is refused until `--confirm-paid` | `ModelSelector.tsx` (from main) and `paid-model-switch.ts`, throwing the same `PaidModelConfirmationError` |
| Steroids disk size (2026-10-18) | `ogcoder steroids` prints the corpus size on disk | `cli/steroids.ts` reading `probeSteroids().diskSize` |
| gg-safe cooldown + feed (2026-10-19) | `packageCooldownDays` honoured by the TUI's bash tool; daily threat feed synced at startup | `config.ts` `SavedSettings.packageCooldownDays`, `startThreatFeedSync` in `cli.ts` |
| gg-safe notices (2026-10-19) | infected-lockfile line + hidden agent note, `⚠ Blocked for safety (rule) · target` rows, don't-install list | `ui/safety-watch.ts` over `installed-threats` / `blocked-packages-file` / `parseSafetyBlock`; created once in `cli.ts` so remounts keep it |
| Hidden providers (2026-10-26) | the `/model` text list uses `getListedModels()` like the sidecar; the picker was already filtered because `hasProviderAuth` reports a hidden provider as not connected | `App.tsx` `getModelList` |
| Per-model output cap (2026-10-19) | each turn requests the model's own `maxOutputTokens`, trimmed to fit beside the compaction trigger (was a flat 16K, so long replies kept hitting the limit) | `ui/output-cap.ts` over `outputCapForRequest`, used in `App.tsx` |

Not ported, and why: `/schedule`, `@`-file search and autopilot/`@ken` (sidecar- or webview-only
logic, awkward in a terminal; ask first); the chat agents, GG Motion and GG Goals (whole separate
workspaces; GG Goals is a candidate for an `ogcoder goal` mode, ask first); sound, radio, XP/rank, What's New, notes, window layout and Disk Access permissions
(desktop-only), plus the update banner and goal farm map, Trophies (achievements, an XP-style layer) and GG Royale (a web-hosted game in an iframe), both 2026-10-26. Hedged streaming, routine bash-output compaction and the project file list reach the TUI through shared code (`agentLoop`, `tools/bash.ts`, `system-prompt.ts`). The Deck's model and Usage panels are already `/model` and `/usage`; the Settings About page, farm sounds, Ken status pill and ask_user motion are desktop-only. Gemini API-key login and background-failure wakes reached the CLI through shared code (`cli/auth.ts`, `core/process-manager.ts`). Blocked-skill warnings and MCP hidden-tool lines (`ogcoder mcp list`) came from upstream directly. Still open: the interactive `ogcoder mcp` dashboard does not render a row's `warning` yet. Nothing else terminal-suited is left to port as of 2026-10-26.

Fixed on the way (2026-10-11): `ogcoder sessions` showed "(no prompt)" for gzipped cold sessions
and the summary text for compacted ones, because it re-read each file as plain JSONL; it now uses
the `preview` that `SessionManager.list()` already computes. Sub-agent children (`--json`) on a
local model failed with "Not logged in" — in the desktop app too — because nothing scanned in the
child; `cli.ts` now scans before `runJsonMode` when the provider is `local`.

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
- `AGENTS.md` — a ~20-line stub that points here plus the CI rule. Main replaced the old stale Codex-targeted copy of this file wholesale in the 2026-08-28 sync; do not grow it back into a second CLAUDE.md.

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
pnpm --dir Matey lint                     # The Matey Electron app lints separately
```

> **Known gap:** `pnpm test` fails in `Matey` with `Cannot find package 'jsdom'` — its
> `vitest.config.ts` sets `environment: "jsdom"` but `jsdom` isn't in `Matey/package.json`.
> Pre-existing, unrelated to the spine; the root workspace's own tests all pass. Run
> `pnpm -r test` to exercise the workspace packages without it.

`lint`/`format` cover `packages/*/src/**`, then run `Matey` via `pnpm --dir Matey ...` and `gg-app` via its workspace filter. `build`/`check`/`test` run recursively across root workspace packages and then run the isolated Matey app. `ggcoder` builds with `tsc`; `gg-ai`/`gg-agent`/`gg-core` build with `tsup` (ESM + CJS + DTS).

## Architecture

### Data Flow

`stream()` (gg-ai) → `agentLoop()` (gg-agent) → tools + session (ggcoder)

### gg-ai: Provider-Agnostic Streaming

- **Provider registry** (`provider-registry.ts` + `stream.ts`): Map-based dispatch. Built-in providers registered at module load: `anthropic` and `minimax` → `streamAnthropic()` (MiniMax-M3 uses an Anthropic-compatible endpoint); `gemini` → `streamGemini()` (native Gemini transport, OAuth via `core/oauth/gemini.ts`); `openai`, `glm`, `moonshot`, `xiaomi`, `ollama`, `deepseek`, `openrouter`, `sakana`, `xai`, and `local` → `streamOpenAI()` with provider-specific baseUrl/config.
- **Reasoning field aliases** (`providers/reasoning-field.ts`): OpenAI-compatible endpoints disagree on the field name — `reasoning_content` (DeepSeek, GLM, Moonshot, Xiaomi) vs `reasoning` (newer vLLM builds, several gateways). `REASONING_FIELD_ALIASES` reads both, `reasoning_content` first so shipping endpoints stay byte-identical. Reading only one name loses the thinking content _silently_ on the others — the turn still succeeds.
- **Strict tool schemas** (`utils/strict-tool-schema.ts`): OpenAI-style constrained sampling, so the provider guarantees tool arguments match the JSON Schema *at sampling time* — killing the class of malformed tool calls that otherwise costs a retry round-trip each and an aborted turn on the third. Strict mode demands a subset Zod does not emit: every key in `properties` also in `required`, `additionalProperties: false`, optionals rewritten as nullable unions, and no compositional keywords (`$ref`, `oneOf`, `allOf`, `patternProperties`, …) at all. `makeStrictToolSchema` rewrites what it can and throws `UnsupportedStrictSchemaError` for what it cannot (refs, unions of objects, tuples), so the caller **falls back silently to the non-strict schema — "prefer", never "require"**. Because strict mode forces the model to emit `null` for every optional it did not want, a null-arg stripping pass runs on the way back.
- **Well-formed history** (`utils/well-formed.ts`): Strips lone (unpaired) UTF-16 surrogates out of messages before they hit a provider. One split emoji — from a model streaming a half escape inside tool-call arguments, a character-indexed truncation cutting an astral character, or raw file/shell bytes — makes `JSON.stringify` emit `\uD83D`-style escapes that every provider's JSON parser rejects ("no low surrogate in string" / "Bad Request"). Because the bad string then **persists in history**, every later turn fails too, including after a retry or a model switch.
- **`sliceHead`/`sliceTail`**: surrogate-safe truncation helpers, used by `grep` and `web-fetch` for bounded tool output.
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

**Error recovery**: context overflow → force compact + retry (3x), overload 429/529 → exponential backoff 2-30s (10x), stream stall → retry (5x) with tiered timeouts (**45s first-event, scaled by prompt size** above 20K tokens to a 180s ceiling — a cold prefill on a large prompt is not a stall — then 90s idle once output streams, **5min idle inside an open tool call** because buffered tool input arrives in bursts, 90s hard cap pre-output, 5min once output is flowing, and **10min idle / 15min hard cap** after thinking because adaptive thinking is silent on the wire; a stall retry is surfaced only after the failed attempt cost 60s). `assessCacheHealth` reads the turn's usage and emits a `cache_health` / `prompt_cache_miss` diagnostic when a prompt above 40K tokens was served less than half from cache; those lines are the evidence that moves a provider between the compaction latency tiers above, empty response → retry (2x), abort → graceful exit.

**Agent events**: `text_delta`, `thinking_delta`, `toolcall_delta`, `tool_call_start/update/end`, `turn_end`, `agent_done`, `retry` (with `silent` flag for hidden retries), `model_switch`, `steering_message`, `follow_up_message`, `server_tool_call/result`, `error`.

### ggcoder: CLI Application

- **Tools** (`tools/`): Factory functions returning `AgentTool<ZodSchema>`. Each tool gets `ToolOperations` interface for I/O abstraction (local fs by default, injectable for remote). Core tools: `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`, `web-fetch`, `web-search`. Content tools: `web-fetch` (multi-URL with bounded concurrency, Markdown extraction via `html-extract.ts` using turndown, PDF text via `pdf-extract.ts` using unpdf, prefers `/llms.txt` for docs), `screenshot` (Playwright-driven page capture). Advanced tools: `subagent` (spawns child `ogcoder` process in json-mode, streams NDJSON back), `skill` (injects skill markdown into context), `tasks`/`task-output`/`task-send`/`task-stop` (background task management — `task_send` writes to a background process's stdin pipe to answer prompts or drive REPLs, with optional Enter/EOF; `task_output` takes `wait_ms` to **block until the process exits or a declared wake fires** rather than sleeping for a guessed duration, capped by `MAX_PROCESS_WAIT_MS` = 600 000 and declaring `timeoutMs: MAX_PROCESS_WAIT_MS + 30_000` so the loop's default per-tool ceiling cannot cancel it mid-wait — see **Background wakes** below), `enter-plan`/`exit-plan` (plan mode gating), `ask_user` (`tools/ask-user.ts` — ends a reply with clickable options instead of prose; see **Asking the user** below), `steroids` (`tools/steroids.ts` — a local corpus of real GitHub repos, registered only when the `steroids` binary is present; see **Agent Steroids** below). Navigation: `code_nav` (`tools/code-nav.ts` — LSP-backed `definition` / `references` / `symbols` / `hover`; exact and cross-file, so prefer it over grep for "who calls this" and "where is this defined", and it says so explicitly when no language server can answer). UI adoption: `ui_registry` + `ui_adopt` (`tools/ui-registry.ts`, `tools/ui-adopt.ts` over `core/{ui-registry,ui-adoption,ui-compatibility}.ts` — browse and adopt shadcn-style components from the two pinned registries `bklit/bklit-ui` and `kokonut-labs/kokonutui`; see **UI Component Adoption** below). Context-efficiency tools: `code-skeleton` (TS-AST extraction of a file's public API — signatures kept, bodies stubbed — for a fraction of a full read's tokens), `compress` (signal-preserving tool-output compression — keeps errors/JSON shape/head+tail vs blunt truncation), `generate-image` (registered only when OpenAI is connected; the `model` parameter picks **`gpt-image-2.5-flare`** — the default, fast — or **`gpt-image-2.5-sunburst`** for precise editing, selected on the `image_generation` tool itself rather than routed by the backend, with `transparent` backgrounds now supported and rejected only against `jpeg` output).

  **Every bash launch runs with `-o pipefail`** (`core/shell.ts` `resolveShell`, plus the
  persistent session shell in `tools/bash.ts`). A POSIX pipeline otherwise exits with the *last*
  stage's status, so `pnpm test | tail -20` returned tail's 0 and **a red suite read green** — to
  the model reading the result and to the verification gate reading the exit code. It covers the
  POSIX branch, the `GG_BASH` override, and Git-Bash on Windows; `cmd.exe` has no equivalent and
  is left alone. Do not drop the flag when merging — the bash tool's description promises it, so
  the model reasons about piped checks on the assumption that it holds.

**Tool tiering** (`tools/tool-tiers.ts`): the built-in toolset is split in two. A **core** tool ships
its full JSON parameter schema on every request, inside the cached prefix — it earns that cost by
being reached in most sessions. A **deferred** tool contributes one `- **name**: hint` line
(~15-25 tokens) to the system prompt's Tools section instead of a schema (~300-500 tokens), and
`tool_search` promotes it into the live toolset the moment the model asks for that capability.
**That index line is what makes deferral safe** — dropping a schema without advertising the
capability trades tokens for capability blindness, since the model cannot search for a tool it does
not know exists. Every deferred name is therefore required to carry a `TOOL_PROMPT_HINTS` entry,
enforced by test. Tier rule: a tool stays core if it is reached in more than roughly one in five
sessions — measure capability-discovery rates, not just the token saving, before moving a name.
- **MCP** (`core/mcp/`): Servers configured with command (stdio) or url (HTTP/SSE with fallback). Tools wrapped as `AgentTool` with `mcp__${server}__${tool}` naming. Rate-limited (2s min gap).
- **Model router** (`core/model-router.ts`): Per-turn model switching. Modes: `vision` (auto-switch on images/video/docs), `plan-execute` (heavy planner + light executor), `hybrid` (vision priority, then plan-execute). Vision fallback chain: GLM-4.6V → MiMo-V2.6 → Moonshot → OpenAI (Claude excluded for cost) — see the GLM vision-model note below, which the chain depends on. A router override and gg-agent's per-turn credential refresh touch the same `stream()` call: `turnApiKey`/`turnBaseUrl` carry the override, `liveApiKey` carries a token re-resolved from `auth.json` mid-run, and `turnApiKeyIsRouterOverride` stops the refresh from replacing an override that points at a *different provider* with the default provider's token. Keep that flag when merging `agent-loop.ts`.
- **Compaction** (`core/compaction/compactor.ts`): Triggers at 80% context or `contextWindow - 16384` tokens (whichever is lower). Keeps system message + recent ~20K tokens intact. Middle section summarized via LLM. Falls back to extractive summary on failure. `compaction/policy.ts` resolves the per-run policy (`targetTokens` + a stable `policyKey`); `compaction/query-aware-selector.ts` ranks which older messages to retain against the current query, degrading to a `fallback` strategy when ranking yields nothing useful. Persistence is **leased**: `AgentSession.compact()` runs inside `sessionManager.withCompactionLease(conversationId)`, rebases onto the canonical session when one is newer (`resolveCanonicalSession` + source fingerprints), and reuses a prior successful checkpoint rather than re-summarizing — so two windows on one conversation can't supersede newer history by generation. Transient sessions (Ken chat/autopilot, subagent spawns) and sessions with no `conversationId` take the in-memory branch and never touch the session store.

  **Latency-capped triggering** (2026-09-22). A provider can advertise a window its transport
  cannot actually serve: observed GLM prefill ran ~3-5K tok/s uncached (44-68s time-to-first-token
  at 213K tokens), so a session at 21% of a 1M window paid a 45-70s tax on *every* call while never
  approaching the 85% trigger. `resolveLatencyWindowCap(provider)` caps the window used for
  **triggering only** — hard request and output limits still follow the model's real window — in
  three evidence-driven tiers: **measured slow** gets an explicit cap (`glm: 176_000`), **measured
  healthy** is exempt (`anthropic`, because our transport sends explicit `cache_control`
  breakpoints; `openai`, from a sidecar audit showing flat 5-6s TTFT p95 at 237K tokens over 2 000+
  turns), and **everything unmeasured** takes `DEFAULT_LATENCY_WINDOW_CAP` (400K), which only bites
  mega-windows and leaves ordinary 200-272K windows alone. `min()` keeps a smaller advertised window
  authoritative. Move a provider between tiers off the `cache_health` / `prompt_cache_miss`
  diagnostics, not a hunch.

  **Post-turn background compaction**: `AgentSession.postTurnCompaction` summarizes *after* a turn
  ends rather than blocking the next prompt. Every entry point that reads history awaits the
  in-flight promise first, so nothing observes a half-compacted session.
- **Sessions** (`core/session-manager.ts`): Append-only JSONL with DAG structure (leafId for branching). Streams line-by-line for large files. `repairToolPairs()` fixes interrupted sessions on restore. Storage mechanics live in `core/session-storage.ts`: sessions older than `COLD_SESSION_AGE_DAYS` (7) are gzipped to `.jsonl.gz` behind a `.jsonl` redirect stub, media is externalized to a `.jsonl.assets` sidecar via markers, and persisted tool text is capped at `MAX_PERSISTED_TOOL_TEXT_CHARS` (40 000). `core/session-export.ts` renders a session to a self-contained Markdown transcript — built from the _persisted messages_ (not the webview's `Item[]`, which keeps tool activity in the LiveToolPanel and would export a chat with the work missing), reusing the `restoreUserRow`/`restoreAssistantTexts` helpers `/history` uses. `core/foreign-session-import.ts` (+ `foreign-transcript-blocks.ts`) parses **Claude Code, Codex, and Cursor** transcripts into real ggcoder sessions so a thread started in another tool can be continued here — fixtures for all three live in `core/__fixtures__/*-transcript.jsonl`.
- **Auth** (`core/auth-storage.ts`, `core/oauth/`): OAuth PKCE for Anthropic and OpenAI (with token refresh + 401 retry); static API keys for GLM, Moonshot, Xiaomi, MiniMax, DeepSeek, Ollama, OpenRouter, Sakana, and xAI. Local endpoints use `local:<id>` keys. All credentials stored in `~/.gg/auth.json`. Provider selection at startup uses `resolveActiveProvider()` in `cli.ts` — falls back to the first authenticated provider if the saved one isn't logged in.
- **Themes** (`ui/theme/`): Six themes — `dark`, `light`, `dark-ansi`, `light-ansi`, `dark-daltonized`, `light-daltonized` — plus `auto` (detects from terminal). ANSI variants use 16-color palette for limited terminals; daltonized variants are color-blind friendly. `loadTheme(name)` in `theme.ts` returns the JSON config; `ThemeContext` + `useTheme()` for read, `SetThemeContext` + `useSetTheme()` for runtime switching.
- **UI**: Ink 6 + React 19. `useAgentLoop` hook drives the agent and surfaces events to React state. Throttled streaming flush at ~16ms intervals to avoid saturating renders. (`utils/token-to-ansi.ts` and `markdown-cache.ts` were removed as dead code on 2026-10-09.) Terminal hyperlinks via `utils/hyperlink.ts` (gated by `supports-hyperlinks.ts`). Cross-component state (taskbar, etc.) lives in `ui/stores/` using a tiny `create-store` pattern. **Recent refactoring** splits rendering logic into focused modules: `app-items.ts` (unified item types), `layout-decisions.ts` (layout routing per state), `item-helpers.ts` (item transforms), `terminal-history-format.ts`/`terminal-history-status-renderers.ts` (separated terminal rendering concerns). `ui/thinking-level.ts` manages thinking level cycling per model. Other ui/ subdirs: `transcript/` (tool-call presentation in history), `hooks/`, `utils/`, `constants/`, `testing/`. See `INK_ARCHITECTURE_GUIDE.md` for the full rendering model.
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
- **rpc**: JSON-RPC interface for programmatic control. Supports `--resume <id|path>` (see `resolveResumePath`): `AgentSession`'s `sessionId` option takes a session *path*, not an id, so a bare id is resolved through `SessionManager.findById` first — passing an id straight through loads nothing and silently starts an empty conversation. An unresolvable id is deliberately non-fatal and starts a fresh session. Before this, `--resume` was parsed by the CLI and dropped on the way into RPC mode, so editors and ACP bridges that reopened a thread got a process with none of its history.
- **acp** (`modes/acp-mode.ts`): [Agent Client Protocol](https://agentclientprotocol.com) agent over stdio — the standards-based sibling of `rpc`, so ACP clients (Zed, pew2, any spec-conformant editor) drive OG Coder with no ogcoder-specific code. Implements `initialize` plus `session/{new,prompt,cancel,list,load,resume,close,delete,set_mode,set_config_option}`; everything in `agentCapabilities` is really implemented, because a client must be able to trust that list. **stdout carries protocol frames only** — diagnostics go to stderr or the log file, and a stray `console.log` anywhere in the process corrupts the stream and disconnects the client.

### Plan Mode

The plan mode system lets the agent propose a structured plan before executing. Tools: `enter-plan` (agent enters plan-drafting state, pauses execution) and `exit-plan` (submits the plan for user approval). The TUI renders the approval flow through `PlanOverlay` (`PlanApproval`, `PlanBanner` and `PlanProgress` were removed as dead code on 2026-10-09); gg-app has its own plan review. `/plan` and `/plans` slash commands are UI-handled (need `agentLoop.reset()` access).

### Asking the User (`ask_user`)

`tools/ask-user.ts` + `core/ask-user.ts` + `core/parked-requests.ts`, rendered by gg-app's
`AskBand` / `Dropdown`. A question the agent ends a reply with becomes **clickable options in the
transcript**, not prose. Kinds: `confirm` / `choice` / `multi` / `text`, with an optional free-text
escape (`allowOther`) and a `recommended` tag on the agent's own pick — tagged, never preselected.

- **A click sends only that option.** Each option must therefore be a complete instruction, not one
  that asks the user to specify something further.
- **Core-tiered wherever it is registered at all** (`CORE_TOOL_NAMES` + a `TOOL_PROMPT_HINTS`
  entry). A question the model has to `tool_search` for first is a question it writes in prose
  instead; hosts with nobody to answer never build the tool, so they pay nothing for it.
- **`createParkedRequests`** is the shared mechanism under both this and the MCP elicitation
  bridge: a tool call blocks, is broadcast to the host UI under a fresh id, and settles over a
  different transport. Every parked request is **guaranteed a terminal state** — settled,
  `cancelAll`ed on abort/teardown, or timed out (`ASK_USER_TIMEOUT_MS`, 10 min) — because one that
  never resolves hangs the turn forever.
- A user who **types a prompt instead of clicking supersedes** the question
  (`{ action: "cancel", superseded: true }`) rather than leaving the turn parked
  (`app-sidecar-ask-supersede.test.ts`).

### Extensibility: Agents, Skills, Custom Commands, Extensions, Style Packs

The first three systems discover markdown files with YAML frontmatter from two locations (merged, project-local wins on conflict):

- **Global**: `~/.gg/{agents,skills,commands}/`
- **Project-local**: `{cwd}/.gg/{agents,skills,commands}/`

**Agents** (`core/agents.ts`): Frontmatter keys: `name`, `description`, `tools` (comma-separated). Body is the system prompt. Two built-in agents ship with every install:

- `owl` — read-only codebase explorer (tools: read, grep, find, ls, bash)
- `bee` — general task worker (tools: read, write, edit, bash, find, grep, ls)

They live in `core/bundled-agents.ts` as **TypeScript constants, not `assets/*.md`** — the desktop
sidecar bundler externalizes asset trees, so a new asset is a packaging risk while constants
compile straight into `dist`. They are also **no longer seeded into `~/.gg/agents`**: a seeded file
shadows every future improvement forever (user-dir agents win by design), which is the bug
`removeShadowingSeededAgents` exists to undo. Writing `~/.gg/agents/<name>.md` still overrides a
bundled definition of the same name.

**Skills** (`core/skills.ts`): Frontmatter: `name`, `description`. Body is injected into context by the `skill` tool when the agent invokes it by name. Bundled skills live in `packages/ggcoder/assets/skills/<id>/SKILL.md` (some with a `references/` folder): `bulletproof` (security audit protocol), `compliance-guard`, `evidence-led-ui`, `clarify`, `tdd`, `root-cause`, `shared-language`, `code-review`, `lean`, `durable`, and `refactoring` (behavior-preserving transforms in test-guarded steps, with `references/{smells,legacy,agent-pitfalls}.md`). Skill routing fires **mid-build**, not only at the start of a turn. Descriptions and the rendered catalog are byte-capped — see Context Budgets above.

**Custom Commands** (`core/custom-commands.ts`): User-defined slash commands loaded alongside built-ins from `~/.gg/commands/` (global) and `{cwd}/.gg/commands/` (project wins on collision). Frontmatter: `name`, `description`. Body is the prompt injected into the agent. Expansion is one shared module — **`core/prompt-command-expansion.ts`** — used by prompt delivery, transcript restoration and the autopilot gate alike. `expandPromptCommand(template, args)` substitutes every `$ARGUMENTS` in a single pass (so an inserted `$` is never re-expanded), and **when args are present** wraps the result as `## Command Template` + a `## Slash-command invocation` preamble + `## User Instructions` + a closing rule: explicit user choices override conflicting template defaults, non-conflicting procedure steps survive, and arguments may be literal data rather than instructions. `matchPromptCommand` reverses that expansion for best-effort transcript restoration, still recognising the legacy bare `\n\n## User Instructions\n\n` shape. The TUI refreshes custom commands while open and reloads them immediately before slash-command submission, so commands copied from sources like `riaz-skills/commands/*.md` into `~/.gg/commands/` or `.gg/commands/` appear without restarting.

**Extensions** (`core/extensions/`): JS plugin system — `ExtensionLoader.loadAll()` imports every `*.js` file in `~/.gg/extensions/` at `AgentSession` startup. Each file default-exports (or exports `createExtension`) a factory returning an `Extension` that receives an `ExtensionContext`. `core/extensions/plugin-bundles.ts` installs extensions as **bundles** — validated with Zod and hard-capped at 5 MB / 500 files, with an extension allowlist (`.js`, `.mjs`, `.cjs`, `.json`, `.md`, …).

**Style Packs** (`core/style-packs/`): Per-language best-practice prompt sections. `core/language-detector.ts` detects project languages; `loadPack(id, cwd)` injects the matching pack into the system prompt — a project can override any bundled pack via `<cwd>/.gg/styles/<id>.md`. Verification commands for detected languages are injected alongside (`detectVerifyCommands`).

> **Note:** The **Eyes — Perception Probes** integration (`isEyesActive`, `ogcoder eyes`, the journal/overlay, and the `/setup-eyes` + `/eyes-improve` commands) was **removed** upstream in the 2026-07-20 sync, and `packages/ggcoder-eyes` itself was deleted in the 2026-09-07 sync. Nothing consumes it and the directory is gone; do not re-add the eyes dependency or system-prompt section when merging.

### Checkpoints & Rewind

> **Note:** The standalone Goals System (goal-store/goal-worker/goal-worktree/goal-verifier/goal-prerequisites and the `/goals` UI) was **removed** upstream in the 4.3.237 sync (2026-06-01). Its responsibilities are now covered by lighter, focused modules below plus the existing Task Management System.

- **Checkpoint Store** (`core/checkpoint-store.ts`): Snapshots conversation/work state so the agent can roll back. Backs the `RewindOverlay` UI and the `checkpoint-hook` that captures restore points around risky edits.
- **Loop Breaker** (`core/loop-breaker.ts`): Detects repetition in the agent's output — `detectTextRepetition()` and `toolCallSignature()` flag when the model is stuck repeating text or identical tool calls (`LoopBreakStats`), surfaced through `useAgentLoop`.
- **Semantic Loop Judge** (`core/semantic-loop-check.ts`): the layer between the deterministic
  breaker above and silence. `evaluateLoopBreak` sees only **syntactic** repetition — identical
  calls, unchanged results, A/B cycles, repeated text — so it is blind to the common thrash where
  every retry differs slightly (new args, a swapped tool, a file edited then reverted) while the
  run makes no real progress. An LLM judge on the session's **active** model catches that shape.
  The whole design is cost control: it never runs unless failures are already accumulating
  (`SEMANTIC_LOOP_MIN_CONSECUTIVE_FAILURES` = 2) **and** the deterministic breaker stayed quiet —
  when that one fires it owns the correction — with a `SEMANTIC_LOOP_COOLDOWN_TURNS` (4) cooldown,
  a hard `MAX_SEMANTIC_LOOP_CHECKS` (2) per run, and at most `MAX_SEMANTIC_LOOP_CALLS` (12) recent
  calls as context rather than the transcript. Verdicts are **reset per prompt** — a judgment
  about the last prompt's thrash is noise on the next one.
- **Regrounding** (`core/regrounding.ts`): Periodically re-anchors the agent to the original task to counter drift on long runs.

- **Verification Evidence** (`core/verification-evidence.ts`): Classifies whether a shell command the agent ran actually constitutes verification (`passed` / `failed` / `rejected`, plus a `candidate` flag so ordinary shell work isn't judged at all), reusing `read-only-bash.ts`'s segment splitting. The completion gate reads evidence, not the model's claim.
- **Process Gate** (`core/process-gate.ts`): The process-side twin of `SubAgentManager.completionGateMessage`. `ProcessManager` pushes progress/exit checkpoints into the *steering* path, which only lands while the agent is still looping — so an agent about to stop never sees them and can claim "done" with a test still running or a build that already exited non-zero unread. Deliberately pure, so `AgentSession` and the Ink app wire it identically.
- **Agent Notifications** (`core/agent-notifications.ts`): Bounded, deliberately **lossy** push queue for out-of-band facts (a child finishing, a background build progressing or exiting). Only the latest entry per `(kind, id)` survives, and a terminal entry supersedes pending non-terminal ones and can never itself be overwritten by a straggling progress tick. Every bound protects injected bytes per drain — these ride the steering path into live context.
- **Background wakes release a blocking wait** (`ProcessManager.waitForExitOrWake`,
  2026-09-09): a `wake` rule (pattern match or `silence_seconds`) used to only enqueue a
  steering notification, and **steering cannot interrupt a tool call** — so `task_output`
  with `wait_ms` on a dev server that printed "ready" blocked until the server shut down or
  the 10-minute ceiling expired. The wake now also emits `gg:wake` on the child, settling the
  wait directly, and `proc.wakeReason` retains a wake that fired *before* the wait began
  (cleared on the next `readOutput`). `WAKE_INTERVAL_MS` is **500ms**, not 5s, so readiness is
  sub-second; and exhausting the progress-report budget retires only the *progress* watcher
  (`disposeProgressWatcher`) — a slow server that becomes ready afterwards must still fire.
- **Run Claim** (`core/run-claim.ts`): Closes the check→start race in the sidecar's `/prompt` handler. `running` only flips once `runAgent` begins, but the handler awaits attachment prep and workflow specs first, and Node yields at each await — so a second prompt re-read `running === false` and called `session.prompt()` concurrently on a session already prompting. The claim is taken **synchronously, in the same tick as the check**.
- **Verification Snapshot** (`core/verification-snapshot.ts`): a bounded, local-only fingerprint
  of the Git workspace, so the gate can distinguish "nothing changed since the last green check"
  from "re-verify". Ignored build output is excluded; tracked files and explicitly edited inputs
  never are. Hard caps: 10 000 files, 128 MB, 5 s — and **every uncertainty declines the
  optimization** (missing Git, symlinks, submodules, races, blown limits all mean the caller must
  require a fresh check) rather than asserting a stale pass.
- **Internal Diagnostics** (`core/internal-diagnostics.ts`, `tools/session-stats.ts`,
  `/diagnose`): agent-facing counters and timings about its own session — per-turn usage/timing,
  per-tool calls/errors/durations with clustered error digests, identical-call repeats (>=3x),
  truncations, model switches, compactions — so it can notice waste and self-correct. **Not a
  public feature**: gated on `GG_INTERNAL=1` or `~/.gg/internal.json` `{"diagnostics": true}`, and
  when off nothing is recorded, no tool is registered, and `/diagnose` does not exist, so the
  public tool list and the cached prompt stay byte-identical. Never captures prompt text, file
  contents, or credentials.
- **Run Journal** (`core/run-journal.ts`): `RunJournalEntry`/`RunOutcome` records persisted alongside the session, for crash-durability and post-hoc run inspection.

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

## Agent Steroids (`steroids`)

Real-code research is a **native tool** now, not an MCP server — this replaced
`kencode-search` outright in the 2026-09-02 sync. `core/steroids.ts` does detection,
probe, and install; `tools/steroids.ts` is the tool; `SteroidsModal.tsx` + the Home
screen button are the desktop install flow; `/steroids` (in `core/prompt-commands.ts`)
is the guided corpus-building command.

- **One tool, an `action` discriminator**: `search` / `define` / `show` / `files` /
  `repos` / `discover` / `recent` / `add`. Every action is an **argv array through
  `execFile`, never a shell string**, and the CLI's own JSON error shape
  (`{"error"}` on stdout, exit 1) becomes the tool error.
- **Three timeout tiers, because the actions are not alike**: 30s default, 60s for
  `discover`/`recent` (they hit GitHub), and **10 minutes** for `add` (it downloads
  whole repos, and a batch of ten legitimately runs minutes).
- **Registered only when the binary exists.** `system-prompt.ts` gates its sentence on
  `active.has("steroids")` — absent, the tool is not built and the prompt says nothing,
  rather than advertising a capability that would fail. It is **core-tiered** when it is
  registered at all (`CORE_TOOL_NAMES`), same reasoning as `ask_user`.
- **Install mirrors the CLI's own `upgrade.rs`**: pinned GitHub release URL, sha256
  verified against the release's `SHA256SUMS`, size-capped (`MAX_ASSET_BYTES`, 100 MB,
  applied to the download *and* the inflated binary), single-entry tar extraction to a
  fixed path, then a `--version` smoke test. **No shell anywhere** — this is a network
  download becoming an executable, so every step is checked before the next one runs.
- `STEROIDS_NO_UPGRADE=1` is set per call (`steroidsEnv()`, read fresh so startup PATH
  enrichment is picked up) to stop the CLI self-upgrading on every invocation.

## UI Component Adoption (`ui_registry` / `ui_adopt`)

shadcn-style component registries, browsed and adopted as a *plan* rather than a download.
`core/ui-registry.ts` holds the two providers — `bklit/bklit-ui` and `kokonut-labs/kokonutui` —
each **pinned to an exact revision**, with every manifest and payload validated through a strict
Zod schema (bounded name slugs, 240-char paths, 500 KB file bodies) and content-hashed. Every
fetch goes through `checkUrlPolicy`, so the network allowlist governs it like any other egress.

`core/ui-adoption.ts` builds an `AdoptionPlan` with the TypeScript AST rather than copying files:
each target is marked **`new` / `reuse` / `conflict`**, and the plan carries `missingPackages`,
`blockers`, styles and attribution. An adoption that would overwrite existing work is reported,
never performed silently. `core/ui-compatibility.ts` patches known upstream/framework mismatches.

Both tools are **deferred-tier** (`DEFERRED_TOOL_NAMES`): reaching for a component library is rare
enough that neither schema belongs in the cached prefix, and the index line is what keeps the
capability discoverable. Guidance lives in the bundled `evidence-led-ui` skill; the live harness,
`bench/ui-library-real-flow/`, was deleted upstream on 2026-10-18.

## gg-safe Security Layer (2026-10-19 sync)

Upstream's supply-chain and action guards, all local and fail-open on network errors:
`core/package-threats.ts` (malware, typosquat, provenance downgrade and serious-flaw rules for installs; HIGH/CRITICAL-flawed versions move to the newest fixed release in the same major), `core/package-cooldown.ts` (versions younger than `packageCooldownDays`, default 2, are hidden from installs), `core/threat-feed.ts` (daily OSV `MAL-` feed for npm and PyPI, `startThreatFeedSync`), `core/action-threats.ts` (exfil, auto-run config writes, AI CLIs with safety off; `parseSafetyBlock` reads the rule from a tool result's `Blocked … (rule)` prefix), `core/skill-scan.ts` (`discoverSkillsWithBlocked` keeps unsafe skills out), `core/mcp/tool-guard.ts` (hides unsafe MCP tools; `hiddenToolMessage`), `core/installed-threats.ts` (lockfile scan for packages flagged after install) and `core/blocked-packages-file.ts` (a managed "don't install" block in the project's CLAUDE.md/AGENTS.md). `AgentSession` emits `security_block` / `security_notice` on the event bus; the TUI's equivalent is `ui/safety-watch.ts`.

## Redaction-Placeholder Guard (`tools/redaction-guard.ts`)

Tool output passes through secret redaction before the model sees it, so a file holding
`API_KEY=sk-…` reads back as `API_KEY=[REDACTED]`. If the model then writes back what it saw, the
real secret is **silently replaced by the marker and lost** — a data-destroying edit that looks
completely ordinary in the transcript. `edit` and `write` now check for that before writing.

It is deliberately precise rather than blanket. A file whose redacted view equals its real content
(nothing was hidden from the model) is never restricted, so code and tests that legitimately
contain the marker text keep working. Only when the model's view of *this* file had values hidden
does a write that adds markers beyond what the file really contains get rejected.

## Shell Command Guards (`tools/bash.ts`)

Every model-issued shell command passes a stack of deterministic, local guards before it runs.
They are bookkeeping on the command text, **not a sandbox** — see **OS Sandbox** below for real
containment.

- **Catastrophic commands** (`core/workspace-guard.ts` `isCatastrophicCommand`) — recursive removal
  of a filesystem root, `~`, the workspace, or anything containing them; `find` deleting from
  root/home (or the workspace with no filter); mirror force-pushes. Parsed with the shared
  `walkShell` scanner from `core/destructive-git-guard.ts`, so it sees through `;`/`&&`/pipes,
  subshells, `bash -c`/`eval`, wrappers and `cd`.
- **@abukhaled-preserved: outside-workspace removal.** The same pass also refuses a recursive
  removal whose resolved target lies outside every workspace root (the write guard's roots via
  `workspaceRootsFor`, plus `CONVENTIONAL_TEMP_ROOTS`), honouring `allowOutsideWorkspaceWrites`
  and `/add-dir` roots. Without it `write ~/notes.md` is blocked while `rm -rf ~/notes` runs
  unattended. Unexpanded `$VAR`s and globs are never blocked. Main has no such check, so expect
  its tests to list home-subdirectory removals as allowed — move them, do not drop the guard.
- **Destructive git** (`core/destructive-git-guard.ts`) — commands that would discard uncommitted
  work, since checkpoints only capture write/edit edits.
- **Shell threats** (`core/shell-threats.ts`) and **package threats** (`core/package-threats.ts`,
  OSV lookup fails open).

## Temp Paths (`core/temp-paths.ts`)

`getTempRoots()` replaces bare `os.tmpdir()` in the workspace guard, the sandbox and
`tools/path-utils.ts`, because "the temp directory" is not one path: macOS aliases its own
(`/tmp` → `/private/tmp`, `/var/folders` under it) and Windows shells mount a *different* `/tmp`
than the Win32 API reports. On Windows `getMsysTempDir` **asks the selected bash where its `/tmp`
really is** (`cygpath -aw /tmp`) rather than guessing an install path, with a 3s timeout, and
rejects malformed output, embedded newlines, a bare drive root, and the home directory — a failed
translation must not silently retarget `C:\tmp`. Results are cached against the shell + env key.

On this branch these roots go **through the shared `workspaceRootsFor` helper**, not an inlined
array at the write-guard call site: that helper is what stops the write guard and the removal guard
from drifting into disagreeing about what "inside the workspace" means.

## Evidence-Based Task Status (`core/run-status.ts`)

What the desktop's activity line says about a run is derived from **host-observed**
`VerificationEvidence`, never from assistant text. `describeTurnVerification` also refuses to
inherit across turns: a run that changed nothing does not carry forward the previous turn's green,
and a `rejected` entry or a check with no evidence at all surfaces as the current problem. The
gg-app side is `task-activity.ts` + `activity-copy.ts` (with a `task-outcome-matrix` test pinning
every combination), and GG status messages are request-scoped so a stale one cannot decorate a new
run.

## Platform CLI Detection (`core/platform-clis.ts`)

31 hosted-platform CLIs (Railway, Vercel, `gh`, …) detected into the system prompt.
The problem it solves: without this the model does not know `railway` is on PATH and
sends the user to a web dashboard for something `railway logs` answers directly.

Detection is **filesystem-only**, exactly like verify-commands — a project signal file
in `cwd` (`railway.json`, `vercel.json`, `.vercel`, …) plus the binary on PATH, global
or in `node_modules/.bin`. **Nothing is spawned and auth is never probed**: a `whoami`
costs a network round trip on every startup and goes stale mid-session anyway. Each
entry instead carries its own `login` command, and the model asks the user to run that
when a call fails on auth.

## Bounded Shutdown (`core/shutdown.ts`)

Teardown reaches third-party code we do not control — MCP servers over stdio, LSP servers,
extension `deactivate()` hooks, Telegram long-polls. Any one of them can hang forever, and an
await-everything shutdown then never reaches `process.exit`: the app *appears* to quit while the
daemon keeps its port, or the CLI keeps polling with nobody attached. Every long-running entry
point arms a **deadline** instead, so a wedged dependency costs a few seconds, not the process.

**`SIGHUP` matters as much as `SIGINT`.** Closing a terminal delivers exactly one hangup and never
a second key press, so a process that only force-exits on the *second* Ctrl+C survives as an
orphan. Register both.

## Verification Gate, Context Budgets, and the Prompt Golden

Three harness-owned guards that a prompt instruction cannot replace, because each one is
bookkeeping on what actually happened rather than on what the model claims.

- **Verification gate** (`core/verification-gate.ts`). If a run mutated code files and no
  test / typecheck / lint / build ran *after the last mutation*, a pre-stop hook injects a
  follow-up demanding the project's verification — **one initial demand
  (`MAX_VERIFICATION_INJECTIONS`) plus at most one post-verification recheck**, and the
  recheck only when new edits invalidated a check that had already completed. Unchanged work
  never repeats the demand, because a gate that keeps prompting past the model's decision to
  stop only buys extra full-length final answers; when the bounded budget runs out the demand
  falls back to requiring disclosure of what went unverified.
  Two classifiers, deliberately unequal. A broad runner-shape classifier — applied per segment
  of a compound command, and now seeing through `git status` preludes — spots verification
  *attempts*; **both of its error directions are safe** (a miss leaves the gate silent, a false
  positive skips one continuation). Authoritative *success* comes from the stricter
  `verification-evidence` classifier plus **host-observed exit status and the revision captured
  at command start** — missing or rejected evidence cannot clear an outstanding check. State
  rides the session under `VERIFICATION_STATE_KIND` behind a Zod schema
  (`seq`/`mutation`/`verified`/`files`/`failedChecks`/`unknown`), with each check keyed by the
  sha256 of its command.
  Its second half is **check-integrity review** (renamed from "tamper disclosure",
  2026-09-09). A passing check proves something only if the check was not itself the thing
  that changed — editing a test, a runner config, or adding a suppression pragma turns a red
  suite green while producing a transcript byte-for-byte identical to a real fix — so
  mutations that alter what a check *asserts* are recorded separately from ordinary code
  mutations. The message now frames them as **review candidates, not evidence of
  wrongdoing**: inspect the diff internally, and *"for legitimate added coverage or corrected
  expectations, do not add a defensive explanation to the final response"*. The old wording
  demanded a defense in the final response, so ordinary TDD work produced a paragraph aimed
  at the user justifying entirely normal test edits. Report only confirmed weakening,
  unresolved doubt, or unverified changes. Opt out with `"verificationGateEnabled": false`.
  Both gate messages end with a shared `VERIFICATION_OUTCOME_GUIDANCE`: this is an internal
  hook, **not new user authorization and not a new task** — the previous draft may never have
  been shown, so lead with the task outcome, keep a pending user decision alive, and **do not
  re-request an approval the user already gave**. The `verificationReason: "check_review"`
  variant rides `BusEventMap` into gg-app's `useAgentEvents`. One evidence fix: `format` sat
  in `UNSAFE_PACKAGE_SCRIPTS` with a `(?::|$)` tail, so **`format:check` — a real read-only
  verification — was rejected as a mutating script**; it is now `format(?!:check$)`.
  **The gate only arms on a run that touched what it guards** (`runTouched`, 2026-09-07).
  Inherited debt alone used to re-arm it, so a run that edited nothing — a question, a review,
  "what does this do?" — was answered with a verification demand instead of an answer, on every
  prompt, forever. Both the demand and the tamper disclosure now also end with *"whatever the
  user last asked still needs a direct answer — never reply with verification status alone."*
  And a demand explains **why** a green run already in the transcript did not count
  (`lastRejectedCheck` names the command and the reason) and, on a recheck with no tracked file
  edits to list, which file-rewriting command invalidated the earlier pass
  (`lastInvalidationCause`) — without those the agent kept re-running the same untrusted command
  shape and the gate never cleared.
- **Context byte-budgets** (`core/context-limits.ts`, setting `contextLimits`). Skills and
  MCP servers are attacker-controllable content that a hostile skill file or server can bloat
  without limit, so every prompt-injected input is capped: one skill description, the whole
  rendered skill catalog, an MCP tool description in the deferred catalog, a promoted MCP
  tool's serialized schema (oversized = **refused**, not truncated), the combined project
  instruction files, and an emergency ceiling on the assembled system prompt. The caps bound
  per-request token cost *and* the prompt-injection surface.
- **Cached-prompt golden** (`src/__golden__/system-prompt-prefix.md` +
  `system-prompt.golden.test.ts`). The cached prefix is diffed per section, so a tool or
  prompt edit cannot ship unreviewed. Regenerate with
  `UPDATE_GOLDEN=1 pnpm --filter @abukhaled/ogcoder test -- system-prompt.golden`, **in the
  same commit as the change that caused it**. On this branch the golden legitimately differs
  from main by the removed fart easter-egg in How to Talk, so expect to regenerate it on
  every sync — but read the section diff first; that diff is the whole point of the test.

**Environment delta** (`core/env-delta.ts`) is the same instinct applied to cache economics.
The Environment section (cwd, extra roots, network allowlist) renders once into the cached
prompt, but `/set networkAllow …` changes those facts mid-session — leaving the model arguing
with a host it believes is allowed. Re-rendering is the expensive answer: Environment is the
**last** cached section, so rewriting it invalidates everything after it (~10k tokens on a
small conversation, ~120k on a large one, to correct ~40 tokens of text). The difference is
appended as one short hidden message instead.

**Learned output ceilings** (`gg-agent/src/output-ceiling.ts`): a model's real `max_tokens`
is not knowable from configuration — it varies by provider, by route (a gateway can cap lower
than the origin), and it changes under us — so the only reliable source is the provider saying
no, and that answer is remembered. In-memory and per-process by design: a stale ceiling that
outlived a quota or plan change should cost one rejection, not a config file the user has to
find and delete.

## @abukhaled-preserved: GLM vision models

Upstream retired every GLM id except `glm-5.3` (and, as of the 2026-09-01 sync, its cheap
sibling `glm-5.3-flash`). This branch **keeps** `glm-4.6v`, `glm-5v-turbo`, `glm-4.6v-flashx`,
and `glm-4.6v-flash` on top of that pair, because `getVisionModel` routes image turns to
`glm-4.6v` at the head of the documented vision fallback chain (GLM-4.6V → MiMo-V2.6 →
Moonshot → OpenAI). The registry order is `glm-5.3`, `glm-5.3-flash`, then the four vision
entries, and `model-registry.test.ts` asserts exactly that list — extend it on a sync rather
than taking main's "the 5.3 pair is the whole provider" assertion verbatim.


**The trap this creates:** the 2026-08-16 retirement also removed GLM's *text-side* flash models,
which made the first low-tier GLM entry in the registry a vision model. `glm-5.3-flash` (added
2026-09-01) is a real low-tier text sibling again and sits ahead of the vision entries, so the
guard below is currently finding the right model — but it is what *makes* that ordering safe, and
the failure returns the moment a vision entry sorts first again. `getFastModel` / `getSummaryModel`
pick "the first `costTier === "low"` sibling", which would silently route scout and
compaction-summary work to a 128k/16k image model. Guarded by an explicit `visionSpecialist` flag
on `ModelInfo` plus the shared `getCheapTextSibling()` helper both functions call — **keep both
when merging**, and keep the two GLM tests aligned with them rather than taking main's
"glm-5.3 is the sole GLM model" assertions verbatim.

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
`loadCustomCommands()`, any test asserting a custom-command _count_ reads the developer's real
global commands unless it fakes home first. Upstream tests won't do this — add it when merging.

## Code Quality

After code changes that need compiled outputs, also run `pnpm build`.

> **A registry edit is invisible until `gg-core` is rebuilt.** `MODELS` lives in
> `packages/gg-core/src/model-registry.ts`, but ogcoder consumes gg-core through its compiled
> `dist/` — and a globally linked `ogcoder` (`pnpm --filter @abukhaled/ogcoder link --global`
> symlinks straight at `packages/ggcoder`) therefore runs against whatever the last build
> produced, not the working tree. Add a model, pass `pnpm check`/`pnpm test`, restart the CLI,
> and the model is simply **absent from `/model` with no error** — the symptom looks like a
> missing entry or a provider-auth filter, not a stale artifact. Run
> `pnpm --filter @abukhaled/gg-core build && pnpm --filter @abukhaled/ogcoder build` after any
> registry change (gg-app needs no extra step — it bundles `app-sidecar.js` from source at
> build time). Same trap for any gg-core edit: auth storage, app paths, thinking levels.

A prompt or tool-definition edit also changes the **cached prompt golden** — if
`system-prompt.golden.test.ts` fails, read the per-section diff it prints, and only then
regenerate with `UPDATE_GOLDEN=1 pnpm --filter @abukhaled/ogcoder test -- system-prompt.golden`,
committing the regenerated `src/__golden__/system-prompt-prefix.md` alongside the change.

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

- **Why discovery is per-kind.** `GET /v1/models` reports no useful _capabilities_, so each
  server kind (`LocalEndpointKind`) has its own probe: Ollama → `POST /api/show`
  (`capabilities[]` + `model_info["<arch>.context_length"]`); LM Studio → `GET /api/v0/models`
  (`type`, `state`, `max_context_length`); llama.cpp → `GET /props`
  (`default_generation_settings.n_ctx`); vLLM/custom → nothing reliable (`max_model_len`
  sometimes rides the model object).
- **Read the RUNNING allocation, not the training maximum** (2026-09-06). A model's advertised
  context is what it *could* do; what it can do right now is what the server actually loaded it
  with, and using the former overruns the real budget. Discovery reads Ollama's running models
  (`/api/ps`) and LM Studio's loaded instances (v1, with a v0 fallback), validates the limit is a
  positive integer, and otherwise reports a conservative **4K `unknown`** rather than guessing
  high. When LM Studio routes by model key, the **smallest** known loaded allocation wins.
  Compaction summaries respect the summary model's output ceiling for the same reason — that
  ceiling is small exactly when the summary model is a local one.
- **One scan, two hosts.** `ggcoder/src/core/local-scan.ts` (`scanLocalModels(force)` +
  `localStatePayload(probes)`) probes every endpoint, writes a credential only for servers that
  answered, and replaces the `local` runtime models. The desktop sidecar and the `ogcoder` CLI
  (startup, `ogcoder local`, `ogcoder hf pull`, and `--json` sub-agent children) all call it.
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
   request URL _and every redirect hop_ against the allowlist. Nothing leaves those tools to a
   disallowed host.
2. **Defence in depth, bypassable by design** — `extractCommandHosts` recognises common network
   command shapes (`curl`, `wget`, `git`, `ssh`/`scp`, package installs) so `bash` can refuse an
   obvious egress. This is **not a sandbox**: `python -c`, a shell variable, a base64'd URL, or
   any unrecognised tool walks straight past it. It catches accidents, not a hostile model. Real
   containment needs OS-level enforcement (sandbox-exec, Landlock/seccomp, a netns proxy).

Allow-shaped, not deny-shaped: a command with **no recognised host is never blocked**, so
ordinary work is unaffected. `isHostAllowed` matches exact hosts and `*.example.com` wildcards.

## OS Sandbox (`sandboxMode`)

`core/sandbox.ts` (+ `sandbox-domains.ts`, `sandbox-feedback.ts`) is the OS-level enforcement the
allowlist above deliberately is not: `bash` commands run filesystem- and network-isolated via
sandbox-runtime. `SandboxPolicy.mode` comes from the `sandboxMode` setting in `~/.gg/settings.json`:

- `off` (**default**) — no isolation.
- `auto` — isolate wherever the platform supports it, degrade **with a warning** where the
  prerequisites are absent (Linux needs bubblewrap/socat, Windows needs an elevated
  `windows-install`). Failing closed there would break every command on those hosts.
- `workspace` — always isolate and **fail closed**.

Network inside the sandbox is allow-listed against `DEFAULT_ALLOWED_DOMAINS` plus
`SandboxPolicy.allowedDomains`, unless `strictDomains` drops the built-in developer defaults.
`SandboxPolicy.allowUnixSockets` (setting `sandboxAllowUnixSockets`, **macOS only**) opts
specific sockets back in — Docker listens on `/var/run/docker.sock`, which is otherwise
unreachable from inside the sandbox.

**It is opt-in for a reason** — see the comment on `sandboxMode` in `core/settings-manager.ts` for
the verified day-one breakage (Linux pipes/redirections under seccomp, macOS git-over-SSH failing
the SOCKS handshake, `git config --global` refused). Do not flip the default.

## LSP Inline Edit Diagnostics

Successful `edit`/`write` tool results get compiler-grade error diagnostics — but
**asynchronously** (2026-09-09): the tool returns immediately with "Diagnostics queued;
results will arrive before completion. This is not verification.", the check runs on the
microtask queue (superseded writes to one file coalesce into a single run on the final
content), and the results reach the model through the steering path. Only the **completion
boundary** waits (`flushDiagnostics` in `getHookFollowUpMessages`). Before this, every edit
blocked for up to the 3s warm / 8s first-touch budget on a file the model was often about to
edit again. Three rules make deferring safe: `hasQueuedDiagnostics()` feeds
`wouldInjectVerification()`, so the agent cannot stop while evidence is still queued; a
timeout or server failure is reported as **"not verified — do not infer success from
silence"**, never as silence; and the queue is capped at `snapshotLimit` (100) with an
explicit overflow disclosure rather than a quiet drop. `clearPendingDiagnostics()` (on abort
and `resetHookState`) forgets an abandoned run's deliveries. Code lives in
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
- **Clients are pooled process-wide** (`core/lsp/pool.ts`), keyed on `(server, project root)` and
  reclaimed when idle. Before this, every `AgentSession` built its own `LspManager`, so two windows
  open on one repo ran two complete tsserver stacks over identical files — LSP was the heaviest
  thing in the app.
- Opt out with `"lspDiagnostics": false` in `~/.gg/settings.json`. `rebuildToolsForCwd`
  (mid-session chdir) releases the old manager's clients; exit handlers call
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

- `kencode-search` — **REMOVED upstream (2026-09-02 sync).** Real-code research is the native `steroids` tool now (see **Agent Steroids** below), so the server, its `@kenkaiiii/kencode-search` dependency, and `core/mcp/resolve-stdio.ts`'s npx rewrite are gone. `prompt-commands.test.ts` asserts no prompt mentions "kencode" — do not reintroduce it.
- `grep` — HTTP, `https://mcp.grep.app` (grep.app public GitHub code search, tool `mcp__grep__searchGitHub`). Branch-only addition (not upstream), and now the **only** entry in `DEFAULT_MCP_SERVERS`. It survives the kencode removal as the `/compare` fallback: the `/compare` prompt in `core/prompt-commands.ts` prefers `steroids` and falls back to `mcp__grep__searchGitHub` when the binary is not installed. Preserve both the server and that fallback sentence in merges from main, which has neither.
- `zai_vision` / `zai_web_search` / `zai_web_reader` / `zai_zread` — added automatically when a GLM (Z.ai) key is present, via stdio `@z_ai/mcp-server`. `zai_vision` carries a **180s** per-call timeout rather than the 60s the quick HTTP zai calls use: GLM-4.6V analysis of a large screenshot legitimately runs 20-60s+ (observed 52s successes and 60s-cap kills in the sidecar logs), and `client.ts` applies the timeout per tool **call**. The GLM image-routing hint names the real tool and is gated to GLM only.
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

### Shared connection pool, catalog cache, elicitation

- **The SDK import path is the flat `@modelcontextprotocol/client` package**, not the old
  `@modelcontextprotocol/sdk/client/*` deep paths. `Client`, both HTTP transports,
  `StdioClientTransport` (from `/stdio`), `UnauthorizedError`, `OAuthError`, `SdkError`, and the
  `ElicitRequest`/`ElicitResult` types all come from there.
- **stdio connections are process-wide shared by default** (`core/mcp/shared-pool.ts`). The daemon
  hosts many `AgentSession`s at once (one per window, plus Ken chat and autopilot inside each), and
  each used to spawn its own child per server — measured at 7 live copies of one stdio server,
  ~43 MB each, doing identical work. A stdio connection has nothing session-specific in it (every
  one is spawned with `cwd: os.homedir()`), so sharing is safe.
- **Tool catalogs are cached** by `hashServerConfig` (`core/mcp/catalog-cache.ts`).
- **Elicitation** (`elicitation.ts` + `elicitation-bridge.ts`): the client declares
  `capabilities.elicitation.form` only when a handler is wired, and answers `elicitation/create`.
  `url` mode is declined cleanly rather than throwing, for servers that ignore the declared caps.
  Surfaced in gg-app as `McpElicitModal`.
- **Keep the client identity `{ name: "ogcoder" }`** in every `new Client(...)` site — main's
  merges reintroduce `"ggcoder"` there.
- `mcpModernProtocol` (settings, default **false**) opts into the 2026-07-28 revision: connect
  probes `server/discover` and falls back to the 2025 `initialize` handshake. Off by default
  because the probe costs a round trip and a legacy stdio server that ignores it pays the timeout.
- `deferredMcpTools` (settings, default **true**) keeps MCP tool schemas out of the prompt until
  `tool_search` discovers them — ~8k tokens/cache-miss turn with two servers (`bench/RESULTS.md`).

### Caveats

- **Connection is startup-only.** MCP connects once at launch (`connectInitialMcpTools` in `cli.ts`). Adding a server via `ogcoder mcp` mid-session won't hot-load it — restart ogcoder.
- **Mid-session chdir.** Project-scoped servers load relative to `process.cwd()` at startup. Any flow that swaps cwd mid-session (`process.chdir` + `rebuildToolsForCwd`) won't drag project MCP servers along with it.
- **WebSocket transport** is parsed but rejected (no WS client today).
- **Env var expansion** (`${VAR}`) in `.mcp.json` is NOT expanded in v1 — values pass through literally.


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
  - Windows only). gg-app builds the spine **from source** (`workspace:*`, not the published
    npm versions) and bundles `packages/ggcoder/dist/app-sidecar.js`, so npm need not be
    published first — but publish Track A first so the shipped CLI and app stay in lockstep.

### Track A — npm packages (Changesets)

Manual multi-package version bumping is gone — do **not** hand-edit `version` fields.
The framework spine — `@abukhaled/gg-ai`, `@abukhaled/gg-agent`, `@abukhaled/gg-core`,
and `@abukhaled/ogcoder` — is a **fixed group** in
`.changeset/config.json`: a changeset touching any one bumps them all to the same
version together. Those four are now the entire published surface (the retired
packages left the group in the 2026-09-07 sync).

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

**`release.yml` must build `gg-core` before `ogcoder`.** It was missing from that step, so a
release could compile the sidecar against a stale `gg-core/dist` — the same trap the registry
note above describes, but in CI where nobody sees it. `gg-app/scripts/release-workflow.test.mjs`
now asserts the exact four-command build order as a regression test, so editing that step means
editing its assertion in the same commit (both carry the `@abukhaled` scope on this branch).
