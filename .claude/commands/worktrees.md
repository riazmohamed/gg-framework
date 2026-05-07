allowed-tools: Agent, Task, Bash, Read, Write, Edit, Glob, Grep, EnterWorktree, TodoWrite, mcp__sequential-thinking__sequentialthinking, mcp__grep__searchGitHub
argument-hint: [task or phase description]
description: Create an isolated git worktree, explore the codebase, then start working on the task.
---

# Worktree Session

**Task:**

$ARGUMENTS

## Step 1: Create the worktree

Generate a short, descriptive kebab-case name from the task description (e.g. "fix auth bug" becomes `fix-auth-bug`, "phase 19 scheduler" becomes `phase-19-scheduler`). Max 30 characters.

Use the `EnterWorktree` tool with that name to create and enter an isolated git worktree. This gives you a clean copy of the repo on a new branch where all your changes are isolated from main.

## Step 2: Confirm the workspace

After entering the worktree, run `pwd` and `git branch --show-current` to confirm you're in the new worktree on the correct branch. Tell the user:
- The worktree path
- The branch name
- The task you're about to work on

## Step 3: Explore the codebase (parallel agents)

Spawn **2 explore agents in parallel** using the Agent tool (subagent type: Explore) to build a mental map of the codebase. Both agents should be thorough.

**Agent 1 — Architecture & patterns:**
- Read CLAUDE.md, MEMORY.md, README, ARCHITECTURE.md, any docs/
- Read .claude/rules/* for conventions
- Understand the project's architecture, key abstractions, and coding patterns
- Identify the areas most relevant to the task

**Agent 2 — Code structure & recent activity:**
- Map the directory structure and key files (package.json, configs, entry points)
- Read the source files most relevant to the task description
- Run `git log --oneline -20` to see recent changes
- Understand how data flows through the parts of the codebase the task will touch

## Step 4: Synthesize and plan

Once both agents return, synthesize their findings into a brief overview:
- What areas of the codebase are relevant to this task
- Key files you'll need to modify
- Patterns and conventions to follow
- Any gotchas or dependencies to be aware of

Then present a clear plan for the task:
1. What you're going to do (broken into phases if complex)
2. Which files will be touched
3. How you'll validate (tests, typecheck, lint)

Wait for the user to confirm or adjust the plan before starting implementation.

## Step 5: Execute

Once the user approves, begin implementation. Follow the project's conventions discovered in Step 3. Test after each phase using whatever check command the project uses (e.g. `npm run check`, `bun test`, `npm run typecheck`).

---

## Notes

- The worktree is **isolated** — your changes don't affect main until you merge
- When you're done, the user will be prompted to keep or remove the worktree
- If the task description references a phase number, plan, or issue — look for it in docs/, TODO files, GitHub issues, or the project's task tracking before starting
- Always commit your work in the worktree before finishing so nothing is lost
