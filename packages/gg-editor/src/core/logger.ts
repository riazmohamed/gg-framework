/**
 * gg-editor debug logger — optimized for LLM consumption.
 *
 * Writes to `~/.gg/ggeditor.log`. Append mode across sessions, rotated at
 * MAX_BYTES, one generation kept (`ggeditor.log.1`).
 *
 * Format choices (every byte fed to an LLM matters):
 *   - Per-session HEADER carries the rarely-changing fields (date, sid,
 *     version, provider, model, pid, platform). Lines below reference them
 *     implicitly so we don't repeat ~80 bytes on every line.
 *   - Each line: `HH:MM:SS.mmm L cat msg k=v k=v`
 *       L  — single-letter level (I/W/E). Saves 3-4 bytes/line vs. INFO/WARN/ERROR.
 *       cat — short stable category (tool, bridge, bridge.call, host, …).
 *       msg — short imperative phrase, no decorative arrows.
 *   - Field values JSON-encoded only when they need quoting; bare otherwise.
 *   - Args/results truncated at MAX_FIELD_CHARS with `…(+N)` overflow marker
 *     so the LLM sees the prefix + how much was elided.
 *
 * Categories:
 *   startup       CLI launch line + capability probe result
 *   bridge        Resolve Python bridge spawn/handshake/exit
 *   bridge.call   Per-method round trips (one line per call: name + dur + ok/err)
 *   tool          Agent tool calls (one line per call: name + dur + args + result)
 *   host          Lazy host detection transitions
 *   shutdown      Clean exit
 *   fatal         Unhandled errors
 *
 * Filter a single run: `grep " sid=<id>" ~/.gg/ggeditor.log` once you've
 * read the header. Multi-run greps key off the category column.
 */
import fs from "node:fs";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

type LogLevel = "I" | "W" | "E";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FIELD_CHARS = 200; // Per k=v value cap. Args/results truncated above this.

let fd: number | null = null;
let sessionId = "";

/** Default path: `~/.gg/ggeditor.log`. */
export function defaultLogPath(): string {
  return join(homedir(), ".gg", "ggeditor.log");
}

function rotateIfNeeded(filePath: string): void {
  try {
    const st = fs.statSync(filePath);
    if (st.size < MAX_BYTES) return;
    const rotated = `${filePath}.1`;
    try {
      fs.unlinkSync(rotated);
    } catch {
      // No prior rotation
    }
    fs.renameSync(filePath, rotated);
  } catch {
    // Log file doesn't exist yet
  }
}

/** Pad to 2/3 chars with leading zeros for stable column widths. */
function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

function timestamp(): string {
  const d = new Date();
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Initialize logger. Idempotent. Writes a session HEADER line with the
 * fields that don't change across the run, so per-line overhead stays low.
 */
export function initLogger(
  filePath: string = defaultLogPath(),
  meta?: { version?: string; provider?: string; model?: string; host?: string },
): void {
  if (fd !== null) return;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // openSync below will surface real failures
  }
  rotateIfNeeded(filePath);
  try {
    fd = fs.openSync(filePath, "a");
  } catch {
    return;
  }
  sessionId = randomBytes(4).toString("hex");
  // Session header — all per-run constants in one line. Bash/awk friendly,
  // human-readable, LLM-parseable. Subsequent lines don't repeat any of this.
  const headerParts = [
    `=== ${new Date().toISOString()}`,
    `sid=${sessionId}`,
    `ggeditor=${meta?.version ?? "?"}`,
  ];
  if (meta?.provider) headerParts.push(`provider=${meta.provider}`);
  if (meta?.model) headerParts.push(`model=${meta.model}`);
  if (meta?.host) headerParts.push(`host=${meta.host}`);
  headerParts.push(`pid=${process.pid}`, `platform=${process.platform}`, "===");
  try {
    fs.writeSync(fd, "\n" + headerParts.join(" ") + "\n");
  } catch {
    // Header write failed — proceed; subsequent lines may still land
  }
}

/** Session ID — useful for filtering one run out of an interleaved log. */
export function getSessionId(): string {
  return sessionId;
}

/** Hot-path skip flag for callers that want to avoid building log payloads. */
export function isLoggerActive(): boolean {
  return fd !== null;
}

/**
 * Write a log line. Format: `HH:MM:SS.mmm L cat msg k=v k=v`.
 *
 * Values that contain spaces or `=` are JSON-quoted; bare otherwise. Long
 * fields are truncated at MAX_FIELD_CHARS with `…(+N)` so the LLM sees the
 * prefix plus a count of elided chars (rather than a silent cliff).
 */
export function log(
  level: LogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (fd === null) return;
  let line = `${timestamp()} ${level} ${category} ${message}`;
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || v === null) continue;
      line += ` ${k}=${formatValue(v)}`;
    }
  }
  line += "\n";
  try {
    fs.writeSync(fd, line);
  } catch {
    // Don't crash the CLI on a write failure
  }
}

function formatValue(v: unknown): string {
  let s: string;
  if (typeof v === "string") {
    s = v;
  } else if (typeof v === "number" || typeof v === "boolean") {
    return String(v); // numerics/booleans never need quoting and never overflow
  } else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  if (s.length > MAX_FIELD_CHARS) {
    s = s.slice(0, MAX_FIELD_CHARS) + `…(+${s.length - MAX_FIELD_CHARS})`;
  }
  // Quote when the value has whitespace, `=`, or quotes — so grep/awk on
  // ` k=` boundaries works reliably. Bare otherwise (saves 2 bytes).
  if (/[\s="]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

export const logInfo = (cat: string, msg: string, data?: Record<string, unknown>) =>
  log("I", cat, msg, data);
export const logWarn = (cat: string, msg: string, data?: Record<string, unknown>) =>
  log("W", cat, msg, data);
export const logError = (cat: string, msg: string, data?: Record<string, unknown>) =>
  log("E", cat, msg, data);

/** Close the log fd. Safe to call multiple times. */
export function closeLogger(): void {
  if (fd === null) return;
  log("I", "shutdown", "exit");
  try {
    fs.closeSync(fd);
  } catch {
    // Ignore
  }
  fd = null;
}
