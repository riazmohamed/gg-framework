import { execFileSync } from "node:child_process";

const isWindows = process.platform === "win32";

/**
 * Kill a process and all its children.
 *
 * - **Unix**: sends SIGKILL to the process group (negative pid).
 * - **Windows**: uses `taskkill /F /T /PID` which kills the entire process tree.
 *
 * Falls back to killing just the process if group/tree kill fails.
 */
export function killProcessTree(pid: number): void {
  if (isWindows) {
    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
    } catch {
      // Process already exited
    }
    return;
  }

  try {
    // Kill the entire process group (negative pid)
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited
    }
  }
}

/**
 * Send SIGTERM to a process group (Unix) or taskkill without /F (Windows).
 * Returns false if the process was not found.
 */
export function terminateProcessTree(pid: number): boolean {
  if (isWindows) {
    try {
      execFileSync("taskkill", ["/T", "/PID", String(pid)], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  try {
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}
