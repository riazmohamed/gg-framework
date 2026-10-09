import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Outcome of an `/add-dir` or `/remove-dir`, shaped for direct display. */
export type WorkspaceRootResult = { ok: true; root: string } | { ok: false; error: string };

function resolveRoot(cwd: string, dir: string): string {
  return path.resolve(cwd, dir.replace(/^~(?=[/\\]|$)/, os.homedir()));
}

/**
 * Add another workspace root to `roots` (mutated in place, so every holder of
 * the array — write guard, sandbox, prompt builder — sees the same list).
 * Tools already accept absolute paths, so a root only widens the write guard
 * and tells the model the folder exists.
 */
export async function addWorkspaceRoot(
  cwd: string,
  roots: string[],
  dir: string,
): Promise<WorkspaceRootResult> {
  const resolved = resolveRoot(cwd, dir);
  let stat: Stats;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return { ok: false, error: `Not found: ${resolved}` };
  }
  if (!stat.isDirectory()) return { ok: false, error: `Not a directory: ${resolved}` };

  const covered = [cwd, ...roots].some((root) => {
    const relative = path.relative(path.resolve(root), resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (covered) return { ok: false, error: `Already in the workspace: ${resolved}` };

  // Drop roots the new one subsumes so the list stays minimal.
  const kept = roots.filter((root) => {
    const relative = path.relative(resolved, path.resolve(root));
    return relative.startsWith("..") || path.isAbsolute(relative);
  });
  roots.splice(0, roots.length, ...kept, resolved);
  return { ok: true, root: resolved };
}

/** Remove an exact root previously added with `/add-dir` (mutates `roots`). */
export function removeWorkspaceRoot(
  cwd: string,
  roots: string[],
  dir: string,
): WorkspaceRootResult {
  const resolved = resolveRoot(cwd, dir);
  const index = roots.findIndex((root) => path.resolve(root) === resolved);
  if (index === -1) {
    return { ok: false, error: `Not an additional workspace root: ${resolved}` };
  }
  roots.splice(index, 1);
  return { ok: true, root: resolved };
}
