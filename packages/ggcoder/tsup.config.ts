import { defineConfig } from "tsup";

// Packages that must NOT be bundled (native addons, WASM, optional deps)
const EXTERNAL = new Set([
  "sharp",
  "@huggingface/transformers",
  "ogg-opus-decoder",
  "react-devtools-core",
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
