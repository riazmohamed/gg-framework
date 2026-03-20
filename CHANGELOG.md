# Changelog

## rebrand/abukhaled (2026-03-20)

### Rebrand: @kenkaiiii → @abukhaled

Full rebrand of the project from `@kenkaiiii/gg-coder` / "GG Coder" / "Ken Kai" to `@abukhaled/og-coder` / "OG Coder" / "Abu Khaled".

#### Naming & References
- Renamed npm scope from `@kenkaiiii` to `@abukhaled` across all packages
- Renamed CLI product name from "GG Coder" to "OG Coder"
- Renamed author from "Ken Kai" to "Abu Khaled"
- Updated `APP_NAME` from `ggcoder` to `ogcoder` in `config.ts`
- Updated terminal title to "OG Coder" in `useTerminalTitle.ts`

#### Banner / Logo
- Redesigned ASCII logo from "GG" to "OG" using matching block-character style (`▄▀▀▄ ▄▀▀▀` / `█  █ █ ▀█` / `▀▄▄▀ ▀▄▄▀`)
- Changed banner layout to always stack logo above info text (logo on top, details below)
- Fixes split-pane rendering issues in Warp where `stdout.columns` reports full terminal width instead of pane width, causing side-by-side layout to wrap and break the logo
- Path display uses Ink's `wrap="truncate"` for native overflow handling
- Uses `useTerminalSize()` context instead of raw `useStdout()` for consistent resize behavior

#### Files Changed
- `CLAUDE.md`, `README.md`, `BUILD_GUIDE.md`, `packages/ggcoder/README.md` — updated branding references
- `packages/ggcoder/src/config.ts` — `APP_NAME` → `ogcoder`
- `packages/ggcoder/src/ui/components/Banner.tsx` — new OG logo, stacked layout
- `packages/ggcoder/src/ui/hooks/useTerminalTitle.ts` — title → "OG Coder"
- `packages/ggcoder/src/ui/login.tsx` — branding updates
- `packages/ggcoder/src/ui/sessions.ts` — branding updates
- `packages/ggcoder/src/ui/App.tsx` — branding updates
- `packages/ggcoder/src/ui/components/TaskOverlay.tsx` — branding updates
- `packages/ggcoder/src/cli.ts` — branding updates
- `packages/ggcoder/src/system-prompt.ts` — branding updates
- `packages/ggcoder/src/core/logger.ts` — branding updates
- `packages/ggcoder/src/core/auth-storage.ts` — branding updates
- `packages/ggcoder/src/core/auto-update.ts` — branding updates
- `packages/ggcoder/src/core/mcp/client.ts` — branding updates
- `packages/ggcoder/src/core/oauth/openai.ts` — branding updates
- `packages/ggcoder/src/modes/serve-mode.ts` — branding updates
- `packages/ggcoder/src/tools/web-fetch.ts` — branding updates
- `packages/ggcoder/src/utils/error-handler.ts` — branding updates
- `packages/ggcoder/src/utils/format.ts` — branding updates
- `packages/ggcoder/src/utils/image.ts` — branding updates
- `packages/gg-ai/src/providers/openai-codex.ts` — branding updates
