/**
 * Copy Python sidecars from src/core/python/ → dist/core/python/.
 *
 * tsc only emits .ts → .js. The .py sidecars (beats.py, face_reframe.py) are
 * loaded at runtime by tools that spawn Python; they need to ship in the
 * published package. Run as the post-tsc step from `pnpm build`.
 */
import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const src = resolve(pkgRoot, "src/core/python");
const dst = resolve(pkgRoot, "dist/core/python");

mkdirSync(dst, { recursive: true });

let copied = 0;
for (const name of readdirSync(src)) {
  if (!name.endsWith(".py")) continue;
  const srcPath = resolve(src, name);
  const dstPath = resolve(dst, name);
  cpSync(srcPath, dstPath);
  copied += 1;
}

const stat = statSync(dst);
console.log(`copy-python: copied ${copied} sidecar(s) → ${dst} (mtime ${stat.mtime.toISOString()})`);
