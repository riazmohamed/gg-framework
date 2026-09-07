import { spawnSync } from "node:child_process";
import path from "node:path";

export interface ProcessTreeKillOptions {
  platform?: NodeJS.Platform;
  kill?: typeof process.kill;
  spawnSync?: typeof spawnSync;
  env?: NodeJS.ProcessEnv;
  taskkillTimeoutMs?: number;
}

const DEFAULT_TASKKILL_TIMEOUT_MS = 5_000;

function getEnvCaseInsensitive(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return Object.entries(env).find(([key]) => key.toLowerCase() === wanted)?.[1];
}

/**
 * Absolute path to `taskkill.exe`.
 *
 * Bare `"taskkill"` depends on `System32` being on PATH — not guaranteed for a
 * GUI-launched app whose PATH we also mutate — and is spoofable by a
 * `taskkill.exe` sitting in the project cwd. Resolve it from `SystemRoot`
 * (falling back to `WINDIR`, then `C:\Windows`), rejecting anything that isn't
 * a plain drive-rooted path.
 */
export function resolveWindowsTaskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  const normalize = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const root = value.trim();
    const unsafe = [...root].some((ch) => ch === ";" || ch.charCodeAt(0) <= 31);
    if (!/^[A-Za-z]:[\\/]/.test(root) || unsafe) return undefined;
    return path.win32.normalize(root);
  };
  const systemRoot =
    normalize(getEnvCaseInsensitive(env, "SystemRoot")) ??
    normalize(getEnvCaseInsensitive(env, "WINDIR")) ??
    "C:\\Windows";
  return path.win32.join(systemRoot, "System32", "taskkill.exe");
}

/**
 * Kill a process and every descendant.
 *
 * POSIX: SIGKILL the process group (negative pid), falling back to the single
 * pid. Windows has no process groups and negative pids are invalid there — the
 * POSIX path silently left the whole child tree running, so a timed-out or
 * cancelled `bash` command kept its `npm`/`node`/`pnpm` descendants alive
 * forever. Use `taskkill /T /F` instead, falling back to the direct pid.
 */
export function killProcessTree(pid: number, options: ProcessTreeKillOptions = {}): void {
  const platform = options.platform ?? process.platform;
  const kill = options.kill ?? process.kill;

  if (platform !== "win32") {
    try {
      kill(-pid, "SIGKILL");
      return;
    } catch {
      killSingleProcess(pid, kill);
      return;
    }
  }

  const executable = resolveWindowsTaskkillPath(options.env);
  try {
    const result = (options.spawnSync ?? spawnSync)(executable, ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: options.taskkillTimeoutMs ?? DEFAULT_TASKKILL_TIMEOUT_MS,
    });
    if (result.status === 0 && result.error === undefined) return;
  } catch {
    // Fall through to the direct-pid fallback below.
  }
  killSingleProcess(pid, kill);
}

function killSingleProcess(pid: number, kill: typeof process.kill): void {
  try {
    kill(pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

/**
 * Ask a process tree to exit gracefully.
 *
 * POSIX: SIGTERM the process group (negative pid), falling back to the single
 * pid. Windows has no process groups, so use `taskkill /T` *without* `/F` —
 * that posts WM_CLOSE / Ctrl-Break to the tree instead of hard-killing it,
 * giving the child a chance to flush and run its own cleanup.
 *
 * Returns `false` when the process is already gone, so callers can report
 * "already exited" instead of pretending they stopped something.
 */
export function terminateProcessTree(pid: number, options: ProcessTreeKillOptions = {}): boolean {
  const platform = options.platform ?? process.platform;
  const kill = options.kill ?? process.kill;

  if (platform === "win32") {
    try {
      const result = (options.spawnSync ?? spawnSync)(
        resolveWindowsTaskkillPath(options.env),
        ["/PID", String(pid), "/T"],
        {
          stdio: "ignore",
          windowsHide: true,
          timeout: options.taskkillTimeoutMs ?? DEFAULT_TASKKILL_TIMEOUT_MS,
        },
      );
      return result.status === 0 && result.error === undefined;
    } catch {
      return false;
    }
  }

  try {
    kill(-pid, "SIGTERM");
    return true;
  } catch {
    try {
      kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}
