import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PACKAGE_NAME = "@abukhaled/ogcoder";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CHECK_INTERVAL_MS = 1 * 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 10_000; // 10s — npm can be slow

interface UpdateState {
  lastCheckedAt: number;
  latestVersion?: string;
  updatePending?: boolean;
  lastUpdateAttempt?: number;
  updateFailed?: boolean;
}

enum PackageManager {
  NPM = "npm",
  PNPM = "pnpm",
  YARN = "yarn",
  UNKNOWN = "unknown",
}

interface InstallInfo {
  packageManager: PackageManager;
  updateCommand: string | null;
}

function getStateFilePath(): string {
  return path.join(os.homedir(), ".gg", "update-state.json");
}

function readState(): UpdateState | null {
  try {
    const raw = fs.readFileSync(getStateFilePath(), "utf-8");
    return JSON.parse(raw) as UpdateState;
  } catch {
    return null;
  }
}

function writeState(state: UpdateState): void {
  try {
    const dir = path.dirname(getStateFilePath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getStateFilePath(), JSON.stringify(state));
  } catch {
    // Non-fatal
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function detectInstallInfo(): InstallInfo {
  const scriptPath = (process.argv[1] ?? "").replace(/\\/g, "/");

  // npx — skip (ephemeral)
  if (scriptPath.includes("/_npx/")) {
    return { packageManager: PackageManager.UNKNOWN, updateCommand: null };
  }

  // pnpm global
  if (scriptPath.includes("/.pnpm") || scriptPath.includes("/pnpm/global")) {
    return {
      packageManager: PackageManager.PNPM,
      updateCommand: `pnpm add -g ${PACKAGE_NAME}@latest`,
    };
  }

  // yarn global
  if (scriptPath.includes("/.yarn/") || scriptPath.includes("/yarn/global")) {
    return {
      packageManager: PackageManager.YARN,
      updateCommand: `yarn global add ${PACKAGE_NAME}@latest`,
    };
  }

  // npm global (default)
  return {
    packageManager: PackageManager.NPM,
    updateCommand: `npm install -g ${PACKAGE_NAME}@latest`,
  };
}

/**
 * Fetch latest version from npm registry asynchronously.
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);
    const data = (await response.json()) as { version?: string };
    const version = data.version?.trim();
    return version && /^\d+\.\d+\.\d+/.test(version) ? version : null;
  } catch {
    return null;
  }
}

/**
 * Perform the update in a detached background process so it doesn't block
 * or interfere with the current CLI session. The update takes effect on
 * the next launch.
 */
function performUpdateInBackground(command: string): void {
  try {
    const parts = command.split(" ");
    const child = spawn(parts[0]!, parts.slice(1), {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, npm_config_loglevel: "silent" },
    });
    child.unref();
  } catch {
    // Non-fatal — will retry next startup
  }
}

/**
 * Check for updates at CLI startup. Two-phase approach:
 *
 * Phase 1 (instant): If a previous background check found a newer version,
 *   kick off a background update now. Non-blocking.
 *
 * Phase 2 (async): Fire off a background version check for the *next* startup.
 *
 * Returns a message to display, or null.
 */
export async function checkAndAutoUpdate(currentVersion: string): Promise<string | null> {
  try {
    const state = readState();
    let message: string | null = null;

    // Phase 1: Apply pending update from previous check
    if (state?.updatePending && state.latestVersion) {
      if (compareVersions(state.latestVersion, currentVersion) > 0) {
        const info = detectInstallInfo();
        if (info.updateCommand) {
          // Run update in background — takes effect next launch
          performUpdateInBackground(info.updateCommand);
          message = `Ken just shipped ${state.latestVersion}! Installing in the background — takes effect next launch.`;

          writeState({
            ...state,
            lastCheckedAt: Date.now(),
            updatePending: false,
            lastUpdateAttempt: Date.now(),
          });
        }
      } else {
        // Already on latest (user may have updated manually)
        writeState({ ...state, updatePending: false });
      }
    }

    // Phase 2: Schedule background check for next startup
    const shouldCheck = !state || Date.now() - state.lastCheckedAt > CHECK_INTERVAL_MS;
    if (shouldCheck) {
      scheduleBackgroundCheck(currentVersion);
    }

    return message;
  } catch {
    return null;
  }
}

/**
 * Read the current state file and report whether a newer version has been
 * downloaded / is pending install. Used by the TUI to show a persistent
 * "update ready" indicator in the status row.
 */
export function getPendingUpdate(currentVersion: string): { latestVersion: string } | null {
  try {
    const state = readState();
    if (!state?.latestVersion) return null;
    if (compareVersions(state.latestVersion, currentVersion) <= 0) return null;
    return { latestVersion: state.latestVersion };
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget async version check. Updates the state file so the
 * next startup knows whether an update is available.
 */
function scheduleBackgroundCheck(currentVersion: string): void {
  fetchLatestVersion()
    .then((latestVersion) => {
      const newState: UpdateState = {
        lastCheckedAt: Date.now(),
        latestVersion: latestVersion ?? undefined,
        updatePending: false,
      };

      if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
        newState.updatePending = true;
      }

      writeState(newState);
    })
    .catch(() => {
      // Non-fatal — will retry next time
    });
}

// ── In-session periodic check ──────────────────────────────────────────

let periodicTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic update checks during a long-running session.
 * Checks every hour. If an update is found, calls `onUpdate` with a message.
 */
export function startPeriodicUpdateCheck(
  currentVersion: string,
  onUpdate: (message: string) => void,
): void {
  if (periodicTimer) return; // Already running

  periodicTimer = setInterval(() => {
    fetchLatestVersion()
      .then((latestVersion) => {
        if (!latestVersion) return;
        if (compareVersions(latestVersion, currentVersion) <= 0) return;

        const info = detectInstallInfo();
        if (!info.updateCommand) return;

        // Mark pending for next startup
        writeState({
          lastCheckedAt: Date.now(),
          latestVersion,
          updatePending: true,
        });

        onUpdate(
          `Ken just pushed a fresh update — ${currentVersion} → ${latestVersion}! I'll grab it on next launch (or run ${info.updateCommand} if you can't wait).`,
        );

        // Stop checking once we've notified
        stopPeriodicUpdateCheck();
      })
      .catch(() => {
        // Non-fatal
      });
  }, CHECK_INTERVAL_MS);

  // Don't keep the process alive just for update checks
  periodicTimer.unref();
}

/**
 * Stop periodic update checks.
 */
export function stopPeriodicUpdateCheck(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}
