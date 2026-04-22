/**
 * Prompt-template commands — slash commands that inject detailed prompts
 * into the agent loop. Each command maps to a full prompt the agent executes.
 */

export interface PromptCommand {
  name: string;
  aliases: string[];
  description: string;
  prompt: string;
}

export const PROMPT_COMMANDS: PromptCommand[] = [
  {
    name: "scan",
    aliases: [],
    description: "Find dead code, bugs, and security issues",
    prompt: `Find quick wins in this codebase. Spawn 5 sub-agents in parallel using the subagent tool (call the subagent tool 5 times in a single response, each with a different task), each focusing on one area. Adapt each area to what's relevant for THIS project's stack and architecture.

**Agent 1 - Performance**: Inefficient algorithms, unnecessary work, missing early returns, blocking operations, things that scale poorly

**Agent 2 - Dead Weight**: Unused code, unreachable paths, stale comments/TODOs, obsolete files, imports to nowhere

**Agent 3 - Lurking Bugs**: Unhandled edge cases, missing error handling, resource leaks, race conditions, silent failures

**Agent 4 - Security**: Hardcoded secrets, injection risks, exposed sensitive data, overly permissive access, unsafe defaults

**Agent 5 - Dependencies & Config**: Unused packages, vulnerable dependencies, misconfigured settings, dead environment variables, orphaned config files

## The Only Valid Findings

A finding is ONLY valid if it falls into one of these categories:

1. **Dead** - Code that literally does nothing. Unused, unreachable, no-op.
2. **Broken** - Will cause errors, crashes, or wrong behavior. Not "might" - WILL.
3. **Dangerous** - Security holes, data exposure, resource exhaustion.

That's it. Three categories. If it doesn't fit, don't report it.

**NOT valid findings:**
- "This works but could be cleaner" - NO
- "Modern best practice suggests..." - NO
- "This is verbose/repetitive but functional" - NO
- "You could use X instead of Y" - NO
- "This isn't how I'd write it" - NO

If the code works, isn't dangerous, and does something - leave it alone.

## Output Format

For each finding:
\`\`\`
[DEAD/BROKEN/DANGEROUS] file:line - What it is
Impact: What happens if left unfixed
\`\`\`

Finding nothing is a valid outcome. Most codebases don't have easy wins - that's fine.`,
  },
  {
    name: "verify",
    aliases: [],
    description: "Verify code against docs and best practices",
    prompt: `Verify this codebase against current best practices and official documentation. Spawn 8 sub-agents in parallel using the subagent tool (call the subagent tool 8 times in a single response, each with a different task), each focusing on one category. Each agent must VERIFY findings using real code samples or official docs - no assumptions allowed.

**Agent 1 - Core Framework**: Detect the main framework, verify usage patterns against official documentation

**Agent 2 - Dependencies/Libraries**: Check if library APIs being used are current or deprecated. Verify against library documentation

**Agent 3 - Language Patterns**: Identify the primary language, verify idioms and patterns are current

**Agent 4 - Configuration**: Examine build tools, bundlers, linters, and config files. Verify settings against current tool documentation

**Agent 5 - Security Patterns**: Review auth, data handling, secrets management. Verify against current security guidance and OWASP recommendations

**Agent 6 - Testing**: Identify test framework in use, verify testing patterns match current library recommendations

**Agent 7 - API/Data Handling**: Review data fetching, state management, storage patterns. Verify against current patterns and framework docs

**Agent 8 - Error Handling**: Examine error handling patterns, verify they match library documentation

## Agent Workflow

Each agent MUST follow this process:
1. **Identify** - What's relevant in THIS project for your category
2. **Find** - Locate specific implementations in the codebase
3. **Verify** - Check against real code or official docs
4. **Report** - Only report when verified current practice differs from codebase

## The Only Valid Findings

A finding is ONLY valid if:
1. **OUTDATED** - Works but uses old patterns with verified better alternatives
2. **DEPRECATED** - Uses APIs marked deprecated in current official docs
3. **INCORRECT** - Implementation contradicts official documentation

**NOT valid findings:**
- "I think there's a better way" without verification - NO
- "This looks old" without proof - NO
- Style preferences or subjective improvements - NO
- Anything not verified via real code or official docs - NO

## Output Format

For each finding:
\`\`\`
[OUTDATED/DEPRECATED/INCORRECT] file:line - What it is
Current: How it's implemented now
Verified: What the correct/current approach is
Source: URL to official docs or evidence
\`\`\`

No findings is a valid outcome. If implementations match current practices, that's good news.`,
  },
  {
    name: "research",
    aliases: [],
    description: "Research best tools, deps, and patterns",
    prompt: `Research the best tools, dependencies, and architecture for this project.

First, if it's not clear what the project is building, ask me to describe the features, target platform, and any constraints. If you can infer this from the codebase, proceed directly.

Then spawn 6 sub-agents in parallel using the subagent tool (call the subagent tool 6 times in a single response, each with a different task). Every agent must verify ALL recommendations - no training-data assumptions allowed.

**Agent 1 - Project Scan**: Read the current working directory. Catalog what already exists: config files, installed deps, directory structure, language/framework already chosen. Report exactly what's in place.

**Agent 2 - Stack Validation**: Research whether the current framework/language is the best choice for this project. Compare top 2-3 alternatives on performance, ecosystem, and developer experience. Pick ONE winner with evidence.

**Agent 3 - Core Dependencies**: For EACH feature, find the single best library for this stack. Confirm latest stable versions. No outdated packages. Output: package name, version, one-line purpose.

**Agent 4 - Dev Tooling**: Research the best dev tooling for this stack: package manager, bundler, linter, formatter, test framework, type checker. Pick ONE per category with exact versions.

**Agent 5 - Architecture**: Find how real projects of this type structure their code. Look for directory layouts, file naming conventions, and key patterns. Output a concrete directory tree and list of patterns.

**Agent 6 - Config & Integration**: Research required config files for the chosen stack and tools. Cover: linter config, formatter config, TS/type config, env setup, CI/CD basics.

## Agent Rules

1. Every recommendation MUST be verified - no guessing
2. Confirm latest stable versions - do not assume version numbers
3. Pick ONE best option per category - no "you could also use X"
4. No prose, no hedging, no alternatives lists - decisive answers only

## Output

After all agents complete, synthesize findings into a single RESEARCH.md file:

\`\`\`markdown
# RESEARCH: [short project description]
Generated: [today's date]
Stack: [framework + language + runtime]

## INSTALL
[exact shell commands - copy-paste ready]

## DEPENDENCIES
| package | version | purpose |
[each purpose max 5 words]

## DEV DEPENDENCIES
| package | version | purpose |

## CONFIG FILES TO CREATE
### [filename]
[exact file contents or key settings]

## PROJECT STRUCTURE
[tree showing recommended directories]

## SETUP STEPS
1. [concrete action]

## KEY PATTERNS
[brief list of architectural patterns]

## SOURCES
[URLs used for verification]
\`\`\`

Write the file, then summarize what was researched.`,
  },
  {
    name: "init",
    aliases: [],
    description: "Generate or update CLAUDE.md for this project",
    prompt: `Generate or update a minimal CLAUDE.md with project structure, guidelines, and quality checks.

## Step 1: Check if CLAUDE.md Exists

If CLAUDE.md exists:
- Read the existing file
- Preserve custom sections the user may have added
- Update the structure, quality checks, and organization rules

If CLAUDE.md does NOT exist:
- Create a new one from scratch

## Step 2: Analyze Project (Use Sub-agents in Parallel)

Spawn 3 sub-agents in parallel using the subagent tool (call the subagent tool 3 times in a single response):

1. **Project Purpose Agent**: Analyze README, package.json description, main files to understand what the project does
2. **Directory Structure Agent**: Map out the folder structure and what each folder contains
3. **Tech Stack Agent**: Identify languages, frameworks, tools, dependencies

Wait for all sub-agents to complete, then synthesize the information.

## Step 3: Detect Project Type & Commands

Check for config files:
- package.json -> JavaScript/TypeScript (extract lint, typecheck, server scripts)
- pyproject.toml or requirements.txt -> Python
- go.mod -> Go
- Cargo.toml -> Rust

Extract linting commands, typechecking commands, and server start command (if applicable).

## Step 4: Generate Project Tree

Create a concise tree structure showing key directories and files with brief descriptions.

## Step 5: Generate or Update CLAUDE.md

Create CLAUDE.md with: project description, project structure tree, organization rules (one file per component, single responsibility), and zero-tolerance code quality checks with the exact commands for this project.

Keep total file under 100 lines. If updating, preserve any custom sections the user added.

## Step 6: Restart Notice

End your reply with this exact notice so the user doesn't miss it:

> ⚠️ CLAUDE.md was created/updated. ggcoder loads it at startup, so **exit and restart ggcoder** (\`/quit\` then run \`ggcoder\` again) before continuing. Without a restart, I won't see the new context.`,
  },
  {
    name: "setup-lint",
    aliases: [],
    description: "Generate a /fix command for linting and typechecking",
    prompt: `Detect the project type and generate a /fix command for linting and typechecking.

## Step 1: Detect Project Type

Check for config files:
- package.json -> JavaScript/TypeScript
- pyproject.toml or requirements.txt -> Python
- go.mod -> Go
- Cargo.toml -> Rust
- composer.json -> PHP

Read the relevant config file to understand the project structure.

## Step 2: Check Existing Tools

Based on the project type, check if linting/typechecking tools are already configured:

- **JS/TS**: eslint, prettier, typescript — check package.json scripts and config files
- **Python**: mypy, pylint, black, ruff — check dependencies and config files
- **Go**: go vet, gofmt, staticcheck
- **Rust**: clippy, rustfmt

## Step 3: Install Missing Tools (if needed)

Only install what's missing. Use the detected package manager.

## Step 4: Generate /fix Command

Create the directory \`.gg/commands/\` if it doesn't exist, then write \`.gg/commands/fix.md\`:

\`\`\`markdown
---
name: fix
description: Run typechecking and linting, then spawn parallel agents to fix all issues
---

Run all linting and typechecking tools, collect errors, group them by domain, and use the subagent tool to spawn parallel sub-agents to fix them.

## Step 1: Run Checks

[INSERT PROJECT-SPECIFIC COMMANDS — e.g. npm run lint, npm run typecheck, etc.]

## Step 2: Collect and Group Errors

Parse the output. Group errors by domain:
- **Type errors**: Issues from TypeScript, mypy, etc.
- **Lint errors**: Issues from eslint, pylint, ruff, clippy, etc.
- **Format errors**: Issues from prettier, black, rustfmt, gofmt

## Step 3: Spawn Parallel Agents

For each domain with issues, use the subagent tool to spawn a sub-agent to fix all errors in that domain.

## Step 4: Verify

After all agents complete, re-run all checks to verify all issues are resolved.
\`\`\`

Replace [INSERT PROJECT-SPECIFIC COMMANDS] with the actual commands for the detected project.

## Step 5: Confirm

Report what was detected, what was installed, and that /fix is now available.`,
  },
  {
    name: "setup-commit",
    aliases: [],
    description: "Generate a /commit command with quality checks",
    prompt: `Detect the project type and generate a /commit command that enforces quality checks before committing.

## Step 1: Detect Project and Extract Commands

Check for config files and extract the lint/typecheck commands:
- package.json -> Extract lint, typecheck scripts
- pyproject.toml -> Use mypy, pylint/ruff
- go.mod -> Use go vet, gofmt
- Cargo.toml -> Use cargo clippy, cargo fmt --check

## Step 2: Generate /commit Command

Create the directory \`.gg/commands/\` if it doesn't exist, then write \`.gg/commands/commit.md\`:

\`\`\`markdown
---
name: commit
description: Run checks, commit with AI message, and push
---

1. Run quality checks:
   [PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS]
   Fix ALL errors before continuing. Use auto-fix commands where available.

2. Review changes: run git status and git diff --staged and git diff

3. Stage relevant files with git add (specific files, not -A)

4. Generate a commit message:
   - Start with verb (Add/Update/Fix/Remove/Refactor)
   - Be specific and concise, one line preferred

5. Commit and push:
   git commit -m "your generated message"
   git push
\`\`\`

Replace [PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS] with the actual commands.

Keep the command file under 20 lines.

## Step 3: Confirm

Report that /commit is now available with quality checks and AI-generated commit messages.`,
  },
  {
    name: "setup-tests",
    aliases: [],
    description: "Set up testing and generate a /test command",
    prompt: `Set up comprehensive testing for this project and generate a /test command.

## Step 1: Analyze Project

Detect the project type, framework, and architecture. Identify all critical business logic that needs testing.

## Step 2: Determine Testing Strategy

Use these tools based on project type (2025-2026 best practices):

| Language | Unit/Integration | E2E | Notes |
|----------|------------------|-----|-------|
| JS/TS | Vitest (not Jest) | Playwright | Vitest is faster, native ESM/TS. Use Testing Library for components. |
| Python | pytest | Playwright | pytest-django for Django, httpx+pytest-asyncio for FastAPI. |
| Go | testing + testify | httptest | testcontainers-go for integration. Table-driven tests. |
| Rust | #[test] + rstest | axum-test | assert_cmd for CLI, proptest for property-based. |
| PHP | Pest 4 (Laravel) / PHPUnit 12 | Laravel Dusk | Pest preferred for Laravel. |

## Step 3: Set Up Testing Infrastructure

Spawn 4 sub-agents in parallel using the subagent tool (call the subagent tool 4 times in a single response):

**Agent 1 - Dependencies & Config**: Install test frameworks and create config files
**Agent 2 - Unit Tests**: Create comprehensive unit tests for all business logic, utilities, and core functions
**Agent 3 - Integration Tests**: Create integration tests for APIs, database operations, and service interactions
**Agent 4 - E2E Tests** (if applicable): Create end-to-end tests for critical user flows

Each agent should create COMPREHENSIVE tests covering all critical code paths - not just samples.

## Step 4: Verify and Generate /test Command

Run the tests to verify everything works. Fix any issues.

Then create the directory \`.gg/commands/\` if it doesn't exist and write \`.gg/commands/test.md\` with:

\`\`\`markdown
---
name: test
description: Run tests, then spawn parallel agents to fix failures
---

Run all tests for this project, collect failures, and use the subagent tool to spawn parallel sub-agents to fix them.

## Step 1: Run Tests

[PROJECT-SPECIFIC TEST COMMANDS with options for watch mode, coverage, filtering]

## Step 2: If Failures

For each failing test, use the subagent tool to spawn a sub-agent to fix the underlying issue (not the test).

## Step 3: Re-run

Re-run tests to verify all fixes.
\`\`\`

Replace placeholders with the actual test commands for this project.

## Step 5: Report

Summarize what was set up, how many tests were created, and that /test is now available.`,
  },
  {
    name: "setup-update",
    aliases: [],
    description: "Generate an /update command for dependency updates",
    prompt: `Detect the project type and generate an /update command for dependency updates and deprecation fixes.

## Step 1: Detect Project Type & Package Manager

Check for config files and lock files:
- package.json + package-lock.json -> npm
- package.json + yarn.lock -> yarn
- package.json + pnpm-lock.yaml -> pnpm
- pyproject.toml + poetry.lock -> poetry
- requirements.txt -> pip
- go.mod -> Go
- Cargo.toml -> Rust

## Step 2: Generate /update Command

Create the directory \`.gg/commands/\` if it doesn't exist, then write \`.gg/commands/update.md\`:

\`\`\`markdown
---
name: update
description: Update dependencies, fix deprecations and warnings
---

## Step 1: Check for Updates

[OUTDATED CHECK COMMAND for detected package manager]

## Step 2: Update Dependencies

[UPDATE COMMAND + SECURITY AUDIT]

## Step 3: Check for Deprecations & Warnings

Run a clean install and read ALL output carefully. Look for:
- Deprecation warnings
- Security vulnerabilities
- Peer dependency warnings
- Breaking changes

## Step 4: Fix Issues

For each warning/deprecation:
1. Research the recommended replacement or fix
2. Update code/dependencies accordingly
3. Re-run installation
4. Verify no warnings remain

## Step 5: Run Quality Checks

[PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS]

Fix all errors before completing.

## Step 6: Verify Clean Install

Delete dependency folders/caches, run a fresh install, verify ZERO warnings/errors.
\`\`\`

Replace all placeholders with the actual commands for the detected project type and package manager.

## Step 3: Confirm

Report that /update is now available with dependency updates, security audits, and deprecation fixes.`,
  },
  {
    name: "eyes",
    aliases: [],
    description:
      "Build project-specific perception probes (screenshots, logs, APIs, etc.) and document them in CLAUDE.md",
    prompt: `# Eyes: Give the Agent Project-Specific Perception

Build the set of "eyes" this project needs — scripts the agent can run to observe UI, logs, APIs, processes, state, builds, etc. — then document them in CLAUDE.md so any future agent (even with no context) can use them. Re-run this command later to add missing eyes or update existing ones.

## Execution Discipline (read before starting)

This command is long because it has to cover any project type. To stay reliable, obey these rules:

1. **Minimum viable set.** Build the SMALLEST useful subset of probes first — typically 3–8, never more than 10 in a single run. Mark the rest as \`deferred\` in the manifest. The user re-runs \`/eyes\` to expand coverage. Prefer 4 probes that all pass Phase 4 over 15 probes half-built.
2. **Budget.** 3–8 probes per run is the target. If the mapper picks more, trim to the highest-value ones for THIS project and defer the rest. Capabilities marked "opt-in" (\`load\`, \`chaos\`, \`remote\`, \`apm\`) are deferred unless the user already configured them or explicitly asks.
3. **Checkpoint after every phase.** At the end of each phase, write progress into \`.gg/eyes/manifest.json\` (add a \`phase_completed\` field: \`"research" | "design" | "build" | "verify" | "document"\`). On re-run, read this and resume from the next phase. Never redo completed phases unless the user passes \`refresh\` or the project materially changed.
4. **Phase gates.** Do not start Phase N+1 until Phase N is complete AND its checkpoint is written. Do not announce completion until Phase 5 is written AND Phase 4 Pass B has succeeded.
5. **Phase 4 Pass B is non-negotiable.** If probes build but the contextless-agent verification is skipped, the command has FAILED — regardless of how many probes work. Report failure and stop; do not paper over it.
6. **Fail loud, recover small.** If a probe fails to build after one retry, mark it \`failed\` in the manifest with the error, continue with the rest, and report failures at the end. Do not silently drop probes. Do not let one failure abort the whole run.
7. **Defer, don't fake.** If a capability requires scaffolding that's too invasive (e.g. adding a debug endpoint inside a game engine) and the user hasn't opted in, mark it deferred with a one-line note. Never stub a probe that doesn't actually work.

## Hard Rules (Headless Contract)

These are non-negotiable. The user must never see pop-ups, browser windows, or images opened on their screen. Everything happens in the background.

- **Never** call \`open\`, \`xdg-open\`, \`start\`, \`code\`, Finder/Explorer reveals, or any command that launches a GUI window.
- **Never** pass \`--headed\`, \`--no-headless\`, \`--gui\`, or equivalent flags. Browsers, emulators, simulators, and engine editors must run headless / in batch mode.
- All artifacts (screenshots, recordings, DB dumps, log snapshots, HAR files, traces) go to \`.gg/eyes/out/\` which MUST be gitignored.
- Every probe script must have a timeout and exit non-zero on failure with a clear stderr message.
- Long-running processes (dev servers, tailers, capture sinks) are started in the background; their PIDs/ports go in \`.gg/eyes/state.json\`; they are stopped via \`.gg/eyes/down.sh\`.
- Never prompt the user. If a dep is missing, install it silently. If the dev server isn't up, start it.
- **Redaction**: before writing any artifact that may contain secrets (logs, HAR files, env dumps, screenshots of auth'd UIs), run it through a redaction pass (\`.gg/eyes/redact.sh\`) that strips JWTs, API keys, bearer tokens, and values of env vars matching \`*_KEY|*_SECRET|*_TOKEN|*_PASSWORD\`.
- **Remote / production eyes**: OFF by default. Only enabled if the user explicitly opts in via \`.gg/eyes/remote.json\` (gitignored). Remote probes must be read-only and refuse to run destructive operations.

## Capability Vocabulary

Think in capabilities, not project types. Map the project to the subset it actually needs. Not every capability applies to every project — pick the relevant ones. Capabilities split into three tiers:

### Core (observe)

- \`visual\` — screenshot a UI (web page, mobile screen, desktop window, game frame)
- \`runtime_logs\` — read recent stdout/stderr or log files from the running app
- \`http\` — hit HTTP endpoints and read responses (REST, GraphQL, health checks)
- \`state\` — inspect persistent state (DB rows, KV stores, files written by the app)
- \`process\` — check what's running, on what port, PID, uptime
- \`build\` — compile/typecheck and surface errors
- \`test\` — run a single test or subset and read output
- \`cli_io\` — invoke the CLI being built with args and capture stdout/stderr/exit
- \`native_ui\` — capture mobile/desktop native windows (simulator screencap, window capture)
- \`dom\` — DOM / accessibility tree snapshot of a headless browser page (often more useful than a screenshot for assertions)
- \`browser_console\` — browser-side console logs and uncaught errors via CDP
- \`network\` — network traffic (HAR export via CDP, or mitmproxy for non-browser traffic)
- \`storage\` — cookies, localStorage, sessionStorage, IndexedDB dumps
- \`sockets\` — open ports / listening sockets (\`lsof -i\`, \`ss\`)
- \`fs_watch\` — filesystem changes during a probe run (fswatch / inotify)
- \`env\` — env var diff, runtime versions, doctor report
- \`perf\` — performance metrics (Lighthouse for web, xctrace / simpleperf for mobile, FPS / frame-time for games, process sampling for servers, bundle size for frontends)
- \`metrics\` — scrape a metrics endpoint (Prometheus, /metrics)
- \`trace\` — pull a distributed trace by ID (OTEL collector)
- \`responsive\` — capture a viewport matrix (mobile / tablet / desktop) in one call
- \`a11y\` — accessibility audit (axe-core on a page, or platform a11y tree)
- \`headers\` — HTTP security-header audit (CSP, HSTS, X-Frame-Options, etc.)

### Act (drive to a state)

These convert the agent from a passive camera into an actor. Without them, ~60% of real debugging still needs the user.

- \`act_web\` — drive a web UI: click, type, scroll, wait, nav. Playwright script accepts a sequence and returns post-state (screenshot + DOM).
- \`act_mobile\` — drive a mobile app via Appium / XCUITest / UIAutomator: tap, swipe, input.
- \`act_desktop\` — drive a desktop window via nut-js / AXUIElement / UIAutomation / AT-SPI.
- \`act_cli\` — pty-based expect scripts for interactive CLIs (prompts, TUIs). Also captures ANSI frames so Ink/bubbletea/textual output can be snapshotted.
- \`act_game\` — input simulation (keyboard / gamepad) into a running game, optionally recording + replaying deterministic seeds.
- \`auth\` — establish and reuse a logged-in session (Playwright \`storageState.json\`, API token capture) so protected flows are reachable without re-logging in.
- \`deeplink\` — jump directly to a screen by URL / URI scheme (mobile and web).

### Capture (external side-effects)

Local sinks that intercept what the app sends outward, so the agent can verify side-effects without real external services.

- \`capture_email\` — local SMTP sink (Mailpit / MailHog) + \`.gg/eyes/mail.sh\` to list/read captured messages.
- \`capture_webhook\` — local webhook receiver that logs incoming POSTs + a probe to list them.
- \`capture_push\` — local push-notification sink (ntfy or APNS/FCM mock) + reader.
- \`capture_sms\` — SMS mock / sink if the project sends SMS.
- \`capture_stripe\` — \`stripe listen\` in the background capturing webhook events + reader.
- \`capture_events\` — analytics / tracking event sink (intercepts calls to Segment, PostHog, GA, etc.).
- \`capture_queue\` — peek messages in a queue without consuming (Kafka / Redis / RabbitMQ / SQS / BullMQ / Sidekiq / Celery).
- \`capture_ws\` — open a WebSocket / SSE, record frames, send test messages.
- \`capture_grpc\` — \`grpcurl\` with reflection, record responses.
- \`capture_errors\` — local Sentry-compatible error sink.
- \`capture_audio\` — record audio produced by the app via a virtual sink (ffmpeg + pulseaudio / BlackHole on macOS / WASAPI loopback on Windows). Saves \`.wav\` for playback-by-tooling or waveform inspection.
- \`capture_video\` — record a window or headless-browser video stream via ffmpeg (\`x11grab\` / \`avfoundation\` / \`gdigrab\`) or Playwright's built-in video recording. Saves \`.mp4\`.

### Diff & Time (compare, replay)

- \`diff_visual\` — screenshot vs baseline under \`.gg/eyes/baselines/\` using pixelmatch / odiff; returns similarity score + diff PNG.
- \`diff_api\` — API response vs recorded baseline (golden files).
- \`diff_branch\` — visual diff between two git refs (checkout A, screenshot; checkout B, screenshot; diff). Use a git worktree so the working tree is undisturbed.
- \`record\` — rolling background recorder: tails logs + periodic screenshots + network events to a ring buffer under \`.gg/eyes/recordings/\`. \`replay.sh <timestamp>\` scrubs back.
- \`introspect\` — language-runtime / engine hooks: Node inspector, Python REPL eval, Jupyter \`nbconvert --execute\`, DataFrame head/describe, matplotlib intercept, game-engine RCON-style debug endpoint for entity/state queries.
- \`remote\` — opt-in prod/staging read-only eyes (k8s / fly / vercel / cloudflare / railway log + exec). Must refuse destructive ops. Gated behind \`.gg/eyes/remote.json\`.
- \`security\` — runtime secret-leak scan of artifacts, dependency audit, HTTP header audit.
- \`container\` — \`docker ps\` / \`docker logs\` / \`docker exec\` / \`compose\` wrappers for dockerized stacks.
- \`concurrency\` — multi-session harness: parallel isolated contexts (Playwright contexts, multiple CLI processes) with an action coordinator, for "user A acts, user B observes" tests.

### Stress & Environment

- \`load\` — load / stress testing via k6 / vegeta / wrk / hey. Produces latency percentiles + throughput report. Opt-in (destructive against the target) — off unless the project has a clear perf target or the user enables it.
- \`chaos\` — failure injection: Toxiproxy for network fault (latency, drops, bandwidth), chaos-mesh for k8s, process kill / pause helpers for local procs. Opt-in and scoped (never touches remote unless remote profile explicitly allows).
- \`browser_matrix\` — extension of \`visual\` / \`act_web\`: run the same script across Chromium + Firefox + WebKit and return per-browser results. Use Playwright's multi-browser support; enable only if cross-browser matters for this project.
- \`devices\` — auto-detect physically connected real devices (\`adb devices\`, \`xcrun devicectl list devices\`, \`ideviceinfo\`, USB-serial via \`system_profiler\` / \`lsusb\`). Wires \`native_ui\` / \`act_mobile\` / \`runtime_logs\` to target the physical device when present, falls back to simulator otherwise.
- \`apm\` — read-only pulls from APM providers (Datadog, New Relic, Honeycomb, Grafana Cloud, Sentry) when creds are configured in \`.gg/eyes/remote.json\`. Only under \`remote\`.

## Project-Type Recipes (reference, not exhaustive)

Use this as a starting point in the Capability Mapper. Add or drop based on what the project actually has.

- **Web app (Next.js / Vite / SvelteKit / Remix / Astro)**: visual, dom, browser_console, network, storage, auth, responsive, a11y, http, runtime_logs, build, test, act_web, diff_visual, capture_email, capture_webhook, perf (Lighthouse). Add \`browser_matrix\` if cross-browser matters; add \`capture_video\` for flow recordings.
- **Backend service / API**: http, runtime_logs, state (DB), process, sockets, build, test, metrics, trace, capture_ws, capture_grpc, capture_queue, capture_email, capture_webhook, capture_stripe, container. Add \`load\` if there's a perf target; \`chaos\` for resilience work.
- **CLI tool**: cli_io, act_cli (pty + ANSI snapshot), runtime_logs, build, test, fs_watch, env.
- **Mobile app (iOS)**: native_ui (\`xcrun simctl io booted screenshot\`), runtime_logs (\`xcrun simctl spawn booted log stream\`), act_mobile (XCUITest / Appium), build (xcodebuild), test, deeplink, perf (xctrace), devices (auto-target physical iPhone if connected).
- **Mobile app (Android)**: native_ui (\`adb shell screencap\`), runtime_logs (\`adb logcat\`), act_mobile (UIAutomator / Appium), build (gradle), test, deeplink, perf (simpleperf), devices.
- **Media app (audio / video / streaming)**: capture_audio, capture_video, perf, runtime_logs — plus whatever platform recipe applies (web / mobile / desktop).
- **Desktop app (Electron / Tauri)**: visual (headless window capture or WebDriver), runtime_logs, build, test, act_desktop, introspect (devtools / Tauri IPC), fs_watch.
- **Game (Unity / Unreal / Godot / custom engine)**: visual (engine batch-mode screenshot or off-screen render), runtime_logs, build (batch-mode build), introspect (REQUIRES a small in-engine debug endpoint the agent can query for entity state — scaffold it if missing), act_game (input injection + deterministic seeding + input recording/replay), perf (FPS / frame-time).
- **Browser extension**: visual + dom + browser_console via Playwright persistent context with \`--load-extension\`; act_web to drive target sites; introspect for background/service-worker state.
- **Python / data / ML**: introspect (nb-run, df-head, plot-capture intercepting \`plt.show\`), http (if FastAPI / Flask), state, build (typecheck via mypy), test, env (gpu status, python/cuda versions), perf.
- **Chrome/Firefox extension**: like web app + extension-specific loading.
- **Library / SDK**: build, test, cli_io (if it has a CLI demo), introspect (REPL eval).

Also consider adding across ANY project type when warranted: \`load\` (if perf-critical), \`chaos\` (if resilience-critical), \`capture_audio\` / \`capture_video\` (if the app produces media), \`devices\` (if real hardware matters), \`apm\` (if prod observability is configured).

## Probe Naming Convention

Probe IDs use \`<verb>\` or \`<verb>-<object>\` lowercase-kebab: \`screenshot\`, \`logs\`, \`api\`, \`dom\`, \`act-web\`, \`diff-visual\`, \`capture-email\`, \`record\`. Scripts are \`.gg/eyes/<id>.sh\`. Self-tests are \`.gg/eyes/<id>.test.sh\`.

## Phase 1: Research (Parallel Sub-Agents)

Use the subagent tool to spawn these agents IN PARALLEL (multiple calls in a single response). Each must return structured findings.

**Agent 1 — Project Classifier**: Read manifests (package.json, Cargo.toml, go.mod, pyproject.toml, Podfile, Info.plist, tauri.conf.json, docker-compose.yml, Makefile, etc.). Return: project kind(s) (web app / CLI / mobile / desktop / backend service / library / game / extension), languages, frameworks, runtimes.

**Agent 2 — Runtime Surveyor**: Find existing dev scripts, ports, log paths, DB locations, test runners, build outputs, env files. Report exact commands already defined.

**Agent 3 — Existing-Eyes Auditor**: Read current \`.gg/eyes/\` (if any), \`.gg/eyes/manifest.json\`, existing \`CLAUDE.md\`, and \`.gitignore\`. Report what's already installed so this run is a diff, not a rewrite. Never overwrite user-modified probe scripts without good reason.

**Agent 4 — Capability Mapper**: Given the above, pick the 3–8 HIGHEST-VALUE probes to build NOW, and list everything else as deferred. The minimum viable set should unlock the most common perception tasks for this project type (for a web app that's usually \`visual\` + \`dom\` + \`runtime_logs\` + \`http\` + \`act_web\`; for a backend: \`http\` + \`runtime_logs\` + \`state\` + \`capture_email\` or \`capture_webhook\`; for a CLI: \`cli_io\` + \`act_cli\` + \`runtime_logs\`). Opt-in capabilities (\`load\`, \`chaos\`, \`remote\`, \`apm\`) are ALWAYS deferred unless explicitly requested. For each chosen capability, pick the best concrete implementation for this stack (e.g. \`visual\` web → Playwright headless; \`visual\` Tauri → WebDriver or tauri-driver; \`visual\` iOS → \`xcrun simctl io booted screenshot\`; \`native_ui\` Android → \`adb shell screencap\`; \`capture_email\` → Mailpit on a free port; \`act_web\` → Playwright with reusable \`storageState.json\`; \`introspect\` game → defer unless the engine already exposes a debug endpoint).

Wait for all agents. Synthesize into a single plan listing \`build_now\` (3–8 probes) and \`deferred\` (everything else with a one-line reason).

**Checkpoint: write \`phase_completed: "research"\` to \`.gg/eyes/manifest.json\` before proceeding.**

## Phase 2: Design

Write \`.gg/eyes/manifest.json\` with the probe list. Schema:

\`\`\`json
{
  "version": 1,
  "phase_completed": "design",
  "project": { "kind": "...", "stack": "..." },
  "probes": [
    {
      "id": "screenshot",
      "capability": "visual",
      "status": "pending",
      "script": ".gg/eyes/screenshot.sh",
      "impl": "playwright-headless",
      "deps": ["playwright"],
      "timeout_ms": 15000,
      "usage": "<url-or-path> [viewport]",
      "output": ".gg/eyes/out/screenshot-<timestamp>.png"
    }
  ],
  "deferred": [
    { "capability": "load", "reason": "opt-in; no perf target set" },
    { "capability": "capture_audio", "reason": "project does not produce audio" }
  ],
  "lifecycle": { "up": ".gg/eyes/up.sh", "down": ".gg/eyes/down.sh" }
}
\`\`\`

Probe \`status\` transitions: \`pending\` → \`built\` (after Phase 3) → \`verified\` (after Phase 4 Pass A) → \`failed\` with an \`error\` field if anything goes wrong at any point. Update the manifest after each probe changes state.

If a manifest already exists, diff against it: keep \`verified\` probes as-is, rebuild \`failed\` ones, add missing ones, remove probes whose capability no longer applies (but never delete a user-edited script without asking). If \`phase_completed\` already indicates a later phase, resume from the next phase rather than restarting.

Also ensure \`.gitignore\` contains: \`.gg/eyes/out/\`, \`.gg/eyes/state.json\`, \`.gg/eyes/recordings/\`, \`.gg/eyes/remote.json\`, \`.gg/eyes/auth/\`.

**Checkpoint: manifest is now written with \`phase_completed: "design"\`. Proceed to Phase 3.**

## Phase 3: Build (Parallel Sub-Agents)

For each probe that is new or changed, spawn a sub-agent via the subagent tool. Launch them IN PARALLEL (all in one response). Each sub-agent's task:

1. Create \`.gg/eyes/<id>.sh\` (or \`.mjs\`/\`.py\` only if shell is unreasonable). Make it executable. It must:
   - Be fully headless (re-read the Hard Rules above)
   - Have a timeout
   - Exit non-zero with a clear stderr message on failure
   - Write artifacts only under \`.gg/eyes/out/\`
   - Print the artifact path (or result) to stdout so the agent can consume it
   - Self-recover where possible (start dev server if down, install missing dep, pick a free port)
2. Install any required dependencies silently (locally to the project where possible; \`npx --yes\`, \`pnpm add -D --silent\`, \`pip install --quiet --user\`, etc.). For Playwright: also run the headless browser install (\`npx --yes playwright install chromium\`).
3. Write \`.gg/eyes/<id>.test.sh\` — a self-test that proves the probe works end-to-end headlessly. It must produce a real artifact or real output, not a mock.
4. Append a short usage block to \`.gg/eyes/README.md\`.
5. Report success or failure back. On success, main agent updates that probe's \`status\` to \`built\`. On failure, main agent retries ONCE; if it still fails, sets \`status: "failed"\` with a one-line \`error\` and moves on — does NOT abort the whole run.

Also create (once, shared):
- \`.gg/eyes/up.sh\` — start the dev stack + any required capture sinks (Mailpit, webhook receiver, stripe listen) in the background, record PIDs/ports to \`.gg/eyes/state.json\`, idempotent.
- \`.gg/eyes/down.sh\` — stop everything started by \`up.sh\`.
- \`.gg/eyes/redact.sh\` — stdin-in / stdout-out redactor that strips tokens, API keys, bearer headers, and values of \`*_KEY|*_SECRET|*_TOKEN|*_PASSWORD\` env vars. All probes that produce text artifacts pipe through this before writing.
- \`.gg/eyes/doctor.sh\` — prints OS/arch, runtime versions, installed probe deps, port availability, sink status. One blob for troubleshooting.
- \`.gg/eyes/out/\`, \`.gg/eyes/baselines/\`, \`.gg/eyes/recordings/\`, \`.gg/eyes/auth/\` directories (create as needed).

**Checkpoint: after all parallel sub-agents report, update \`phase_completed: "build"\` in the manifest with each probe's final status. Proceed to Phase 4.**

## Phase 4: Verify

Two verification passes. Both must pass before Phase 5.

**Pass A — Self-tests**: Run every \`.gg/eyes/<id>.test.sh\` for probes with \`status: "built"\`. On pass, set \`status: "verified"\`. On failure, retry ONCE; if it still fails, set \`status: "failed"\` with the error, and continue with remaining probes. It is fine to finish Phase 4 with some probes failed — they are recorded and the user can re-run \`/eyes\` to retry them. It is NOT fine to skip Pass B.

**Pass B — Contextless agent test**: Spawn ONE sub-agent via the subagent tool whose entire context is the updated CLAUDE.md \`## Eyes\` section only (paste it into the task). Give it a concrete task that exercises at least one *act* or *capture* probe if those were built, not just pure observation. Examples:
- web app: "Log in as the test user, navigate to Settings, capture the page, and report the value in the Email field."
- backend: "Trigger the password-reset endpoint for test@example.com, then read the captured email and report the reset link."
- CLI (interactive): "Run the init command, answer the prompts with defaults, and report the final confirmation line."
- mobile: "Deep-link to the profile screen and report the displayed username."
- game: "Spawn the player at (0,0), step forward three frames, and report the player's position."
- library / pure observation: fall back to a simple probe ("capture the home page and report the primary heading").

If the sub-agent can complete the task without asking clarifying questions, the docs work. If it gets stuck or guesses, fix the \`## Eyes\` section in CLAUDE.md and retry (up to 2 retries). This is the real test — not "does the script run" but "can a contextless agent use it from the docs alone."

**Pass B is MANDATORY.** If you skip it, this command has failed. Do not claim completion without it. If Pass B cannot be run (e.g. no verified probes at all), report that the command failed and stop.

**Pass C — Autonomy test (MANDATORY when triggers were written)**: Spawn a second contextless sub-agent with only the \`## Eyes\` section. Give it a task that IMPLIES perception but does NOT demand it — a task that looks like normal coding work. Examples:
- web app: "Add a disabled state to the login button when the form is invalid." (Should trigger the visual probe per the "after editing UI components" rule without being asked.)
- backend: "Add a new field \`phone\` to the user registration endpoint." (Should trigger the http/api probe per the "after adding/modifying a route" rule.)
- CLI: "Add a \`--verbose\` flag to the main command." (Should trigger the cli probe per the "after changing CLI args" rule.)
- mobile: "Change the profile screen header color to blue." (Should trigger a screenshot per the UI-edit rule.)

A pass means the sub-agent reached for the right probe on its own initiative, unprompted. A fail means it edited code and reported done without verifying, OR asked the user to verify. If Pass C fails, the "When to use" rules are too weak — rewrite them more actionably and retry (up to 2 retries). If the probe set is pure-observation (no UI/runtime changes apply) and no autonomy trigger makes sense, skip Pass C and note why.

**Checkpoint: update \`phase_completed: "verify"\` with Pass A, Pass B, and Pass C results. Proceed to Phase 5.**

## Phase 5: Document

Insert or update a single \`## Eyes\` section in the project's CLAUDE.md (create CLAUDE.md if it doesn't exist, but do not clobber other sections). Keep it terse — the scripts are self-documenting; CLAUDE.md is the index.

The section MUST include four subsections, in order: intro → probe table → **when to use automatically** → **when NOT to use** → lifecycle.

Template:

\`\`\`markdown
## Eyes

Perception probes live in \`.gg/eyes/\`. All headless. Artifacts go to \`.gg/eyes/out/\` (gitignored). Never open GUIs or prompt the user. Invoke probes yourself rather than asking the user — that's the whole point.

### Available probes

| Need | Run | Then |
|---|---|---|
| <one-line need> | \`.gg/eyes/<id>.sh <args>\` | <how to consume output> |
| ... | ... | ... |

### When to use these eyes (automatically, without being asked)

Reach for probes ON YOUR OWN INITIATIVE when any of these apply — do not ask the user to verify something you can verify yourself:

- <project-specific trigger 1: e.g. "After editing any file under \`src/ui/\` or \`src/components/\`, screenshot the affected page and visually verify the change landed.">
- <trigger 2: e.g. "After adding or modifying an HTTP route, hit it with \`.gg/eyes/api.sh\` and confirm the response shape.">
- <trigger 3: e.g. "After changing CLI argument parsing, run \`.gg/eyes/cli.sh --help\` and confirm the new flag appears.">
- <trigger 4: e.g. "Before claiming a UI bug is fixed, screenshot the before/after and diff.">
- <trigger 5: e.g. "After any change that touches email sending, trigger the flow and check \`.gg/eyes/mail.sh\` for the captured message.">
- If a probe fails or returns unexpected results, investigate the artifact/output directly before assuming the probe itself is broken.

### When NOT to use these eyes

Do not run probes for:

- Docs-only changes (README, markdown, comments).
- Config-only changes that don't affect runtime behavior.
- Refactors that preserve behavior and are already covered by tests.
- Style/formatting-only changes.
- When a probe was already run this turn on the same artifact — reuse the output, don't re-run.
- When the dev server / simulator / sink isn't up AND the task doesn't require runtime verification — don't spin up infra just to be thorough.

### Lifecycle

Start/stop dev stack + capture sinks: \`.gg/eyes/up.sh\` / \`.gg/eyes/down.sh\` (idempotent, background).
Refresh/expand this setup when the project changes: \`/eyes\`.
\`\`\`

For each probe: one row, one line need, exact invocation, one-line consumption hint (e.g. "read the printed PNG path", "parse JSON stdout", "grep stderr for ERROR"). Only include probes with \`status: "verified"\`. Do not document failed or deferred probes in the table — a short line below the lifecycle can list them if present ("Deferred: load, chaos. Failed: capture_audio (BlackHole not installed). Run \`/eyes\` again to retry.").

**The "when to use" and "when NOT to use" triggers are project-specific and mandatory.** Generate them based on the actual project layout and probes built. Rules of thumb:
- Tie triggers to file paths, file types, or task descriptions the future agent will recognize ("after editing \`src/routes/**\`…", "after modifying a \`.tsx\` component…", "before claiming an API change is done…").
- Every verified probe should have at least one trigger that names it, OR be explicitly listed in "When NOT to use" if it's expensive/opt-in (e.g. \`load\`, \`diff_branch\`).
- Match the trigger density to the project: a web app with many UI components warrants a strong visual trigger; a pure backend library does not.
- Triggers should be ACTIONABLE ("screenshot the page") not VAGUE ("verify UI looks right").

**Checkpoint: update \`phase_completed: "document"\`. Proceed to Phase 6.**

## Phase 6: Report

Summarize in the chat:
- Project kind detected
- Probes built and verified (list with ✓)
- Probes failed (list with one-line error) — user can re-run \`/eyes\` to retry
- Capabilities deferred (one-line reason each) — user can re-run \`/eyes\` to expand coverage
- Contextless-agent verification result (Pass B) — explicitly state whether it passed
- One-line example the user can try next (e.g. "Try: ask me to screenshot the home page.")

**IMPORTANT — if CLAUDE.md was created or modified**, end the report with a clear notice:

> ⚠️ CLAUDE.md was updated with the new \`## Eyes\` section. ggcoder loads CLAUDE.md at startup, so **exit and restart ggcoder** (\`/quit\` then run \`ggcoder\` again) before asking me to use these probes. Without a restart, I won't see the new instructions in my context.

Make this notice the last thing in the report so the user doesn't miss it.`,
  },
  {
    name: "simplify",
    aliases: [],
    description:
      "Review changed code for reuse, quality, and efficiency, then fix any issues found",
    prompt: `# Simplify: Code Review and Cleanup

Review all changed files for reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

Run \`git diff\` (or \`git diff HEAD\` if there are staged changes) to see what changed. If there are no git changes, review the most recently modified files that the user mentioned or that you edited earlier in this conversation.

## Phase 2: Launch Three Review Agents in Parallel

Use the subagent tool to launch all three agents concurrently in a single response (call the subagent tool 3 times in one message). Pass each agent the full diff so it has the complete context.

### Agent 1: Code Reuse Review

For each change:

1. **Search for existing utilities and helpers** that could replace newly written code. Look for similar patterns elsewhere in the codebase — common locations are utility directories, shared modules, and files adjacent to the changed ones.
2. **Flag any new function that duplicates existing functionality.** Suggest the existing function to use instead.
3. **Flag any inline logic that could use an existing utility** — hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, and similar patterns are common candidates.

### Agent 2: Code Quality Review

Review the same changes for hacky patterns:

1. **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones
3. **Copy-paste with slight variation**: near-duplicate code blocks that should be unified with a shared abstraction
4. **Leaky abstractions**: exposing internal details that should be encapsulated, or breaking existing abstraction boundaries
5. **Stringly-typed code**: using raw strings where constants, enums (string unions), or branded types already exist in the codebase
6. **Unnecessary JSX nesting**: wrapper Boxes/elements that add no layout value — check if inner component props (flexShrink, alignItems, etc.) already provide the needed behavior
7. **Unnecessary comments**: comments explaining WHAT the code does (well-named identifiers already do that), narrating the change, or referencing the task/caller — delete; keep only non-obvious WHY (hidden constraints, subtle invariants, workarounds)

### Agent 3: Efficiency Review

Review the same changes for efficiency:

1. **Unnecessary work**: redundant computations, repeated file reads, duplicate network/API calls, N+1 patterns
2. **Missed concurrency**: independent operations run sequentially when they could run in parallel
3. **Hot-path bloat**: new blocking work added to startup or per-request/per-render hot paths
4. **Recurring no-op updates**: state/store updates inside polling loops, intervals, or event handlers that fire unconditionally — add a change-detection guard so downstream consumers aren't notified when nothing changed. Also: if a wrapper function takes an updater/reducer callback, verify it honors same-reference returns (or whatever the "no change" signal is) — otherwise callers' early-return no-ops are silently defeated
5. **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern) — operate directly and handle the error
6. **Memory**: unbounded data structures, missing cleanup, event listener leaks
7. **Overly broad operations**: reading entire files when only a portion is needed, loading all items when filtering for one

## Phase 3: Fix Issues

Wait for all three agents to complete. Aggregate their findings and fix each issue directly. If a finding is a false positive or not worth addressing, note it and move on — do not argue with the finding, just skip it.

When done, briefly summarize what was fixed (or confirm the code was already clean).`,
  },
  {
    name: "batch",
    aliases: [],
    description:
      "Research and plan a large-scale change, then execute it in parallel across branch-isolated workers that each open a PR",
    prompt: `# Batch: Parallel Work Orchestration

You are orchestrating a large, parallelizable change across this codebase.

## Phase 1: Research

Launch one or more subagents using the subagent tool with \`agent: "researcher"\` to deeply research what this instruction touches. You need their results before proceeding, so wait for them to complete. Have them:

- Find ALL files, patterns, and call sites that need to change
- Understand existing conventions so the migration is consistent
- Quantify the surface area (how many files, how many call sites)
- Note any risks or complications

## Phase 2: Plan

After research completes, call the enter_plan tool to enter plan mode. Using the research findings:

1. **Decompose into independent units.** Break the work into 5–30 self-contained units. Each unit must:
   - Be independently implementable on its own git branch (no shared state with sibling units)
   - Be mergeable on its own without depending on another unit's PR landing first
   - Be roughly uniform in size (split large units, merge trivial ones)

   Scale the count to the actual work: few files → closer to 5; hundreds of files → closer to 30. Prefer per-directory or per-module slicing over arbitrary file lists.

2. **Determine the test recipe.** Figure out how a worker can verify its change actually works — not just that unit tests pass. Look for:
   - An existing e2e/integration test suite the worker can run
   - A dev-server + curl pattern (for API changes)
   - A CLI verification pattern (for CLI changes)

   If you cannot find a concrete verification path, ask the user how to verify. Offer 2–3 specific options based on what the researcher found. Do not skip this — the workers cannot ask the user themselves.

3. **Write the plan** to \`.gg/plans/batch.md\` with:
   - Summary of research findings
   - Numbered list of work units — each with: title, file list, one-line description
   - The test recipe (or "skip e2e because …")
   - Note that each worker will use the \`worker\` agent (branch-isolated)

4. Call exit_plan to present the plan for approval.

## Phase 3: Spawn Workers (After Plan Approval)

Record the current branch name first: \`git branch --show-current\`.

Spawn one subagent per work unit using the subagent tool with \`agent: "worker"\`. **Launch them all in a single message block so they run in parallel.**

For each worker, the task must be fully self-contained. Include:
- The overall goal (the user's instruction)
- The starting branch to branch from (the branch name you recorded above)
- This unit's specific task (title, file list, change description — copied verbatim from your plan)
- Any codebase conventions discovered during research
- The test recipe from your plan (or "skip e2e because …")
- These additional instructions, copied verbatim:

\`\`\`
After you finish implementing the change:
1. Self-review your diff for code reuse, quality, and efficiency. Search the codebase for existing utilities that could replace new code. Fix any issues found.
2. Run the project's test suite (check for package.json scripts, Makefile targets, or common commands like npm test, pnpm test, pytest, go test). If tests fail, fix them.
3. Follow the e2e test recipe above. If it says to skip e2e, skip it.
4. Commit all changes with a clear message, push the branch, and create a PR with gh pr create. Use a descriptive title.
5. Switch back to the original branch with git checkout -.
6. End with exactly: PR: <url> or PR: none — <reason>
\`\`\`

## Phase 4: Track Results

After launching all workers, render an initial status table:

| # | Unit | Status | PR |
|---|------|--------|----|
| 1 | <title> | running | — |
| 2 | <title> | running | — |

As workers complete, parse the \`PR: <url>\` line from each result and re-render the table with updated status (\`done\` / \`failed\`) and PR links. Keep a brief failure note for any worker that did not produce a PR.

When all workers have reported, render the final table and a one-line summary (e.g., "22/24 units landed as PRs").`,
  },
  {
    name: "compare",
    aliases: [],
    description: "Compare code against real-world implementations via Grep MCP",
    prompt: `Compare the code you just created or modified in this conversation against real-world implementations using the \`mcp__grep__searchGitHub\` tool.

You already know what you just built. For each file you created or modified, use \`mcp__grep__searchGitHub\` to search for how real projects implement the same patterns. Look at the specific APIs, hooks, functions, and architecture you used.

If you find something consistently done differently across real codebases, or something commonly included that you left out, report it:

\`\`\`
[MISSING/DIVERGENT/INCOMPLETE] file:line - What it is
Wrote: What was implemented
Real-world: What real projects do instead/additionally
Evidence: Grep MCP - pattern seen in X out of Y repos searched
\`\`\`

Style preferences and subjective improvements are not valid findings. Only report things backed by clear Grep MCP evidence across multiple repos.

If the code aligns well with real-world patterns, say so. That's a good outcome.`,
  },
];

/** Look up a prompt command by name or alias */
export function getPromptCommand(name: string): PromptCommand | undefined {
  return PROMPT_COMMANDS.find((cmd) => cmd.name === name || cmd.aliases.includes(name));
}
