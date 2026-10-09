import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addWorkspaceRoot, removeWorkspaceRoot } from "./workspace-roots.js";

async function tree() {
  const base = realpathSync(await mkdtemp(path.join(os.tmpdir(), "roots-")));
  const cwd = path.join(base, "project");
  const other = path.join(base, "other");
  await mkdir(path.join(cwd, "sub"), { recursive: true });
  await mkdir(path.join(other, "nested"), { recursive: true });
  await writeFile(path.join(base, "file.txt"), "x");
  return { base, cwd, other };
}

describe("workspace roots", () => {
  it("adds a root in place so every holder of the array sees it", async () => {
    const { cwd, other } = await tree();
    const roots: string[] = [];
    const shared = roots;
    expect(await addWorkspaceRoot(cwd, roots, "../other")).toEqual({ ok: true, root: other });
    expect(shared).toEqual([other]);
  });

  it("refuses missing paths, files and folders already in the workspace", async () => {
    const { base, cwd } = await tree();
    const roots: string[] = [];
    expect((await addWorkspaceRoot(cwd, roots, "../missing")).ok).toBe(false);
    expect((await addWorkspaceRoot(cwd, roots, path.join(base, "file.txt"))).ok).toBe(false);
    expect((await addWorkspaceRoot(cwd, roots, "sub")).ok).toBe(false);
    expect(roots).toEqual([]);
  });

  it("drops roots a new parent root subsumes", async () => {
    const { cwd, other } = await tree();
    const roots: string[] = [];
    await addWorkspaceRoot(cwd, roots, path.join(other, "nested"));
    await addWorkspaceRoot(cwd, roots, other);
    expect(roots).toEqual([other]);
  });

  it("removes only an exact added root", async () => {
    const { cwd, other } = await tree();
    const roots = [other];
    expect(removeWorkspaceRoot(cwd, roots, path.join(other, "nested")).ok).toBe(false);
    expect(removeWorkspaceRoot(cwd, roots, "../other")).toEqual({ ok: true, root: other });
    expect(roots).toEqual([]);
  });
});
