import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * gg-boss auto-update — mirrors ggcoder's pattern (packages/ggcoder/src/core/
 * auto-update.ts) but pinned to @kenkaiiii/gg-boss and with its own state
 * file under ~/.gg/boss/ so it can't fight with ggcoder's checker.
 *
 * Two-phase strategy:
 *  - Phase 1 (instant, blocking): if a previous run found a newer version,
 *    spawn `npm i -g @kenkaiiii/gg-boss@latest` (or pnpm/yarn equivalent)
 *    in a detached child. Takes effect on the user's NEXT launch.
 *  - Phase 2 (async, non-blocking): hit the npm registry to compare versions
 *    so the next startup knows if there's anything to install. Throttled to
 *    once an hour per state-file timestamp.
 *
 * Plus a periodic in-session check so a user who never restarts still gets
 * notified when a new version drops.
 */

const PACKAGE_NAME = "@kenkaiiii/gg-boss";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 10_000;

interface UpdateState {
  lastCheckedAt: number;
  latestVersion?: string;
  updatePending?: boolean;
  lastUpdateAttempt?: number;
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
  return path.join(os.homedir(), ".gg", "boss", "update-state.json");
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
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(getStateFilePath(), JSON.stringify(state));
  } catch {
    // Non-fatal — we'll just retry next launch.
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
  // npx invocations are ephemeral — never auto-update.
  if (scriptPath.includes("/_npx/")) {
    return { packageManager: PackageManager.UNKNOWN, updateCommand: null };
  }
  if (scriptPath.includes("/.pnpm") || scriptPath.includes("/pnpm/global")) {
    return {
      packageManager: PackageManager.PNPM,
      updateCommand: `pnpm add -g ${PACKAGE_NAME}@latest`,
    };
  }
  if (scriptPath.includes("/.yarn/") || scriptPath.includes("/yarn/global")) {
    return {
      packageManager: PackageManager.YARN,
      updateCommand: `yarn global add ${PACKAGE_NAME}@latest`,
    };
  }
  return {
    packageManager: PackageManager.NPM,
    updateCommand: `npm install -g ${PACKAGE_NAME}@latest`,
  };
}

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
    // Non-fatal — the next launch will try again.
  }
}

/**
 * Called on CLI startup. If the previous run flagged a newer version, kicks
 * off `npm i -g` in the background and returns a one-line "installing…"
 * message for the caller to print. Always also schedules a fresh registry
 * check (rate-limited) so the next startup has up-to-date info.
 */
export function checkAndAutoUpdate(currentVersion: string): string | null {
  try {
    const state = readState();
    let message: string | null = null;

    // Phase 1: install if a previous check found something newer.
    if (state?.updatePending && state.latestVersion) {
      if (compareVersions(state.latestVersion, currentVersion) > 0) {
        const info = detectInstallInfo();
        if (info.updateCommand) {
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
        // Already on latest (user updated manually) — clear the pending flag.
        writeState({ ...state, updatePending: false });
      }
    }

    // Phase 2: schedule a fresh check, throttled.
    const shouldCheck = !state || Date.now() - state.lastCheckedAt > CHECK_INTERVAL_MS;
    if (shouldCheck) scheduleBackgroundCheck(currentVersion);

    return message;
  } catch {
    return null;
  }
}

/**
 * Synchronous TUI getter — reads the state file and returns the pending
 * update info (if any). Drives the "✨ Update ready" indicator in the
 * worker bar so users know to restart.
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
      // Non-fatal — we'll try again next launch.
    });
}

// ── In-session periodic check ──────────────────────────────

let periodicTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start a long-running session timer that pings npm hourly. If a newer
 * version is found, calls `onUpdate(message)` with a friendly notification
 * and stops further checks (no point pinging again — restart is needed).
 * The timer is unref'd so it doesn't keep the process alive on its own.
 */
export function startPeriodicUpdateCheck(
  currentVersion: string,
  onUpdate: (message: string) => void,
): void {
  if (periodicTimer) return;
  periodicTimer = setInterval(() => {
    fetchLatestVersion()
      .then((latestVersion) => {
        if (!latestVersion) return;
        if (compareVersions(latestVersion, currentVersion) <= 0) return;
        const info = detectInstallInfo();
        if (!info.updateCommand) return;
        writeState({
          lastCheckedAt: Date.now(),
          latestVersion,
          updatePending: true,
        });
        onUpdate(
          `Ken just pushed a fresh update — ${currentVersion} → ${latestVersion}! Restart ggboss to grab it (or run ${info.updateCommand} if you can't wait).`,
        );
        stopPeriodicUpdateCheck();
      })
      .catch(() => {
        // Non-fatal.
      });
  }, CHECK_INTERVAL_MS);
  periodicTimer.unref();
}

export function stopPeriodicUpdateCheck(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}
