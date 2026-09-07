import { defineConfig } from "tsup";

// Packages that must NOT be bundled (native addons, WASM, optional deps)
const EXTERNAL = new Set([
  "sharp",
  "@huggingface/transformers",
  "ogg-opus-decoder",
  "react-devtools-core",
  // TypeScript ships a CJS bundle that reads `__filename` at module scope, which
  // is undefined in our ESM output ("__filename is not defined in ES module
  // scope" at startup). It is a declared runtime dependency, so Node resolves it
  // from node_modules — and keeping it out of the bundle drops a ~16 MB chunk.
  "typescript",
  "typescript-language-server",
]);

// Shim for CJS deps that call require() on Node built-ins inside ESM output.
// Uses unique names to avoid clashing with esbuild's own __dirname shim.
const CJS_SHIM = `
import { createRequire as __tsup_createRequire } from 'node:module';
const require = __tsup_createRequire(import.meta.url);
`;

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
    // Spawned as its own process by the desktop app (and by
    // app-sidecar-*.test.ts), so it must be a real entry point, not a chunk.
    "app-sidecar": "src/app-sidecar.ts",
    // Every subpath in package.json `exports` needs its own entry: tsup only
    // emits what it is told to, unlike the file-mirroring tsc build upstream
    // uses. An unlisted subpath resolves to a file that was never written.
    "ui/components/index": "src/ui/components/index.ts",
    "ui/theme/theme": "src/ui/theme/theme.ts",
    "ui/theme/detect-theme": "src/ui/theme/detect-theme.ts",
    "ui/hooks/useTerminalSize": "src/ui/hooks/useTerminalSize.ts",
    "ui/hooks/useAgentLoop": "src/ui/hooks/useAgentLoop.ts",
    "ui/hooks/useDoublePress": "src/ui/hooks/useDoublePress.ts",
    "ui/hooks/useTranscriptHistory": "src/ui/hooks/useTranscriptHistory.ts",
    "ui/transcript/spacing": "src/ui/transcript/spacing.ts",
    "ui/transcript/TranscriptItemFrame": "src/ui/transcript/TranscriptItemFrame.tsx",
    "ui/terminal-history": "src/ui/terminal-history.ts",
    "ui/tool-group-summary": "src/ui/tool-group-summary.ts",
    "ui/transcript/tool-presentation": "src/ui/transcript/tool-presentation.ts",
    "ui/terminal-history-format": "src/ui/terminal-history-format.ts",
    "ui/login": "src/ui/login.tsx",
    "core/model-registry": "src/core/model-registry.ts",
  },
  format: ["esm"],
  target: "es2022",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  // Bundle all deps into the output so Node doesn't resolve hundreds of
  // files from node_modules at startup (critical on WSL / slow filesystems).
  // Native addons and heavy WASM packages that are lazily imported stay external.
  noExternal: [/^(?!node:).+/],
  external: [...EXTERNAL],
  banner: {
    js: CJS_SHIM,
  },
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.jsxImportSource = "react";
    // Ensure external packages are truly external even with noExternal
    options.external = [...(options.external ?? []), ...EXTERNAL];
  },
});
