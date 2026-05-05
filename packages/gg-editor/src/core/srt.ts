/**
 * SRT (SubRip) writer.
 *
 * Standard format:
 *   1
 *   00:00:01,000 --> 00:00:03,500
 *   Hello world.
 *
 *   2
 *   00:00:04,000 --> 00:00:06,000
 *   Second cue.
 *
 * Cue numbering is 1-indexed. Timestamps are HH:MM:SS,mmm with comma decimal.
 * CRLF line endings are NOT required by the spec — most parsers accept LF
 * (we emit LF for simplicity and cross-platform sanity).
 *
 * ── Precision policy ─────────────────────────────────────────
 * SRT's wire precision is exactly 1ms. We canonicalise every timestamp to a
 * non-negative INTEGER millisecond at the boundary of this module:
 *
 *   secondsToMs(s) = Math.max(0, Math.round(s * 1000))
 *
 * All downstream math (cue ordering, gap extension, end>start validation,
 * grouping) runs on those ms-ints. This eliminates two whole classes of
 * float-arithmetic bugs:
 *
 *   1. Cues whose float `end > start` but whose ms-rounded values collide
 *      (e.g. start=0.1001, end=0.1004 → both round to 100). The float check
 *      would pass, then we'd emit `00:00:00,100 --> 00:00:00,100` — invalid.
 *   2. Drift when extending a cue's end up to the next cue's start: float
 *      assignment can carry a 1e-15 epsilon that flips a Math.round at the
 *      ms boundary. Integer assignment is exact.
 *
 * Callers pass seconds (the natural unit for whisper / OpenAI output); the
 * conversion happens exactly once per timestamp, here. If you already have
 * ms-ints upstream, use `formatSrtTimeMs` directly to skip the round trip.
 */

export interface SrtCue {
  /** Start time in seconds. Internally rounded to ms-int. */
  start: number;
  /** End time in seconds. Must be > start AFTER ms-rounding (see policy above). */
  end: number;
  /** Caption text. Multi-line OK. Trimmed. */
  text: string;
}

/**
 * A word with its own timing. Used by `buildWordLevelSrt` to emit one cue per
 * word (TikTok / Reels burned-caption style).
 */
export interface WordCue {
  start: number;
  end: number;
  text: string;
}

/**
 * Word-level SRT — one cue per word. Useful for vertical-format burned-in
 * captions where each word pops as it's spoken.
 *
 * Behaviour:
 *   - Skips empty / zero-duration words (post-rounding, so 0.1001s/0.1004s
 *     pairs that collapse to the same ms are dropped instead of producing
 *     invalid same-stamp cues).
 *   - Optional `groupSize` clusters N consecutive words into one cue (e.g. 2-3
 *     words at a time for a more readable rhythm). Default 1.
 *   - Optional `gapSec` extends a cue's end up to the next cue's start so the
 *     caption stays on screen until the next word appears (closed-caption look).
 */
export function buildWordLevelSrt(
  words: WordCue[],
  opts: { groupSize?: number; gapSec?: number } = {},
): string {
  const groupSize = Math.max(1, Math.floor(opts.groupSize ?? 1));

  // Convert to ms-int up-front. Filter cues that don't survive rounding —
  // empty text or end <= start in ms-space.
  type IntCue = { startMs: number; endMs: number; text: string };
  const filled: IntCue[] = [];
  for (const w of words) {
    const text = (w.text ?? "").trim();
    if (!text) continue;
    const startMs = secondsToMs(w.start);
    const endMs = secondsToMs(w.end);
    if (endMs <= startMs) continue;
    filled.push({ startMs, endMs, text });
  }

  const cues: IntCue[] = [];
  for (let i = 0; i < filled.length; i += groupSize) {
    const group = filled.slice(i, i + groupSize);
    cues.push({
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
      text: group.map((g) => g.text).join(" "),
    });
  }

  if (opts.gapSec !== undefined && opts.gapSec >= 0) {
    const gapMs = secondsToMs(opts.gapSec);
    for (let i = 0; i < cues.length - 1; i += 1) {
      const gap = cues[i + 1].startMs - cues[i].endMs;
      if (gap > 0 && gap <= gapMs) {
        // Integer assignment — no float epsilon to lose.
        cues[i].endMs = cues[i + 1].startMs;
      }
    }
  }

  return buildFromIntCues(cues);
}

/**
 * Build an SRT string from cues. Cues are emitted in input order. Throws on
 * cues that collapse to zero or negative duration AFTER ms-rounding —
 * upstream code is expected to handle that ahead of time.
 */
export function buildSrt(cues: SrtCue[]): string {
  const intCues = cues.map((c) => ({
    startMs: secondsToMs(c.start),
    endMs: secondsToMs(c.end),
    text: (c.text ?? "").trim(),
  }));
  // Validate each non-empty cue; matches the previous public contract of
  // throwing when end <= start, but now in ms-int space so the error message
  // reflects what would actually have been emitted.
  let ordinal = 0;
  for (const c of intCues) {
    if (!c.text) continue;
    ordinal += 1;
    if (c.endMs <= c.startMs) {
      throw new Error(
        `cue ${ordinal}: end (${msToSrtTime(c.endMs)}) must be > start (${msToSrtTime(c.startMs)})`,
      );
    }
  }
  return buildFromIntCues(intCues);
}

/** Internal: skip empty-text cues, format the rest. */
function buildFromIntCues(cues: { startMs: number; endMs: number; text: string }[]): string {
  const out: string[] = [];
  let n = 0;
  for (const cue of cues) {
    if (!cue.text) continue;
    if (cue.endMs <= cue.startMs) continue; // Defensive — public callers also validate.
    n += 1;
    out.push(String(n));
    out.push(`${msToSrtTime(cue.startMs)} --> ${msToSrtTime(cue.endMs)}`);
    out.push(cue.text);
    out.push("");
  }
  return out.join("\n");
}

/** Format seconds → "HH:MM:SS,mmm" (SRT timestamp). Single rounding step. */
export function formatSrtTime(seconds: number): string {
  return msToSrtTime(secondsToMs(seconds));
}

/**
 * Format ms-int → "HH:MM:SS,mmm". Use this when you already have ms-int
 * timing (e.g. straight off whisper.cpp's `offsets.from`) to avoid an
 * unnecessary round-trip through float seconds.
 */
export function msToSrtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  ms = Math.round(ms); // Defensive — callers should pass integers.
  const milli = ms % 1000;
  const totalSec = Math.floor(ms / 1000);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  return (
    pad2(hh) + ":" + pad2(mm) + ":" + pad2(ss) + "," + String(milli).padStart(3, "0")
  );
}

/**
 * Convert float seconds → integer milliseconds with the same rounding rule
 * used everywhere in this module. Negative inputs and NaN clamp to 0.
 */
export function secondsToMs(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.round(seconds * 1000);
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}
