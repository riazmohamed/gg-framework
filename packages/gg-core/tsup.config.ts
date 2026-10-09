import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/model-registry.ts", "src/paths.ts"],
  format: ["esm", "cjs"],
  // tsup's declaration build sets `baseUrl`, which TypeScript 6 deprecates.
  // Silence that for the dts step only, not the whole repo.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  clean: true,
  sourcemap: true,
  // Keep heavy optional, dynamic-imported deps external so they are resolved at
  // runtime by the consuming app (and stay genuinely optional) rather than
  // bundled into gg-core's published tarball.
  external: ["@huggingface/transformers", "ogg-opus-decoder"],
});
