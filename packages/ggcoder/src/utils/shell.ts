import fs from "node:fs";
import path from "node:path";

const isWindows = process.platform === "win32";

/**
 * Common Git Bash installation paths on Windows.
 * Checked in order; first existing path wins.
 */
const GIT_BASH_CANDIDATES = [
  path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
  path.join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Git",
    "bin",
    "bash.exe",
  ),
  "C:\\Git\\bin\\bash.exe",
];

/** Cached result so we only resolve once per process. */
let cachedShell: string | undefined;

/**
 * Resolve the shell to use for command execution.
 *
 * - **Unix/macOS**: uses $SHELL or falls back to `/bin/bash`.
 * - **Windows**: uses $GG_GIT_BASH_PATH if set, otherwise probes common
 *   Git for Windows install locations. Throws if Git Bash is not found.
 */
export function resolveShell(): string {
  if (cachedShell) return cachedShell;

  if (!isWindows) {
    cachedShell = process.env.SHELL ?? "/bin/bash";
    return cachedShell;
  }

  // Windows — check explicit override first
  const override = process.env.GG_GIT_BASH_PATH;
  if (override) {
    if (fs.existsSync(override)) {
      cachedShell = override;
      return cachedShell;
    }
    throw new Error(
      `GG_GIT_BASH_PATH is set to "${override}" but the file does not exist. ` +
        `Please verify your Git Bash installation path.`,
    );
  }

  // Probe standard locations
  for (const candidate of GIT_BASH_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      cachedShell = candidate;
      return cachedShell;
    }
  }

  throw new Error(
    `Git Bash not found. ogcoder requires Git for Windows to run on Windows.\n` +
      `Install it from https://gitforwindows.org/ or set GG_GIT_BASH_PATH to your bash.exe location.\n` +
      `Checked: ${GIT_BASH_CANDIDATES.join(", ")}`,
  );
}

export function getShellName(shellPath?: string): string {
  return path.basename(shellPath ?? resolveShell());
}
