/**
 * Path-safety helpers for file-writing tools.
 *
 * Two distinct guards live here:
 *
 *   1. `safeOutputPath()` — path-traversal guard. Resolves `requested` against
 *      `cwd`, then refuses absolute paths that escape the configured allow-list
 *      of roots (cwd, system tempdir, the per-user output dir under ~/Documents).
 *      Tools writing on behalf of the agent must call this before opening any
 *      file handle — it stops the agent from writing to `../../etc/passwd` even
 *      when the user has not validated the value.
 *
 *   2. `safeResolveOutputPath()` — sandbox redirect for paths that NLE hosts
 *      (Resolve, Premiere) need to read back. macOS-sandboxed Node writes under
 *      `/var/folders/...` are invisible to the host process, so we transparently
 *      redirect to `~/Documents/gg-editor-out/`. The redirect is reported back
 *      through tool output so the agent can surface it.
 */

import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, resolve as resolvePath } from "node:path";

/** Default user-visible output directory for sandbox-redirected files. */
export const USER_OUTPUT_DIR_NAME = "gg-editor-out";

/** Build the full path of the per-user output directory. */
export function userOutputDir(): string {
  return resolvePath(homedir(), "Documents", USER_OUTPUT_DIR_NAME);
}

function realTmpdir(): string {
  // On macOS, tmpdir() returns /var/folders/... which itself is one of the
  // sandbox roots we redirect FROM. We still allow it as an output root for
  // ffmpeg-only tools that don't feed Resolve back; the redirect helper is
  // the one that pushes Resolve-facing writes elsewhere.
  return resolvePath(tmpdir());
}

function defaultAllowRoots(cwd: string): string[] {
  return [resolvePath(cwd), realTmpdir(), userOutputDir()];
}

function isUnderRoot(absPath: string, root: string): boolean {
  const a = absPath;
  const r = root.endsWith("/") || root.endsWith("\\") ? root.slice(0, -1) : root;
  if (a === r) return true;
  // Use platform-aware separator: on Windows the resolve() output uses '\\'.
  const sep = a.includes("\\") && !a.includes("/") ? "\\" : "/";
  return a.startsWith(r + sep);
}

export interface SafeOutputOptions {
  /** Additional absolute paths that are valid output roots. */
  allowRoots?: string[];
}

/**
 * Resolve `requested` against `cwd` and verify it lies under an allowed root.
 * Throws an Error whose message follows the `error:` format consumed by tools.
 */
export function safeOutputPath(cwd: string, requested: string, opts?: SafeOutputOptions): string {
  if (!requested || typeof requested !== "string") {
    throw new Error("output path is empty");
  }
  const abs = resolvePath(cwd, requested);
  const roots = [...defaultAllowRoots(cwd), ...(opts?.allowRoots ?? []).map((r) => resolvePath(r))];
  for (const root of roots) {
    if (isUnderRoot(abs, root)) return abs;
  }
  throw new Error(
    `output path '${requested}' resolves outside allowed roots (cwd, tempdir, ~/Documents/${USER_OUTPUT_DIR_NAME})`,
  );
}

/** Sandbox roots whose writes are invisible to host (Resolve/Premiere) processes. */
function sandboxRoots(): string[] {
  const roots = ["/var/folders/", "/private/var/folders/", "/private/tmp/", "/tmp/", "/var/tmp/"];
  // On Windows, %LOCALAPPDATA%\Temp comes back via tmpdir(); treat the system
  // tempdir as a sandbox if it's not directly under the user profile.
  const t = realTmpdir();
  const home = resolvePath(homedir());
  if (!isUnderRoot(t, home)) roots.push(t);
  return roots;
}

function isSandboxPath(absPath: string): boolean {
  for (const root of sandboxRoots()) {
    if (
      absPath === root ||
      absPath.startsWith(root) ||
      // Tolerate trailing-slash absent variants on POSIX:
      (root.endsWith("/") && absPath.startsWith(root.slice(0, -1) + "/"))
    ) {
      return true;
    }
  }
  return false;
}

export interface SafeResolveResult {
  /** Final absolute path after redirect (if any). */
  path: string;
  /** True when the original request landed in a sandbox-only location. */
  redirected: boolean;
  /** Human-readable reason for the redirect, when applicable. */
  reason?: string;
}

/**
 * Like `safeOutputPath`, but additionally redirects sandbox-only paths to the
 * user-visible output dir so that NLE host processes (which run outside Node's
 * sandbox) can read the result back. Use for stills / thumbnails / GIFs that
 * the host might import.
 */
export function safeResolveOutputPath(
  cwd: string,
  requested: string,
  opts?: SafeOutputOptions,
): SafeResolveResult {
  const abs = isAbsolute(requested) ? resolvePath(requested) : safeOutputPath(cwd, requested, opts);
  if (!isSandboxPath(abs)) {
    return { path: abs, redirected: false };
  }
  const out = resolvePath(userOutputDir(), basename(abs));
  return {
    path: out,
    redirected: true,
    reason: `original path '${abs}' is in a sandboxed temp directory and would be invisible to the host process`,
  };
}
