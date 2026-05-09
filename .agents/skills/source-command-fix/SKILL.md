---
name: "source-command-fix"
description: "Run typechecking, linting, and formatting checks, then spawn parallel agents to fix all issues"
---

# source-command-fix

Use this skill when the user asks to run the migrated source command `fix`.

## Command Template

# Project Code Quality Check

This command runs all code quality tools, collects errors, groups them by domain, and spawns parallel agents to fix them.

## Step 1: Run All Checks

Run these commands and capture output:

```bash
pnpm check 2>&1
pnpm lint 2>&1
pnpm format:check 2>&1
```

## Step 2: Collect and Parse Errors

Parse the output from all three commands. Group errors by domain:
- **Type errors**: Issues from `pnpm check` (tsc --noEmit)
- **Lint errors**: Issues from `pnpm lint` (eslint)
- **Format errors**: Issues from `pnpm format:check` (prettier)

Create a list of all files with issues and the specific problems in each file.

## Step 3: Spawn Parallel Agents

For each domain that has issues, spawn an agent in parallel using the Agent tool:

**IMPORTANT**: Use a SINGLE response with MULTIPLE Agent tool calls to run agents in parallel.

- Spawn a "type-fixer" agent for type errors — fix all TypeScript errors, then run `pnpm check` to verify
- Spawn a "lint-fixer" agent for lint errors — fix all ESLint issues (use `pnpm lint:fix` first, then manually fix remaining), then run `pnpm lint` to verify
- Spawn a "format-fixer" agent for format errors — run `pnpm format` to auto-fix all formatting issues

Each agent should:
1. Receive the list of files and specific errors in their domain
2. Fix all errors in their domain
3. Run the relevant check command to verify fixes
4. Report completion

## Step 4: Verify All Fixes

After all agents complete, run the full check again:

```bash
pnpm check && pnpm lint && pnpm format:check
```

Fix any remaining issues until all checks pass with zero errors.
