# Matey

Matey is an Electron desktop app built with React, TypeScript, and electron-vite.

## Dependency isolation

Matey is intentionally isolated from the root gg-framework workspace dependency graph.
It has its own `pnpm-workspace.yaml` and `pnpm-lock.yaml`, and its direct dependency versions are pinned exactly.

Use `pnpm --dir Matey ...` from the repository root, or `cd Matey && pnpm ...`.
Do not add `workspace:*` dependencies here unless Matey is deliberately being coupled to another package.

## Scripts

```bash
pnpm --dir Matey install
pnpm --dir Matey dev
pnpm --dir Matey check
pnpm --dir Matey lint
pnpm --dir Matey format:check
pnpm --dir Matey build
pnpm --dir Matey package
```

`package` creates an unpacked local build with electron-builder. Use `dist` when you are ready to produce distributable artifacts.
