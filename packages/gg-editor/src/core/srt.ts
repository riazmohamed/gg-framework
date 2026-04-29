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
 * Input is a list of cues with seconds-precision start/end. Empty `text`
 * cues are skipped (an empty cue is invalid SRT).
 */

export interface SrtCue {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. Must be > start. */
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
 *   - Skips empty / zero-duration words.
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
  const filled = words.filter((w) => (w.text ?? "").trim() && w.end > w.start);
  const cues: SrtCue[] = [];
  for (let i = 0; i < filled.length; i += groupSize) {
    const group = filled.slice(i, i + groupSize);
    cues.push({
      start: group[0].start,
      end: group[group.length - 1].end,
      text: group.map((g) => g.text.trim()).join(" "),
    });
  }
  if (opts.gapSec !== undefined && opts.gapSec >= 0) {
    for (let i = 0; i < cues.length - 1; i += 1) {
      const gap = cues[i + 1].start - cues[i].end;
      if (gap > 0 && gap <= opts.gapSec) {
        cues[i].end = cues[i + 1].start;
      }
    }
  }
  return buildSrt(cues);
}

/** Build an SRT string from cues. Cues are emitted in input order. */
export function buildSrt(cues: SrtCue[]): string {
  const out: string[] = [];
  let n = 0;
  for (const cue of cues) {
    const text = (cue.text ?? "").trim();
    if (!text) continue;
    if (cue.end <= cue.start) {
      throw new Error(`cue ${n + 1}: end (${cue.end}) must be > start (${cue.start})`);
    }
    n += 1;
    out.push(String(n));
    out.push(`${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`);
    out.push(text);
    out.push("");
  }
  return out.join("\n");
}

/** Format seconds → "HH:MM:SS,mmm" (SRT timestamp). */
export function formatSrtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  return (
    String(hh).padStart(2, "0") +
    ":" +
    String(mm).padStart(2, "0") +
    ":" +
    String(ss).padStart(2, "0") +
    "," +
    String(ms).padStart(3, "0")
  );
}
