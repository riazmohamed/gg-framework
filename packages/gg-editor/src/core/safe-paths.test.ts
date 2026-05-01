import { homedir, tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";

import {
  USER_OUTPUT_DIR_NAME,
  safeOutputPath,
  safeResolveOutputPath,
  userOutputDir,
} from "./safe-paths.js";

const cwd = resolvePath(homedir(), "sample-project");

describe("safeOutputPath", () => {
  it("accepts a relative path under cwd", () => {
    const out = safeOutputPath(cwd, "out/clip.mp4");
    expect(out).toBe(resolvePath(cwd, "out/clip.mp4"));
  });

  it("rejects escape via parent-dir traversal", () => {
    expect(() => safeOutputPath("/Users/agent/proj", "../../etc/passwd")).toThrow(
      /outside allowed roots/,
    );
  });

  it("accepts absolute paths under the user output dir", () => {
    const target = resolvePath(userOutputDir(), "thumb.jpg");
    const out = safeOutputPath(cwd, target);
    expect(out).toBe(target);
  });

  it("accepts absolute paths under the system tempdir", () => {
    const target = resolvePath(tmpdir(), "scratch", "x.wav");
    const out = safeOutputPath(cwd, target);
    expect(out).toBe(target);
  });

  it("rejects an absolute path outside the allowlist", () => {
    expect(() => safeOutputPath(cwd, "/etc/hosts")).toThrow(/outside allowed roots/);
  });

  it("accepts paths under user-supplied allowRoots", () => {
    const root = resolvePath(homedir(), "Movies", "raw");
    const target = resolvePath(root, "a.mp4");
    const out = safeOutputPath(cwd, target, { allowRoots: [root] });
    expect(out).toBe(target);
  });

  it("rejects empty input", () => {
    expect(() => safeOutputPath(cwd, "")).toThrow(/empty/);
  });

  it("treats Windows-style drive letters consistently with node:path", () => {
    // On POSIX runners this becomes a relative-looking path; the assertion
    // just guarantees we don't throw on the segment shape — node:path picks
    // the platform behaviour and we trust it.
    const out = safeOutputPath(cwd, "C:/Users/me/out.mp4");
    expect(out.endsWith("out.mp4")).toBe(true);
  });
});

describe("safeResolveOutputPath", () => {
  it("leaves a regular cwd-relative path unchanged", () => {
    const r = safeResolveOutputPath(cwd, "thumb.jpg");
    expect(r.redirected).toBe(false);
    expect(r.path.endsWith("thumb.jpg")).toBe(true);
  });

  it("redirects /tmp paths to ~/Documents/gg-editor-out", () => {
    const r = safeResolveOutputPath(cwd, "/tmp/grab.jpg");
    expect(r.redirected).toBe(true);
    expect(r.path).toBe(resolvePath(userOutputDir(), "grab.jpg"));
    expect(r.reason).toMatch(/sandbox/);
  });

  it("redirects /var/folders sandbox paths", () => {
    const r = safeResolveOutputPath(cwd, "/var/folders/zz/abc/T/grab.jpg");
    expect(r.redirected).toBe(true);
    expect(r.path).toBe(resolvePath(userOutputDir(), "grab.jpg"));
  });

  it("redirects /private/var paths", () => {
    const r = safeResolveOutputPath(cwd, "/private/var/folders/zz/T/grab.jpg");
    expect(r.redirected).toBe(true);
  });

  it("preserves an absolute path under the user output dir", () => {
    const target = resolvePath(userOutputDir(), "explicit.jpg");
    const r = safeResolveOutputPath(cwd, target);
    expect(r.redirected).toBe(false);
    expect(r.path).toBe(target);
  });

  it("exports a sensible USER_OUTPUT_DIR_NAME constant", () => {
    expect(USER_OUTPUT_DIR_NAME).toBe("gg-editor-out");
    expect(userOutputDir().endsWith(USER_OUTPUT_DIR_NAME)).toBe(true);
  });
});
