import { realpathSync } from "node:fs";
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
 * Resolve a path through symlinks, tolerating one that does not exist yet.
 *
 * `path.resolve` is pure string arithmetic: it collapses `..` but knows nothing
 * about links, so `<repo>/link/x` stays textually "inside the repo" even when
 * `link` points at the home directory. A repo we clone or open is untrusted
 * content, and a committed symlink is a normal thing for it to carry — so a
 * textual containment check hands any such repo a write primitive anywhere the
 * user can write (`~/.ssh/authorized_keys`, `~/.zshrc`), with no prompt.
 *
 * Writes usually target a file that does not exist yet, so `realpathSync` on
 * the full path would throw. Walk up to the nearest ancestor that DOES exist,
 * resolve that, then re-attach the remaining segments: the existing part is
 * where a planted link would have to live, and the non-existent tail cannot be
 * pointing anywhere yet.
 *
 * simplification: this is a check-then-write, so a link swapped in between the
 * two would still win (TOCTOU). Closing that needs the write itself to be
 * link-safe (`O_NOFOLLOW`), which Node does not expose on `writeFile`. The
 * planted-symlink case this blocks does not require the race; the racing one
 * needs code already executing locally.
 */
function realResolve(target: string): string {
  let current = path.resolve(target);
  const trailing: string[] = [];
  for (;;) {
    try {
      return path.resolve(realpathSync(current), ...trailing);
    } catch {
      const parent = path.dirname(current);
      // Hit the filesystem root without finding anything that exists: there is
      // no link on this path to resolve, so the textual form is already final.
      if (parent === current) return path.resolve(target);
      trailing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Every root the agent may write within.
 *
 * Shared by the write guard and the removal guard below, so the two cannot
 * drift into disagreeing about what "inside the workspace" means — which is
 * exactly how `write ~/notes.md` came to be blocked while `rm -rf ~/notes`
 * was not. Roots go through {@link realResolve} for the same reason targets
 * do: a symlinked root must compare as its real location.
 */
function workspaceRootsFor(cwd: string, settings?: WriteGuardSettings): string[] {
  return [
    realResolve(cwd),
    ...(settings?.additionalRoots ?? []).map((root) => realResolve(root)),
    realResolve(os.tmpdir()),
    realResolve(getAppPaths().agentDir),
  ];
}

/**
 * Decide whether a resolved write/edit target path is allowed.
 * Allowed by default: under `cwd`, under the OS temp dir, and under the
 * agent's own state dir (~/.gg) — sessions/plans/settings must keep working.
 *
 * Both sides are compared AFTER symlink resolution (see {@link realResolve}):
 * the target, so a link inside the workspace cannot point out of it, and the
 * roots, because the OS aliases its own (macOS `/tmp` → `/private/tmp`, and
 * `/var/folders` under it) and comparing a resolved target against an
 * unresolved root would deny every legitimate temp-dir write.
 */
export function resolveWriteGuard(
  cwd: string,
  resolvedPath: string,
  settings?: WriteGuardSettings,
): WriteGuardResult {
  if (settings?.allowOutsideWorkspaceWrites) return { allowed: true };

  const target = realResolve(resolvedPath);
  const extraRoots = (settings?.additionalRoots ?? []).map((root) => realResolve(root));
  for (const root of workspaceRootsFor(cwd, settings)) {
    if (isWithin(root, target)) return { allowed: true };
  }
  const workspaceRoots = [realResolve(cwd), ...extraRoots].join(", ");
  // Name the redirection when there is one: "foo/link/x is outside the
  // workspace" reads like a bug when the path visibly starts at the workspace.
  const literal = path.resolve(resolvedPath);
  const via = literal === target ? "" : ` (${literal} resolves there through a symlink)`;
  return {
    allowed: false,
    reason:
      `Blocked: ${target} is outside the workspace (${workspaceRoots})${via}. ` +
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

  // Resolved through symlinks on both sides, exactly as the write guard does:
  // the roots come back real (macOS aliases its own temp dir), so a textually
  // resolved target would fail to match any of them.
  const resolved = realResolve(path.resolve(cwd, target.replace(/^~(?=\/|$)/, os.homedir())));
  const roots = [
    ...workspaceRootsFor(cwd, settings),
    ...CONVENTIONAL_TEMP_ROOTS.map((root) => realResolve(root)),
  ];
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
