---
name: "source-command-update-app"
description: "Update dependencies, fix deprecations and warnings"
---

# source-command-update-app

Use this skill when the user asks to run the migrated source command `update-app`.

## Command Template

# Dependency Update & Deprecation Fix

## Step 1: Check for Updates

```bash
pnpm outdated
```

Review the output. Note all packages with available updates.

## Step 2: Update Dependencies

```bash
pnpm update
pnpm audit fix
```

For major version bumps that `pnpm update` won't handle, use `pnpm update --latest` selectively or update `package.json` versions manually.

## Step 3: Check for Deprecations & Warnings

Run a clean install and read ALL output carefully:

```bash
rm -rf node_modules packages/*/node_modules pnpm-lock.yaml
pnpm install
```

Look for:
- Deprecation warnings
- Security vulnerabilities
- Peer dependency warnings
- Breaking changes

## Step 4: Fix Issues

For each warning/deprecation:
1. Research the recommended replacement or fix
2. Update code/dependencies accordingly
3. Re-run `pnpm install`
4. Verify no warnings remain

## Step 5: Run Quality Checks

```bash
pnpm build
pnpm check
pnpm lint
pnpm format:check
```

Fix all errors before continuing. Quick fixes:
- `pnpm lint:fix` for ESLint issues
- `pnpm format` for Prettier formatting

## Step 6: Verify Clean Install

```bash
rm -rf node_modules packages/*/node_modules pnpm-lock.yaml
pnpm install
pnpm build
```

Verify ZERO warnings/errors and all dependencies resolve correctly.
