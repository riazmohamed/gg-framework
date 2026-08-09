import os from "node:os";
import path from "node:path";
import { getAppPaths } from "../config.js";

/**
 * Workspace write guard + catastrophic-command guard.
 *
 * Enforced in code (not just prompt): write/edit targets outside the
 * allow-listed roots are blocked with an instructive tool error unless the
 * user opted in via the `allowOutsideWorkspaceWrites` setting. The bash tool
 * additionally refuses a tiny set of unambiguous filesystem disasters
 * (recursive force-remove of /, ~, $HOME, the workspace root, a bare drive
 * root, and mirror force-pushes) until the user explicitly confirms.
 *
 * Deliberately narrow: ordinary `rm -rf node_modules`, `git reset --hard`,
 * etc. stay instructional (ask-first at the prompt level), exactly as today.
 */

export interface WriteGuardSettings {
  allowOutsideWorkspaceWrites?: boolean;
  /** Extra workspace roots added at runtime via `/add-dir`. */
  additionalRoots?: string[];
}

export interface WriteGuardResult {
  allowed: boolean;
  reason?: string;
}

/** True when `target` is `root` or contained within it. */
function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Every root the agent may write within.
 *
 * Shared by the write guard and the removal guard below, so the two cannot
 * drift into disagreeing about what "inside the workspace" means — which is
 * exactly how `write ~/notes.md` came to be blocked while `rm -rf ~/notes`
 * was not.
 */
function workspaceRootsFor(cwd: string, settings?: WriteGuardSettings): string[] {
  return [
    path.resolve(cwd),
    ...(settings?.additionalRoots ?? []).map((root) => path.resolve(root)),
    path.resolve(os.tmpdir()),
    path.resolve(getAppPaths().agentDir),
  ];
}

/**
 * Decide whether a resolved write/edit target path is allowed.
 * Allowed by default: under `cwd`, under the OS temp dir, and under the
 * agent's own state dir (~/.gg) — sessions/plans/settings must keep working.
 */
export function resolveWriteGuard(
  cwd: string,
  resolvedPath: string,
  settings?: WriteGuardSettings,
): WriteGuardResult {
  if (settings?.allowOutsideWorkspaceWrites) return { allowed: true };

  const target = path.resolve(resolvedPath);
  const extraRoots = (settings?.additionalRoots ?? []).map((root) => path.resolve(root));
  for (const root of workspaceRootsFor(cwd, settings)) {
    if (isWithin(root, target)) return { allowed: true };
  }
  const workspaceRoots = [path.resolve(cwd), ...extraRoots].join(", ");
  return {
    allowed: false,
    reason:
      `Blocked: ${target} is outside the workspace (${workspaceRoots}). ` +
      "Writing outside the workspace requires user approval — ask the user to confirm, " +
      "or have them enable the allowOutsideWorkspaceWrites setting.",
  };
}

// ── Catastrophic command guard ─────────────────────────────

/** Strip simple quoting so `rm -rf "/"` and `rm -rf '/'` match too. */
function unquote(token: string): string {
  const trimmed = token.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Targets whose recursive force-removal is never acceptable without explicit
 *  user confirmation. `cwd` adds the workspace root itself. */
function isCatastrophicRemovalTarget(rawTarget: string, cwd: string): boolean {
  const target = unquote(rawTarget);
  if (target === "/" || target === "~" || target === "$HOME" || target === "${HOME}") return true;
  // Bare drive roots (Windows-style), e.g. C:\ or C:/
  if (/^[A-Za-z]:[\\/]?$/.test(target)) return true;
  // Home directory or workspace root by absolute/relative path.
  const home = os.homedir();
  const resolved = path.resolve(cwd, target.replace(/^~(?=\/|$)/, home));
  if (resolved === path.resolve(home)) return true;
  if (resolved === path.resolve(cwd)) return true;
  if (resolved === path.parse(resolved).root) return true;
  return false;
}

/**
 * Whether a recursive-force-removal target lies outside every workspace root.
 *
 * Conservative in both directions, because both mistakes are costly. A target
 * that cannot be resolved to a concrete path is treated as inside: an
 * unexpanded `$VAR` or a glob is not evidence of a disaster, and blocking
 * ordinary work would push users to disable the guard entirely. Anything that
 * does resolve is held to the same boundary the write guard enforces.
 */
function isOutsideWorkspace(
  rawTarget: string,
  cwd: string,
  settings?: WriteGuardSettings,
): boolean {
  if (settings?.allowOutsideWorkspaceWrites) return false;

  const target = unquote(rawTarget);
  if (!target) return false;
  // A shell variable or command substitution resolves at run time, not here.
  if (/[$`*?]/.test(target)) return false;

  const resolved = path.resolve(cwd, target.replace(/^~(?=\/|$)/, os.homedir()));
  const roots = [...workspaceRootsFor(cwd, settings), ...CONVENTIONAL_TEMP_ROOTS];
  return !roots.some((root) => isWithin(root, resolved));
}

/**
 * Temp locations `os.tmpdir()` does not report.
 *
 * On macOS `os.tmpdir()` is the per-user `/var/folders/...` path, so `/tmp`
 * — a real temp directory that scripts use constantly — looks like an
 * ordinary outside-the-workspace path. Without these, `rm -rf /tmp/scratch`
 * trips the guard, and a guard that fires on routine work is one the user
 * turns off.
 *
 * Deliberately *not* added to {@link workspaceRootsFor}: that would loosen the
 * write guard as a side effect, and quietly weakening an existing protection is
 * not this change's business. The removal guard being marginally more
 * permissive than the write guard errs toward false negatives, which is the
 * safe direction for a change whose whole purpose is closing a false negative.
 */
const CONVENTIONAL_TEMP_ROOTS = ["/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp"];

/**
 * Match only the unambiguous disasters:
 * - `rm -rf` (any flag spelling including -r -f, -fr, --recursive --force)
 *   targeting /, ~, $HOME, the workspace root, or a bare drive root
 * - Windows `rd /s /q C:\` (or `rmdir`)
 * - `git push --force --mirror` (mirror force-push rewrites every ref)
 *
 * Returns an error string telling the model to get explicit user confirmation,
 * or null when the command is not catastrophic.
 */
export function isCatastrophicCommand(
  command: string,
  cwd: string,
  settings?: WriteGuardSettings,
): string | null {
  const confirmNote =
    "This command is irreversible and destroys data far beyond the workspace. " +
    "Get explicit user confirmation first, then re-run it quoting the user's words " +
    "authorizing it.";

  /**
   * Why a removal outside the workspace is refused.
   *
   * `resolveWriteGuard` already refuses to *write* outside the workspace
   * without `allowOutsideWorkspaceWrites`, so a recursive force-remove of the
   * same path being allowed was an inconsistency rather than a policy: the
   * destructive operation was the permitted one. Deleting is not made safer by
   * arriving through `bash`.
   */
  const outsideNote =
    "Removing files outside the workspace requires user approval - ask the user to " +
    "confirm, or have them enable the allowOutsideWorkspaceWrites setting.";

  // rm with both recursive and force flags
  const rmMatch = /(?:^|[;&|]\s*)(?:sudo\s+)?rm\s+((?:-{1,2}[A-Za-z-]+\s+)+)(.+)/.exec(command);
  if (rmMatch) {
    const flags = rmMatch[1];
    const recursive = /(?:^|\s)-{1,2}(?:[a-zA-Z]*r[a-zA-Z]*|recursive)(?:\s|$)/.test(flags);
    const force = /(?:^|\s)-{1,2}(?:[a-zA-Z]*f[a-zA-Z]*|force)(?:\s|$)/.test(flags);
    if (recursive && force) {
      const targets = rmMatch[2].split(/\s+/).filter((t) => t.length > 0 && !t.startsWith("-"));
      for (const target of targets) {
        if (isCatastrophicRemovalTarget(target, cwd)) {
          return `Refusing to run: recursive force-remove of ${unquote(target)}. ${confirmNote}`;
        }
        if (isOutsideWorkspace(target, cwd, settings)) {
          return `Refusing to run: recursive force-remove of ${unquote(target)}, which is outside the workspace. ${outsideNote}`;
        }
      }
    }
  }

  // Windows: rd /s /q C:\  (or rmdir)
  const rdMatch = /(?:^|[;&|]\s*)(?:rd|rmdir)\s+((?:\/[sq]\s+)+)(.+)/i.exec(command);
  if (rdMatch && /\/s/i.test(rdMatch[1])) {
    const targets = rdMatch[2].split(/\s+/).filter((t) => t.length > 0 && !t.startsWith("/"));
    for (const target of targets) {
      if (isCatastrophicRemovalTarget(target, cwd)) {
        return `Refusing to run: recursive removal of ${unquote(target)}. ${confirmNote}`;
      }
    }
  }

  // git push --force --mirror (in either order; -f counts as --force)
  if (
    /(?:^|[;&|]\s*)git\s+push\b/.test(command) &&
    /\s--mirror\b/.test(command) &&
    /\s(?:--force\b|-f\b)/.test(command)
  ) {
    return `Refusing to run: mirror force-push rewrites every ref on the remote. ${confirmNote}`;
  }

  return null;
}
