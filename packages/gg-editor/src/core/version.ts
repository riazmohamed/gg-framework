/**
 * Read the package version from the shipped package.json. Used by
 * banners + the TUI so the version label always matches the installed
 * artifact, no matter what the dev's local 0.1.0 placeholder said.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

export function getPackageVersion(): string {
  if (cached) return cached;
  // dist/core/version.js → ../../package.json
  // src/core/version.ts (during tests) → ../../package.json
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    cached = pkg.version ?? "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}
