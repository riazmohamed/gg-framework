import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the on-disk path of a Python sidecar shipped under `src/core/python/`.
 *
 * In `src/` (during tests / dev), `import.meta.url` points inside `src/core/python/`
 * so the script sits next to this file. In `dist/` (after `tsc`), the build's
 * post-step copies `src/core/python/` → `dist/core/python/`, so the same
 * relative resolution works.
 *
 * If the script cannot be found we throw — better an explicit error than
 * silently spawning Python with a non-existent path.
 */
export function sidecarPath(filename: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, filename);
  if (!existsSync(candidate)) {
    throw new Error(
      `python sidecar '${filename}' not found at ${candidate} — ` +
        "the build step that copies src/core/python/ → dist/core/python/ may have failed",
    );
  }
  return candidate;
}
