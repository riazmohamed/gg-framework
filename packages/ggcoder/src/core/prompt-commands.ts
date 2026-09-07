/**
 * Prompt-template commands — slash commands that inject detailed prompts
 * into the agent loop. Each command maps to a full prompt the agent executes.
 */

import { isGgApp } from "./runtime-mode.js";

export interface PromptCommand {
  name: string;
  aliases: string[];
  description: string;
  prompt: string;
}

const IS_GG_APP = isGgApp();

// The context file is whichever name won CONTEXT_FILES priority for this repo
// (AGENTS.override.md > AGENTS.md > CLAUDE.md > …), so the notice stays
// filename-agnostic — /init picks the winner at run time.
const CLAUDE_MD_RESTART_NOTICE = IS_GG_APP
  ? '> ⚠️ The project context file was created/updated. GG App loads it fresh per session, so start a **New Session** (click "+ New") before continuing. Without a new session, I won\'t see the new context.'
  : "> ⚠️ The project context file was created/updated. ggcoder loads it at startup, so **exit and restart ggcoder** (`/quit` then run `ggcoder` again) before continuing. Without a restart, I won't see the new context.";

/**
 * Shared sub-agent fan-out phrasing. One home so the "call the tool N times
 * in a single response" wording can't drift between command prompts.
 */
const spawnParallel = (count: string | number): string =>
  `in parallel using the subagent tool (call the subagent tool ${count} times in a single response)`;

export const PROMPT_COMMANDS: PromptCommand[] = [
  {
    name: "expand",
    aliases: [],
    description: "Find exciting new features to add",
    prompt: `# Expand: Exciting Feature Discovery

Find the most exciting new features this project should add by comparing it to similar, adjacent, and best-in-class repositories/tools/products/services. This command is project-agnostic: infer what THIS project is before choosing comparisons. This command is report-first and feature-first — the only deliverable is a single ranked table of exciting, user-facing features. Do not edit, install, or implement anything until the user chooses an option at the end.

Focus on what users actually get excited about: the new, killer, user-facing capabilities that make a product stand out. Security audits, refactors, code-quality cleanups, tests, CI, and ops/DX hygiene are OUT OF SCOPE here — exclude them unless a specific item is itself an exciting user-facing feature.

## Phase 0: Profile this project first

Before external research, inspect the local project and write a private working profile:

- What the project does, who its users are, and how they use it.
- Core user-facing surfaces, workflows, commands/routes/screens, and the features that already exist.
- The feature categories most relevant to THIS project. Do not assume a stack or product type.

Use this profile to decide which features are relevant and genuinely missing. If the user passed arguments to /expand, treat them as a focus area and prioritize that lens while still validating relevance.

## Phase 1: Parallel feature research

Spawn exactly 5 sub-agents ${spawnParallel(5)}. Give each sub-agent the project profile and a different feature-hunting lens:

**Agent 1 - Direct competitor killer features**: The standout, most-loved user-facing features in the closest peer projects/tools/products that this project lacks.

**Agent 2 - Adjacent & emerging tools**: Exciting user-facing features from adjacent products that would translate well to this project.

**Agent 3 - User demand signals**: Highly requested or trending features — top-voted issues, roadmap items, community asks, reviews, discussions — that point at what users want next.

**Agent 4 - Platform & ecosystem trends**: New user-facing capabilities unlocked by recent framework/API/model/platform releases that this project has not adopted yet.

**Agent 5 - Differentiators & wow-factor**: Novel or innovative features that would make this project stand out, even if no single peer has shipped them yet.

Each sub-agent must:

1. Use current sources: prefer repos/releases/changelogs/docs/articles updated within the last 6 months. Drop old or stale sources unless they are canonical and still actively maintained.
2. Return only user-facing FEATURES that appear absent in this project — not refactors, hardening, tooling, tests, or internal cleanup.
3. Include source names/URLs, freshness date (commit/release/article/doc date), and the local search anchors they used or recommend to verify the feature is absent.
4. Rank its own candidates by how exciting and valuable they would be to users, and state why each is exciting.
5. Avoid generic wishlist items. Every feature must be grounded in an external comparison or a real user-demand signal and relevant to this project profile.

## Phase 2: Main-agent validation against this repo

For every candidate from the sub-agents, validate it yourself before reporting:

1. Confirm the external source is relevant to this project and fresh enough (normally within 6 months).
2. Search this repo with grep/find and language-aware anchors to confirm the feature is not already present under another name.
3. Check routes, CLI commands, UI surfaces, package exports, config, docs, and examples before calling a feature missing.
4. Use the \`steroids\` tool (\`search\`, then \`show\` to read the full file) when a code-level look clarifies how peers actually ship the feature. Use literal imports, functions, config keys, CLI flags, route names, or package names — not conceptual phrases.
5. Drop anything already present, irrelevant, too vague, too stale, or that is not a real user-facing feature.
6. Merge duplicates and keep only the most exciting 5–10 features.

## Final output

Output ONLY a single table, ranked most exciting (rank 1) to least exciting. No prose before or after the table except the options below. Include 5–10 rows. The table must have exactly 3 columns:

| Rank | Feature | Why it's exciting + evidence |
|---|---|---|
| 1 | concise feature name + what it does | why users would love it, which peers/tools have it, source + fresh date, and local proof it is missing |

Rules:

- 5–10 rows, ordered most exciting first (rank 1 = most exciting).
- Only user-facing features. No security, refactor, ops, tooling, or test rows.
- The table must have exactly 3 columns. Put source URL/date/evidence and local absence proof inside the cells, not extra columns.
- Keep each cell concise but specific enough to be actionable.
- If no exciting validated features are found, output one row saying no fresh validated features were found.

After the table, ask the user what to do with the \`ask_user\` tool: one \`choice\` question (\`id: "scope"\`, question "What should I do?") with these options, each carrying a one-line hint:

- Build all of these features in plan mode
- Build only the top priority ones in plan mode

Leave the free-text escape on so they can pick specific ranks or re-scope. The card is the ONLY ask: do not also list the options as text, and do not end with an asking line. Only if \`ask_user\` is unavailable, ask the same question in prose as a lettered list.

Do not start implementing until the user chooses.

If they choose all or the top ones, do not implement directly. First call the enter_plan tool, then research and design an implementation plan for the selected features (all of them, or the top 3 most exciting — ranks 1-3). The plan must cover, per feature: the user-facing behavior, the local files/anchors it touches, the implementation approach (compared against real-world examples via the steroids tool using literal code tokens), and how it will be verified. Write the plan to .gg/plans/<name>.md, then call exit_plan with the plan path so the user can review and approve it. Do not begin implementing until the user approves the plan.

If they answer with anything else, follow what they asked — specific features by rank, a refined or re-scoped list, or skipping — and do not implement anything until they say so.`,
  },
  {
    name: "init",
    aliases: [],
    description: "Generate or update CLAUDE.md for this project",
    prompt: `Generate or update the project context file with project-specific context only: what this project is, the non-obvious knowledge needed to change it safely, and the workflows that are unique to it.

This file is injected verbatim into the **cached prefix of every request in every future session**, alongside the system prompt. Every line costs tokens forever. A line that repeats something the agent already has is worse than absent: it dilutes the lines that matter. So the bar is not "is this true?" — it is **"would a competent agent get this wrong without being told?"**

## What is already in the agent's context — never restate any of it

Read this list once and apply it to every step below. These are already supplied by the system prompt, so writing them into the context file is pure duplication:

1. **Agent behavior** — Do NOT add generic agent behavior already covered by the system prompt: read before edit/write, re-read after formatters, ask before destructive actions, no fake verification, generic code-quality advice, how to use tools, or how to talk to the user.
2. **Language conventions** — a Language Style Packs section is auto-injected for every language detected in this repo. Do not duplicate language style packs, generic verification rules, or boilerplate quality gates such as "After editing ANY file" / "Code Quality — Zero Tolerance".
3. **Verify commands** — a Verification section is auto-generated from package scripts / manifests (lint, typecheck, format, test) with the correct runner already resolved from the lockfile. Only write a command down if it is NOT discoverable that way: an undocumented multi-step sequence, a required ordering, a non-obvious flag, or a command that lives outside the manifest. Never add guidance that requires running checks, builds, or the full quality suite after every edit or every file change, and never turn discovered commands into mandatory after-every-edit requirements unless local CI explicitly enforces that sequence.
4. **The file tree** — the agent can list and grep the repo in one call. Do NOT embed generated symbol maps, exhaustive file indexes, auto-generated directory listings, or large trees. Do not add symbol indexes or auto-generated project inventories; the context file must remain durable, agent-focused project context.

Include only project-specific overrides, stricter local requirements, or knowledge that cannot be derived by reading the code.

## Step 1: Pick the target filename

Context files are loaded **one per directory, first match wins**, in this priority order: \`AGENTS.override.md\` > \`AGENTS.md\` > \`CLAUDE.md\` > \`.cursorrules\` > \`CONVENTIONS.md\`.

List the repo root and write to **whichever of those already exists with the highest priority**. If the repo already has an \`AGENTS.md\`, update that file — creating a new CLAUDE.md next to it produces a file the agent will never load. If none exists, create \`CLAUDE.md\`. State which file you chose and why in one line.

## Step 2: Set up the regenerated block

\`/init\` is re-run over the project's lifetime, so the generated content must be **replaceable, not appendable** — otherwise each run grows the file forever.

All content you generate goes inside these exact fence markers:

\`\`\`
<!-- gg:init:start -->
…generated content…
<!-- gg:init:end -->
\`\`\`

- If the file exists and already has the fence: **replace everything between the markers wholesale**. Text outside the fence is user-owned — do not touch it, do not reformat it, do not move it.
- If the file exists without the fence: read it, decide which content is hand-written knowledge worth keeping, move that above the fence untouched, and put your generated content inside a new fence. Remove generic guidance that is already covered by the system prompt (see the list above) unless it is a deliberate project-specific override.
- If the file does not exist: create it with the fence.

## Step 3: Analyze the project (sub-agents in parallel)

Derive every fact from the actual project — source code, entry points, manifests, config, and history. Treat README, docs, and code comments as unverified hints that are frequently stale: never copy claims from them, and only state things you can confirm from the code and config themselves.

Spawn 3 sub-agents ${spawnParallel(3)}:

1. **Purpose & Shape Agent**: What does this project actually do, and what are its top-level parts? Read entry points, main modules, exported/public APIs, CLI commands, routes, and manifests. Return: a one-sentence purpose, and for each package/app/module a one-line statement of what it *owns*. Do not rely on the README's description. Do not return a directory listing.
2. **Gotchas & Invariants Agent**: Find the knowledge that is expensive to rediscover. Mine \`git log\` (especially revert/fix/hotfix commits), CI and release workflows, \`NOTE\`/\`HACK\`/\`IMPORTANT\`/\`WARNING\`/\`XXX\` comments, test names asserting surprising behavior, generated-file and build-order constraints, and any config with a non-default value. Return only: rules that are non-obvious from reading the code, ordering/sequencing constraints, things that silently break, and the *reason* each exists. Skip anything a careful reader would infer in 30 seconds.
3. **Workflow & Stack Agent**: How is this project run, built, released, and deployed, from authoritative sources only — package scripts, manifests, Makefiles, CI config, deploy config. Return the workflows and any command that is NOT a plain single manifest script (multi-step sequences, required order, env vars, non-obvious flags, commands living outside the manifest). Do not return commands the auto-generated Verification section already covers (see item 3 above). Do not invent commands from convention, and do not trust README/doc command snippets unless a script or manifest confirms they still exist.

Wait for all sub-agents to complete, then synthesize.

## Step 4: Write the generated block

Inside the fence, write only sections that add project-specific value. Prefer this order — drop any section that would be empty or obvious:

- Project name and one-sentence purpose
- Key packages/apps/modules and what each owns (one line each, no tree)
- Architecture or data-flow notes an agent could not infer quickly from the code
- **Gotchas / invariants** — the highest-value section. Each entry states the rule *and* why it exists.
- Project-specific commands and workflows that survived the Step 3 filter (required publish order, generated-file workflow, dev-server startup, deployment caveats, auth/secrets storage)

Avoid generic sections named "Code Quality", "Organization Rules", or "How to Work" unless every bullet is specific to this project.

## Step 5: Budget and verify

The combined budget for all project context files is 32KB, shared with any parent-directory context files. **Target 6KB or less for the generated block** — a tight 4KB file that gets read every time beats a 25KB file the agent skims.

After writing:

1. Run \`wc -c\` on the file and report the byte size. If the generated block exceeds ~6KB, cut the weakest sections (the ones closest to "derivable by reading the code") and rewrite.
2. Re-read the file and confirm every remaining line passes the bar: **project-specific, supported by a local file you actually read, and not already in the agent's context per the list above.**
3. Report in one line: which file, how many bytes, and how many lines you removed as redundant.

## Step 6: Restart Notice

End your reply with this exact notice so the user doesn't miss it:

${CLAUDE_MD_RESTART_NOTICE}`,
  },
  {
    name: "setup-commit",
    aliases: [],
    description: "Generate a /commit command",
    prompt: `Detect the project type and generate a /commit command that enforces quality checks and an agent code review before committing.

## Step 1: Detect Project and Extract Commands

Check for config files and extract the lint/typecheck commands:
- package.json -> Extract lint, typecheck scripts
- pyproject.toml -> Use configured mypy, pylint/ruff commands
- go.mod -> Use configured go vet/gofmt/staticcheck commands
- Cargo.toml -> Use configured cargo clippy/fmt commands

Prefer existing project scripts. If you must synthesize a command from tool conventions, verify the current CLI flags against official docs first.

## Step 2: Generate /commit Command

Create the directory \`.gg/commands/\` if it doesn't exist, then write \`.gg/commands/commit.md\`:

\`\`\`markdown
---
name: commit
description: Run checks, agent code review, commit with AI message, and push
---

1. Run quality checks:
   [PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS]
   Fix ALL errors before continuing. Use auto-fix commands where available.

2. Review changes: run git status and git diff --staged and git diff

3. Fast review gate: spawn ONE subagent with the full diff. Instructions: review ONLY
   the diff for real bugs, regressions, leftover debug code, and unintended changes.
   Score each issue 0-100 confidence (pre-existing issues and stylistic nitpicks = false
   positives, score low). Report ONLY issues with confidence >= 80, with file:line and a
   one-line fix. If none, reply "CLEAR". This is a last check, not a deep audit - be fast.

4. If CLEAR: proceed straight to step 5 and push WITHOUT asking the user anything.
   If issues >= 80 were reported: STOP, show the issues, and ask with the \`ask_user\`
   tool — one \`choice\` question (\`id: "land"\`, question "Want me to fix this first, or commit and push anyway?") with:
   - "Fix it first, then commit & push" (recommended, hint: keeps the branch green)
   - "Commit & push anyway" (hint: issue stays open in the log)
   The card is the ONLY ask: show the issues, then stop — do not restate the two options as text or end with an asking line. Only if \`ask_user\` is unavailable, ask the same two options in prose.
   On fix-first: fix, re-run step 1, then continue (no re-review). Otherwise continue as-is.

5. Stage relevant files with git add (specific files, not -A)

6. Generate a commit message:
   - Start with verb (Add/Update/Fix/Remove/Refactor)
   - Be specific and concise, one line preferred

7. Commit AND push in one go - never pause for confirmation here:
   git commit -m "your generated message"
   git push
\`\`\`

Replace [PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS] with the actual commands.

Keep the command file under 30 lines.

## Step 3: Confirm

Report that /commit is now available with quality checks, an agent code review gate, and AI-generated commit messages, and mention which local scripts/docs verified the commands.`,
  },
  {
    name: "setup-ci",
    aliases: [],
    description: "Set up or harden CI for any stack",
    prompt: `# /setup-ci — set up CI from scratch OR harden what exists, any stack

You configure CI for THIS project. Completely stack-agnostic: manifests on disk decide
everything — never assume a stack, never copy GitHub's starter workflows (they are stale
and unhardened: no permissions, no concurrency, no timeouts, naive matrices).

## Step 0: Preconditions

- Not a git repository? STOP: tell the user to initialize git first (GG App's Initialize
  Git button, or \`git init\` + a remote).
- Look at \`git remote\`. Not GitHub? Adapt: GitLab -> \`.gitlab-ci.yml\` equivalents of the
  same rules and skip the ruleset step. Other CI providers already configured -> leave
  them alone and say so.

## Step 1: Detect the stack (manifests only)

- \`package.json\` -> Node; the lockfile picks the package manager (pnpm-lock.yaml ->
  pnpm, yarn.lock -> yarn, package-lock.json -> npm, bun.lock/b -> bun).
- \`pyproject.toml\` / \`requirements.txt\` / \`uv.lock\` / \`poetry.lock\` -> Python.
- \`go.mod\` -> Go. \`Cargo.toml\` -> Rust. \`composer.json\` -> PHP. \`Gemfile\` -> Ruby.
- \`*.csproj\`/\`*.sln\` -> .NET. \`pubspec.yaml\` -> Flutter/Dart. \`mix.exs\` -> Elixir.
- \`Dockerfile\` and none of the above -> container build check.
- Nothing detected -> static site: generate CI only if a build/lint tool exists;
  otherwise say honestly that CI adds nothing and skip generation.

## Step 2: Pick the mode

- \`.github/workflows/\` empty (or no real CI) -> **Mode A: generate.**
- Workflows exist -> **Mode B: audit + harden** (still add missing extras below).

## Mode A — generate

Write \`.github/workflows/ci.yml\`. EVERY rule is required:

- \`on:\` push + pull_request targeting the default branch (detect it, don't assume main).
- \`permissions:\n  contents: read\` at workflow level (least privilege).
- ONE job on \`ubuntu-latest\` — never macOS (10x billing) or Windows (2x) unless the
  project has OS-specific native code.
- \`concurrency\` group \`\${{ github.workflow }}-\${{ github.head_ref || github.run_id }}\`
  with \`cancel-in-progress: true\`.
- \`timeout-minutes: 15\` on the job.
- Install + build + test using ONLY commands that exist in the project's
  manifest/scripts; no test command -> build only, and say so in the report.
- Stack setup actions (verify the CURRENT major version against official docs before
  writing): pnpm -> \`pnpm/action-setup\` + \`actions/setup-node\` with \`cache: pnpm\`;
  npm/yarn/bun -> \`actions/setup-node\`/\`actions/setup-bun\` with cache for the lockfile;
  Python -> \`astral-sh/setup-uv\` + \`uv sync\` (fall back to pip when there is no uv
  lockfile); Go -> \`actions/setup-go\` (cache on by default); Rust -> minimal stable
  toolchain + \`Swatinem/rust-cache\`; PHP / Ruby / .NET / Flutter -> the canonical setup
  action for that stack, verified the same way.
- \`paths-ignore\` for \`**/*.md\` and docs folders if the repo has them.
- No artifact uploads.

## Mode B — audit + harden existing workflows

For EVERY file in \`.github/workflows/\`, apply and report one line per change:

1. Add top-level \`permissions: contents: read\` if missing. A job that legitimately
   needs more keeps its own narrower block — note why, never widen globally.
2. Add \`concurrency\` + \`cancel-in-progress: true\` if missing — EXCEPT on
   publish/deploy/release workflows, where cancelling mid-publish is worse than waiting.
3. Add \`timeout-minutes\` if missing (15 for test jobs; more for release jobs).
4. macOS/Windows matrix legs: keep ONLY if the project genuinely tests OS-specific
   behavior (native modules, installers, cross-platform bugs). Otherwise collapse to
   \`ubuntu-latest\` and state the minutes saved (macOS bills 10x, Windows 2x).
5. Ensure the package manager's dependency cache is enabled.
6. Bump actions to the current major version (verify against official docs). Do not
   SHA-pin unless asked — Dependabot keeps majors fresh once added.
7. NEVER weaken a check to make it pass. If an existing workflow is already stricter
   than these rules (e.g. a release job needing \`contents: write\`), leave it and say so.

## Both modes — extras

- \`.github/dependabot.yml\` if missing: version updates for \`github-actions\` plus the
  ecosystem from Step 1 (npm, pip, cargo, go, ...), weekly cadence.
- Branch protection (GitHub repos only): if no ruleset protects the default branch, run
  \`gh api -X POST /repos/{owner}/{repo}/rulesets\` with \`enforcement: active\`,
  \`conditions.ref_name.include: ["~DEFAULT_BRANCH"]\`, and rules \`deletion\` +
  \`non_fast_forward\`. Do NOT require pull requests. On failure (no admin, or private
  repo on a free plan): one line, continue — not an error.
- \`AGENTS.md\` at the repo root if missing: build/test/lint commands for this stack,
  a pointer that CI lives in \`.github/workflows/\` and must stay green, and a rule to
  never commit with \`--no-verify\`. If \`CLAUDE.md\` exists, keep AGENTS.md short and
  point to it.

## Finish

- Do NOT commit anything — the user reviews the diff first. Point them at /commit.
- Report bottom line first: mode chosen + stack detected, files written/changed, what CI
  now runs, rough minutes impact, and anything skipped with the reason.`,
  },
  {
    name: "compare",
    aliases: [],
    description: "Compare real-world code",
    prompt: `Compare the code you just created or modified in this conversation against real-world implementations using the \`steroids\` tool (\`search\`, then \`show\` to read the full file).

You already know what you just built. For each file you created or modified, use \`steroids\` \`search\` to find how real projects implement the same patterns. Look at the specific APIs, hooks, functions, and architecture you used.

If you find something consistently done differently across real codebases, or something commonly included that you left out, report it:

\`\`\`
[MISSING/DIVERGENT/INCOMPLETE] file:line - What it is
Wrote: What was implemented
Real-world: What real projects do instead/additionally
Evidence: steroids — pattern seen in X of Y repos
\`\`\`

Style preferences and subjective improvements are not valid findings. Only report things backed by clear steroids evidence across multiple repos.

If the code aligns well with real-world patterns, say so. That's a good outcome.`,
  },
  {
    name: "steroids",
    aliases: [],
    description: "Index real repos like this project",
    prompt: `# Steroids: build a code corpus that matches THIS project

Goal: fill the local \`steroids\` corpus with real, current, well-maintained repos that do what this project does, in the same stack, so later work can read proven code instead of guessing.

If the \`steroids\` tool is not available, stop and tell the user to install Agent Steroids first (Home screen, Steroids button). Do not improvise with bash.

## Phase 0: Profile the project

Inspect the local project (manifests, top-level layout, README, main entry points) and write a short private profile:

- What it is and does, and who uses it.
- Primary language(s) and the frameworks/libraries that define it (not every dependency, the ones that shape the code).
- Its shape: CLI, web app, desktop app, API, library, game, firmware, pipeline, etc.
- The 3-5 hardest or most central technical topics (e.g. "Tauri sidecar lifecycle", "streaming LLM tool calls", "trigram search index").

If the user passed arguments to /steroids, treat them as the focus and let them override the profile.

## Phase 1: Discover candidates

Call \`steroids\` \`repos\` once so you know what is already indexed. Then run 3-6 \`steroids\` \`discover\` queries WITHOUT \`add\`, each targeting a different angle from the profile: the framework (\`topic:<framework> language:<lang>\`), the product category (peer projects), and the central technical topics. Queries are GitHub repo searches, so keep each one SHORT: one \`topic:\` plus \`language:\`, or 2-3 keywords. A sentence like "llm streaming tool calls sdk" returns nothing. \`limit\` 10-15 per query. Never pass \`add\`.

Merge the results, drop anything already indexed, and rank by fit with this project first, then stars and recent \`pushed_at\`. Keep at most 20.

## Phase 2: Present and ask

FIRST print ONE markdown table of the ranked candidates: rank, repo, stars, last push, and a one-line "why it fits" tied to the profile. The user decides from this table, so it is never optional and never summarised away. ONLY THEN ask with the \`ask_user\` tool: one \`choice\` question (\`id: "count"\`, question "How many of these should I index?") with these options, each with a one-line hint on disk/time cost:

- All of them
- Top 10
- Top 5
- None

Mark Top 10 as recommended. Leave the free-text escape on so they can name specific ranks. The card is the ONLY ask: do not also list the options as text, and do not end with an asking line. Only if \`ask_user\` is unavailable, ask the same question in prose as a lettered list.

Do not index anything until the user answers.

## Phase 3: Index

Tell the user indexing is starting and can take a few minutes (each repo is a full download). Then index exactly the chosen repos with \`steroids\` \`add\` (\`repos\` = owner/name list, \`tag\` = a short slug for this project, e.g. its directory name), 2-3 repos per call so progress is visible and a cancel loses little. Then confirm with \`steroids\` \`repos\` filtered by that tag and report what was added, what failed, and the new corpus size. Suggest one concrete \`steroids\` \`search\` the user could run next against the new repos.`,
  },
  {
    name: "setup-skills",
    aliases: [],
    description: "Recommend useful skills",
    prompt: `# Skills Audit: Find useful skills for this project

Analyze this project and recommend skills from the open ecosystem that would make **working on this project more efficient, easier, and safer**. That is the goal, full stop. Every recommendation must pass the test: does this skill save real time, lower real cognitive load, or prevent real mistakes for someone working on THIS project, repeatedly?

Ranked by real impact, not volume.

This project could be anything — a web app, a CLI, a mobile app, a game, firmware, a data pipeline, a library, a scientific tool. Do not assume a stack. Let the codebase tell you what it is, then decide what to look for.

## Phase 1: Understand what this project is

Read just enough to know what kind of project this is. Look at whichever signals actually apply:

- Build / manifest files: \`package.json\`, \`pyproject.toml\`, \`Cargo.toml\`, \`go.mod\`, \`pubspec.yaml\`, \`Podfile\`, Xcode project, Gradle build, \`*.csproj\`, \`CMakeLists.txt\`, Unity/Unreal project files, Makefile — whatever exists.
- Any README, CLAUDE.md, or AGENTS.md.
- Top-level directory layout and obvious entry points.
- Any CI config, lockfile, or config directory that hints at workflow.

**Do NOT read source code yet.** You need only a coarse answer to: what kind of project is this, what platform/stack/language, what stage (greenfield vs mature), and what does the surrounding workflow look like (build, test, release, distribute, deploy — whatever applies for THIS project type).

## Phase 2: Decide which domains to investigate

Based on Phase 1, pick 4–6 domain slices that represent the **recurring work someone actually does on this project** — not abstract "areas of the codebase," but the real activities that eat time, attention, or trust. Do not use a fixed template. The right domains for a Rust CLI are different from an iOS app, a Unity game, a Django backend, a Kubernetes operator, or an ML notebook.

Illustrative only (not prescriptive):

- Web app → shipping features, API changes, handling data safely, deploys
- Mobile app → building screens, store releases, platform quirks, crash & accessibility triage
- CLI tool → adding commands, packaging & distribution, user-facing UX, error handling
- Game → adding content, platform ports, perf passes, build pipeline
- Library → designing public APIs, cutting releases, downstream compatibility, docs/examples
- Data / ML → running experiments, pipeline orchestration, reproducibility, serving models
- Embedded → adding peripherals, size/memory passes, flashing, hardware bring-up

**Announce your chosen domains to the user in one line before spawning agents**, so they can see what you're looking at (e.g. \`Domains: adding content, platform ports, perf passes, build pipeline\`).

## Phase 3: Parallel sweep

Spawn one sub-agent per domain you chose, ${spawnParallel("N")} — one task per domain. Each explores its assigned domain and returns skill-worthy opportunities.

**Skill-worthy means**: a recurring activity someone will do on THIS project — shipping, reviewing, migrating, debugging, onboarding, whatever applies — where a reusable instruction set would make it **faster** (efficient), **lower-effort** (easier), or **less likely to break something** (safer). The test is: will this skill save real time, reduce real cognitive load, or prevent real mistakes, repeatedly, on this project? If no, drop it. A domain returning zero candidates is a valid outcome.

Each sub-agent must return candidates in this exact shape, nothing else:

\`\`\`
[domain] — candidate title
Why: one sentence on the real friction observed in THIS project
Search terms: 2–3 keywords the parent should feed to find-skills
\`\`\`

Don't invent. Don't pad.

## Phase 4: Ecosystem search

After all sub-agents complete, use the **skill** tool to invoke the \`find-skills\` skill. Feed it the aggregated candidate list with search terms. Let find-skills drive discovery across skills.sh, vercel-labs/agent-skills, and anthropics/skills.

For each candidate, record the best 0–1 ecosystem match: skill name, source repo URL, and enough evidence from the skill README/source to prove it fits this project. If no fit exists, record "no match". **Do NOT install anything yet.**

## Phase 5: Prioritized recommendation

Rank every candidate that returned a real match by **crucial factor** — a 0–100% score combining:

- **Frequency** — how often someone will do this work on this project
- **Lift** — how much the skill makes it faster (efficient), lower-effort (easier), or safer (fewer mistakes, broken builds, bad releases) per hit
- **Fit** — how well the ecosystem match actually matches this project

Present highest first, in this exact format:

\`\`\`
# Skills Audit

1. <skill-name> — 92%
   Benefit: <one sentence on what it does for this project>
   Source: <repo URL>
   Scope: project

2. <skill-name> — 78%
   Benefit: …
   Source: …
   Scope: project
\`\`\`

Cap the list at 8. If you'd list more, you're padding. Default scope is \`project\` per find-skills' rules; only mark \`global\` when the skill is genuinely cross-cutting.

If strong candidates had no ecosystem match, list them at the bottom:

\`\`\`
## Gaps worth authoring

- <candidate title> — <why it matters for this project> — consider scaffolding a custom SKILL.md
\`\`\`

## Phase 6: Wait for the user

After presenting the list, ask which (if any) to install. Install nothing without explicit confirmation. Once confirmed, hand off to find-skills to perform the actual install.`,
  },
  {
    name: "setup-eyes",
    aliases: [],
    description: "Set up project perception probes and document them",
    prompt: `# Eyes: Set Up or Expand Project Perception

Build the perception probes this project needs and document them in CLAUDE.md so any future agent can use them. The \`ogcoder eyes\` CLI does the mechanical work (detect, install, verify); your job is **judgment** (which capabilities matter for THIS project) and **prose** (the project-specific triggers in CLAUDE.md). Re-run this command anytime to add or fix probes.

## Steps

1. \`ogcoder eyes list\` — see what's already installed/verified. **Resume**, don't restart. Skip verified probes; re-run failed ones.
2. \`ogcoder eyes detect\` — emits JSON of \`{capability: {candidates, primary}}\` for this project.
3. **Pick 3–8 capabilities to install this run.** Heuristics:
   - Universal: \`http\` for any API/backend, \`runtime_logs\` for anything with a server.
   - UI: \`visual\` — for multi-stack projects (e.g. React Native), install all primary candidates with distinct names: \`install visual --impl playwright --as visual-web\`, \`install visual --impl adb --as visual-android\`, \`install visual --impl simctl --as visual-ios\`.
   - Backend with email/webhooks: \`capture_email\`, \`capture_webhook\`.
   - **Always defer** opt-ins: \`load\`, \`chaos\`, \`remote\`, \`apm\` — unless the user explicitly asked.
4. For each pick: \`ogcoder eyes install <cap> [--impl <name>] [--as <name>]\`. On failure: retry once, then mark and continue — don't abort the whole run.
5. \`ogcoder eyes verify\` — runs every installed probe's self-test. Some failures (\`adb\` no device, \`simctl\` no booted simulator) are expected; they get recorded.
6. **Write/update the \`## Eyes\` section in CLAUDE.md** (create CLAUDE.md if missing; do NOT clobber other sections). Use the template below. The triggers are the load-bearing piece — make them project-specific and actionable.
7. **Report**: list verified ✓ / failed ✗ / deferred. End with the restart notice.

## CLAUDE.md \`## Eyes\` template

\`\`\`markdown
## Eyes

Perception probes live in \`.gg/eyes/\`. All headless. Artifacts → \`.gg/eyes/out/\` (gitignored). Invoke probes yourself; don't ask the user to verify what you can verify.

### Available probes

| Need | Run | Then |
|---|---|---|
| <one-line need> | \`.gg/eyes/<id>.sh <args>\` | <how to consume the output> |
| ... | ... | ... |

### When to use these eyes (automatically, without being asked)

Reach for probes ON YOUR OWN INITIATIVE when any of these apply:

- <project-specific trigger 1, e.g. "After editing any \`.tsx\` file under \`src/components/\`, screenshot the affected page with \`.gg/eyes/visual.sh http://localhost:3000/<path>\`.">
- <trigger 2, e.g. "After adding/modifying a route under \`src/routes/\`, hit it with \`.gg/eyes/http.sh\` and confirm the response shape.">
- <trigger 3>

If a probe fails or returns unexpected results, investigate the artifact directly before assuming the probe itself is broken.

### When NOT to use

- Docs-only changes, comments, formatting.
- Refactors covered by tests.
- Dev server / simulator / sink isn't up AND the task doesn't require runtime verification.
- Same probe already ran this turn on the same artifact — reuse the output.

### When to escalate a capability gap (the self-improvement loop)

If you're about to **guess**, **skip verification**, or **hand-wave** about something a better probe would show you — STOP and surface the tradeoff inline. Phrasing like:

> "I tried screenshotting but the failure is a JS error I can only see in the browser console — and there's no \`browser_console\` probe. Two paths: (a) ~3 min to add it, then I can diagnose properly. (b) Workaround: I'd guess from the DOM state. Your call?"

Wait for the user's choice. **Don't escalate more than once per request** — if the user picked the workaround, don't re-ask in the same turn.

For minor friction (worked around it but wished it were better), don't interrupt — log it for later review:
- \`ogcoder eyes log rough "<reason>" [--probe <name>]\` — minor friction, you handled it
- \`ogcoder eyes log wish "<gap>"\` — capability you wished existed
- \`ogcoder eyes log blocked "<reason>"\` — call this AFTER the user approves an inline-escalation fix, for the audit trail

These accumulate quietly. The user reviews them periodically. Open signals will appear in your context on future turns until they're acked.
\`\`\`

## Trigger writing rules

The "When to use" triggers are project-specific and the load-bearing piece — without them the agent has probes but no instinct to use them. Rules:
- For each verified probe, write at least one trigger that names a real **file pattern** or **task type** the agent will recognize ("after editing \`*.tsx\` under \`src/ui/\`", not "after UI changes").
- Be **actionable** ("screenshot the page", "hit the endpoint") not **vague** ("verify it works").
- Match density to the project: a UI-heavy app warrants strong visual triggers; a pure backend library does not.

## Restart notice

End your report with:

> ⚠ CLAUDE.md was updated. ggcoder loads CLAUDE.md at startup, so **exit and restart ggcoder** (\`/quit\` then \`ggcoder\` again) before asking me to use these probes. Without a restart, I won't see the new instructions in my context.`,
  },
  {
    name: "eyes-improve",
    aliases: [],
    description: "Triage eyes signals and apply approved probe fixes",
    prompt: `# Eyes Improve: Triage Accumulated Signals

Read the open signals in \`.gg/eyes/journal.jsonl\`, group related ones, propose concrete fixes, and apply what the user approves. This isn't unbounded refactoring — it's incremental probe improvement driven by real use.

## Steps

1. \`ogcoder eyes log list --status open\` — if zero entries, say "nothing to triage" and stop.
2. **Group** signals by likely fix:
   - Multiple \`rough\` entries naming the same probe / same frustration → one patch to that probe.
   - \`wish\` entries naming a capability not installed → one \`ogcoder eyes install <cap>\` proposal.
   - \`blocked\` entries are historical (user already resolved inline) → ack them, no new work.
3. **Cap at 5 proposals this run.** If more would apply, mention them and stop — they'll resurface next run.
4. For each group, propose ONE concrete change:
   - **Probe tweak**: read \`.gg/eyes/<name>.sh\`, show a diff, explain what it fixes.
   - **New probe**: \`ogcoder eyes install <cap>\` with a one-line justification.
   - **New/updated trigger**: bullet added under \`## Eyes → When to use\` in CLAUDE.md.
5. Present all proposals as a numbered list with diffs inline. Ask: **"Accept which? Reply with numbers (e.g. '1, 3') or 'none'."**
6. On user reply:
   - For accepted: apply the change. Then \`ogcoder eyes log ack <id>\` for every journal entry the proposal covers.
   - For unmentioned / rejected: \`ogcoder eyes log defer <id>\` so they stop appearing in context every turn. The user can resurrect deferred entries later.
7. **Report**: applied changes (one line each), entries acked, entries deferred.

## Rules

- **No fishing.** Only act on entries already in the journal. Don't scan the repo for hypothetical gaps.
- **No scope creep.** "Add a \`--wait-for-selector\` flag to the visual probe" is in scope. "Rewrite the probe in TypeScript" is not.
- **Preserve user edits.** If \`.gg/eyes/<name>.sh\` has diverged from the shipped impl (user hand-edited), point this out and ask before overwriting.
- **Be honest about tradeoffs.** If a proposed fix might break existing invocations, say so in the proposal.
- **Decline when appropriate.** If open signals are all vague or low-value, say so and defer them — don't manufacture fixes.`,
  },
];

/** Look up a prompt command by name or alias */
export function getPromptCommand(name: string): PromptCommand | undefined {
  return PROMPT_COMMANDS.find((cmd) => cmd.name === name || cmd.aliases.includes(name));
}
