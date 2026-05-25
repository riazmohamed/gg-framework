import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getAppPaths } from "@kenkaiiii/ggcoder";

/**
 * Boss debug log — mirrors ggcoder's logger pattern so the format is grep-
 * compatible across the framework. Lives at ~/.gg/boss/debug.log; rotates at
 * MAX_BYTES to keep disk usage bounded but preserves one rotation generation
 * (`debug.log.1`) so a session that's just been rotated still has its trailing
 * context recoverable.
 *
 * Each line format:
 *   [<iso-ts>] [sid=<8 hex>] [<LEVEL>] [<category>] <message> [k=v k=v …]
 *
 * Tail it live during a session:
 *   tail -f ~/.gg/boss/debug.log
 *
 * Filter to the current session:
 *   grep "sid=$(grep -oE 'sid=[a-f0-9]+' ~/.gg/boss/debug.log | tail -1 | cut -d= -f2)" ~/.gg/boss/debug.log
 */

type LogLevel = "INFO" | "ERROR" | "WARN" | "DEBUG";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

let fd: number | null = null;
let sessionId = "";

export function getLogPath(): string {
  return path.join(getAppPaths().agentDir, "boss", "debug.log");
}

function rotateIfNeeded(filePath: string): void {
  try {
    const st = fs.statSync(filePath);
    if (st.size < MAX_BYTES) return;
    const rotated = `${filePath}.1`;
    try {
      fs.unlinkSync(rotated);
    } catch {
      // No prior rotation, fine.
    }
    fs.renameSync(filePath, rotated);
  } catch {
    // File doesn't exist yet — nothing to rotate.
  }
}

/**
 * Open the log in append mode. Idempotent — re-calling is a no-op once the
 * fd is set. Generates a per-process session id so concurrent ggboss
 * processes (rare but possible) can be untangled with a single grep.
 */
export function initLogger(meta?: {
  version?: string;
  bossProvider?: string;
  bossModel?: string;
  bossThinking?: string;
  workerProvider?: string;
  workerModel?: string;
  projectCount?: number;
}): void {
  if (fd !== null) return;
  const filePath = getLogPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  } catch {
    // mkdir failure → can't log to this path, give up silently.
    return;
  }
  rotateIfNeeded(filePath);
  try {
    fd = fs.openSync(filePath, "a");
  } catch {
    return;
  }
  sessionId = randomBytes(4).toString("hex");
  try {
    fs.writeSync(fd, "\n");
  } catch {
    // Separator write failed; not fatal.
  }
  const parts = ["gg-boss"];
  if (meta?.version) parts[0] += ` v${meta.version}`;
  parts.push("started");
  if (meta?.bossProvider) parts.push(`boss=${meta.bossProvider}/${meta.bossModel ?? "?"}`);
  if (meta?.bossThinking) parts.push(`bossThinking=${meta.bossThinking}`);
  if (meta?.workerProvider) parts.push(`workers=${meta.workerProvider}/${meta.workerModel ?? "?"}`);
  if (meta?.projectCount !== undefined) parts.push(`projects=${meta.projectCount}`);
  parts.push(`pid=${process.pid}`);
  log("INFO", "startup", parts.join(" "));
}

export function getSessionId(): string {
  return sessionId;
}

export function log(
  level: LogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (fd === null) return;
  const ts = new Date().toISOString();
  let line = `[${ts}] [sid=${sessionId}] [${level}] [${category}] ${message}`;
  if (data) {
    const pairs = Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    if (pairs) line += ` ${pairs}`;
  }
  line += "\n";
  try {
    fs.writeSync(fd, line);
  } catch {
    // Write failed — drop the line rather than crash.
  }
}

/**
 * Best-effort flush + close. Called from the CLI's exit handler so the final
 * writes hit disk before the process tears down.
 */
export function closeLogger(): void {
  if (fd === null) return;
  try {
    fs.closeSync(fd);
  } catch {
    // Already closed or broken — nothing to do.
  }
  fd = null;
}
