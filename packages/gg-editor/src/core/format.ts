/**
 * Output formatters — all tool results pass through here.
 *
 * Design rule: tool output is consumed by an LLM, never a human directly.
 * Optimize for token economy and machine parsability:
 *   - No prose filler ("I successfully did X").
 *   - No labels the LLM can already infer from the call it just made.
 *   - JSON when fields > 1; bare value when result is a single fact.
 *   - Errors: "error: <cause>; fix: <next-step>" — one line, actionable.
 *   - Cap unbounded lists with a summary header.
 */

/** Render a value as compact JSON (no whitespace). Drops null/undefined keys. */
export function compact(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v === null || v === undefined ? undefined : v));
}

/** Standard one-line error format. */
export function err(cause: string, fix?: string): string {
  return fix ? `error: ${cause}; fix: ${fix}` : `error: ${cause}`;
}

/**
 * Frames → SMPTE timecode (HH:MM:SS:FF). Used for EDL emission.
 * Non-drop frame; agent is responsible for fps choice.
 */
export function framesToTimecode(frames: number, fps: number): string {
  if (frames < 0) frames = 0;
  const ifps = Math.round(fps); // EDL uses integer fps; 23.976 → 24, 29.97 → 30
  const totalSec = Math.floor(frames / ifps);
  const ff = frames % ifps;
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return [hh, mm, ss, ff].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Truncate a list with a summary header when it exceeds `keep`. Always shows
 * the first and last `keep/2` items so the LLM sees both endpoints.
 *
 *   summarizeList([1,2,…,200], 10) →
 *     { head: [1..5], tail: [196..200], total: 200, omitted: 190 }
 */
export function summarizeList<T>(
  items: T[],
  keep = 20,
): {
  head: T[];
  tail: T[];
  total: number;
  omitted: number;
} {
  if (items.length <= keep) return { head: items, tail: [], total: items.length, omitted: 0 };
  const half = Math.floor(keep / 2);
  return {
    head: items.slice(0, half),
    tail: items.slice(-half),
    total: items.length,
    omitted: items.length - half * 2,
  };
}

/** Cap a string at `max` chars with a single-char ellipsis suffix. */
export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
