---
description: Research README conventions via the grep MCP server, then generate a README.md tailored to the current application project.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, mcp__grep__searchGitHub
---

# /readme-convention

Generate a `README.md` for the current application project. Conventions are not hard-coded — they are pulled fresh each run from real-world READMEs on GitHub via the `mcp__grep__searchGitHub` tool, so the structure tracks what production projects are actually doing today.

## Usage

```
/readme-convention
```

Optional argument: a hint about the project type (e.g. `cli`, `web app`, `library`, `mobile app`, `api`). If omitted, infer from the working tree.

---

## Phase 1 — Probe the project (read-only)

Gather everything needed to write a concrete, non-generic README. Run these in parallel where possible.

```bash
pwd
basename "$PWD"
git remote -v 2>/dev/null
git log -1 --pretty=%cI 2>/dev/null
ls -la
```

Detect stack and entry points by reading whichever of these exist:

- `package.json` → name, description, scripts, dependencies, bin, engines
- `pyproject.toml` / `setup.py` / `requirements.txt` → Python project, deps, console scripts
- `Cargo.toml` → Rust crate metadata
- `go.mod` → Go module path
- `Gemfile` / `*.gemspec` → Ruby
- `composer.json` → PHP
- `pubspec.yaml` → Dart/Flutter
- `Dockerfile` / `compose.yaml` → containerized
- `.env.example` / `.env.sample` → required env vars
- `LICENSE` → license type
- existing `README*.md` → preserve any custom sections the user clearly wrote by hand

If a stack signal is ambiguous, ask before guessing.

## Phase 2 — Pull live README conventions via grep MCP

Use `mcp__grep__searchGitHub` with `path: README.md` and `language: ["Markdown"]` to sample current conventions. Run several of these searches **in parallel** in a single message:

- `^## Installation$` (regex) — installation block phrasing
- `^## (Quick Start|Quickstart|Getting Started)$` (regex) — onboarding section name
- `^## Features$` (regex) — feature-list style
- `^## Usage$` (regex) — usage block style
- `^## Configuration$` (regex) — env / config block style
- `^## Contributing$` (regex) — contribution conventions
- `^## License$` (regex) — license footer style
- `^## Table of Contents$` (regex) — when projects use a TOC

If the project hint maps to a stack, add **one** stack-targeted search to ground the output in idiomatic examples — e.g. for a CLI: `^## Commands$`; for a Next.js app: `'next dev'` with `path: README.md`; for a Python package: `'pip install'` with `path: README.md`.

Read 2–4 hits per query — enough to see consensus, not so many that you drown. Note which sections appear in the **majority** of relevant samples; those become required in the generated README. Sections that appear only occasionally become optional and only included if the project actually has the corresponding content.

## Phase 3 — Synthesize the README

Write `README.md` at the project root using the convention distilled from the searches plus the concrete facts from Phase 1. The goal is a README that a stranger could land on and ship from in under five minutes.

Default skeleton (drop sections that don't apply — never invent content to fill them):

```markdown
# {{Project Name}}

{{One-line tagline — what it is, who it's for. No filler.}}

{{Badges if relevant: build, version, license, coverage. Skip if nothing real to badge.}}

{{Optional: hero screenshot / demo gif if assets/ has one.}}

## Features

- {{concrete capability 1}}
- {{concrete capability 2}}
- {{...}}

## Quick Start

```bash
{{the shortest path from `git clone` to a working app}}
```

## Installation

### Prerequisites
- {{language/runtime version from engines / pyproject / go.mod}}
- {{system deps if any}}

### Install
```bash
{{install command for the detected package manager}}
```

## Usage

{{Minimum runnable example — actual command or code, not pseudocode. Pull from scripts/bin/main entry.}}

## Configuration

{{Only if .env.example or a config file exists. Table of env var → purpose → default.}}

| Variable | Description | Default |
| --- | --- | --- |
| `FOO` | … | `bar` |

## Project Structure

{{Only if non-obvious. Tree of top-level directories with one-line purpose each.}}

## Development

```bash
{{test command}}
{{lint command}}
{{build command}}
```

## Contributing

{{One paragraph or link to CONTRIBUTING.md if it exists.}}

## License

{{License name}} — see [LICENSE](LICENSE).
```

Rules while filling in the skeleton:

- **No placeholders in the final file.** If a section can't be filled with real, project-specific content, delete it.
- **Commands must be the real ones** — read them out of `package.json` scripts, `pyproject.toml` `[tool.poetry.scripts]`, `Makefile` targets, etc.
- **Don't fabricate badges, screenshots, CI status, or coverage numbers.**
- **Match the dominant tone** of the convention sample — terse for libraries, narrative for apps.
- **Preserve hand-written sections** from any existing README that have content the probe can't regenerate (architecture notes, design rationale, acknowledgments).

## Phase 4 — Confirm and write

Before writing, show the user:

1. Detected stack + project type.
2. The section list you intend to include (and why each is in or out).
3. Anything you're going to drop from an existing README.

Wait for approval, then write `README.md`. After writing, print a short summary: file path, section count, and any TODOs the user still needs to fill in (e.g. "add screenshot at `docs/hero.png`").

## Refusal / stop conditions

- Working directory is not a project (no manifest file, no source files).
- An existing `README.md` is substantially hand-written and the user hasn't authorized overwriting — offer to write to `README.generated.md` for diffing instead.
- Stack detection conflicts (e.g. both `package.json` and `pyproject.toml` with active sources) — ask which one is the project's primary surface before generating.
