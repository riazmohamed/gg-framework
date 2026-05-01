/**
 * Filler-word detection on word-timestamped transcripts.
 *
 * The single biggest creator-time-saver in long-form editing: scan the
 * transcript word-by-word, mark every "um" / "uh" / "like" / "you know"
 * range, then EMIT KEEP RANGES (the inverse). That keep list goes
 * straight into write_edl → import_edl → done.
 *
 * What counts as a "filler" is configurable. The defaults reflect the
 * canonical short list every YouTube auto-cutter (FireCut, Wisecut,
 * Descript) ships with. We also support multi-word phrases ("you know",
 * "i mean", "kind of") because the most distracting fillers are
 * two-word verbal tics.
 *
 * Pure logic only — no I/O. The tool wrapper handles transcript loading
 * and EDL emission.
 */

import type { Transcript } from "./whisper.js";

/** A contiguous range of words to remove. */
export interface FillerRange {
  startSec: number;
  endSec: number;
  /** The actual filler text (lowercase). Useful for surfacing to the user. */
  text: string;
  /** Word indices within the source segment (start inclusive, end exclusive). */
  startWordIndex: number;
  endWordIndex: number;
}

/** A range we keep (between or around fillers). */
export interface KeepRange {
  startSec: number;
  endSec: number;
}

/**
 * Default filler vocabulary. Single words and common multi-word verbal
 * tics. The matcher normalizes punctuation and case, so we list bare
 * surface forms.
 */
export const DEFAULT_FILLERS = [
  "um",
  "uh",
  "uhm",
  "umm",
  "uhh",
  "er",
  "ah",
  "hmm",
  "you know",
  "i mean",
  "kind of",
  "sort of",
  "like",
  "actually",
  "basically",
  "literally",
  "honestly",
  "right",
  "so",
] as const;

export interface DetectFillersOptions {
  /** Filler vocabulary; defaults to DEFAULT_FILLERS. Case-insensitive. */
  fillers?: readonly string[];
  /**
   * Pad the cut start by this many ms so the trailing audio of the
   * preceding word isn't clipped. Default 20ms.
   */
  paddingStartMs?: number;
  /**
   * Pad the cut end by this many ms so the leading audio of the next
   * word isn't clipped. Default 20ms.
   */
  paddingEndMs?: number;
  /**
   * Minimum gap between adjacent fillers below which we MERGE them into
   * a single cut (avoids producing 3-frame clips). Default 150ms.
   */
  mergeGapMs?: number;
  /**
   * Aggressive single words like "like" / "so" / "actually" / "right" /
   * "honestly" / "literally" / "basically" are filler ONLY when they
   * appear as standalone disfluencies. When `aggressiveSingleWords` is
   * false (default true), these are excluded from matching even if
   * present in `fillers`. Toggle on for ruthless cuts; off when the
   * speaker uses them substantively (a chef saying "literally" = real).
   */
  aggressiveSingleWords?: boolean;
}

const NON_AGGRESSIVE_SAFE_LIST = new Set([
  "um",
  "uh",
  "uhm",
  "umm",
  "uhh",
  "er",
  "ah",
  "hmm",
  "you know",
  "i mean",
  "kind of",
  "sort of",
]);

/**
 * Find filler-word ranges across the whole transcript. Requires
 * word-level timestamps (transcribe with wordTimestamps=true).
 *
 * Returns ranges in temporal order with no overlaps; adjacent ranges
 * within `mergeGapMs` are merged into a single cut.
 */
export function detectFillerRanges(
  transcript: Transcript,
  opts: DetectFillersOptions = {},
): FillerRange[] {
  const padStart = (opts.paddingStartMs ?? 20) / 1000;
  const padEnd = (opts.paddingEndMs ?? 20) / 1000;
  const mergeGap = (opts.mergeGapMs ?? 150) / 1000;
  const aggressive = opts.aggressiveSingleWords ?? true;

  const vocab = (opts.fillers ?? DEFAULT_FILLERS)
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f.length > 0)
    .filter((f) => aggressive || NON_AGGRESSIVE_SAFE_LIST.has(f));

  // Sort so multi-word phrases match before single-word ones at the same
  // position. Otherwise "you" + "know" gets matched as two single words.
  const sortedVocab = [...vocab].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);

  const out: FillerRange[] = [];

  for (const segment of transcript.segments) {
    const words = segment.words;
    if (!words || words.length === 0) continue;
    const normalized = words.map((w) => normalizeWord(w.text));

    let i = 0;
    while (i < words.length) {
      const match = findVocabMatch(sortedVocab, normalized, i);
      if (!match) {
        i++;
        continue;
      }
      const startWord = words[i];
      const endWord = words[i + match.length - 1];
      const startSec = Math.max(0, startWord.start - padStart);
      const endSec = endWord.end + padEnd;
      out.push({
        startSec,
        endSec,
        text: match.phrase,
        startWordIndex: i,
        endWordIndex: i + match.length,
      });
      i += match.length;
    }
  }

  return mergeOverlappingFillers(out, mergeGap);
}

/**
 * Compute KEEP ranges between fillers. The returned list is what you
 * pass into write_edl as a sequence of source-in / source-out pairs.
 *
 * Adjacent keep ranges with a tiny gap (< minKeepDurSec) get dropped —
 * a 40ms keep clip between two filler cuts is just noise.
 */
export function keepRangesFromFillers(
  fillers: FillerRange[],
  totalSec: number,
  minKeepDurSec = 0.05,
): KeepRange[] {
  if (totalSec <= 0) return [];
  const sorted = [...fillers].sort((a, b) => a.startSec - b.startSec);
  const keeps: KeepRange[] = [];
  let cursor = 0;

  for (const f of sorted) {
    if (f.startSec > cursor) {
      const start = cursor;
      const end = Math.min(totalSec, f.startSec);
      if (end - start >= minKeepDurSec) {
        keeps.push({ startSec: start, endSec: end });
      }
    }
    cursor = Math.max(cursor, Math.min(totalSec, f.endSec));
  }
  if (cursor < totalSec) {
    const dur = totalSec - cursor;
    if (dur >= minKeepDurSec) {
      keeps.push({ startSec: cursor, endSec: totalSec });
    }
  }
  return keeps;
}

/**
 * Frame-align keep ranges. Rounds INWARD (start ceils, end floors) so
 * cuts never extend into a filler.
 */
export function keepRangesToFrameRanges(
  keeps: KeepRange[],
  fps: number,
): Array<{ startFrame: number; endFrame: number }> {
  const out: Array<{ startFrame: number; endFrame: number }> = [];
  for (const k of keeps) {
    const sf = Math.ceil(k.startSec * fps);
    const ef = Math.floor(k.endSec * fps);
    if (ef > sf) out.push({ startFrame: sf, endFrame: ef });
  }
  return out;
}

// ── Internal ─────────────────────────────────────────────────

function normalizeWord(text: string): string {
  // Lowercase and strip non-letter trailing/leading punctuation.
  // We keep apostrophes inside words ("don't", "i'm").
  return text
    .toLowerCase()
    .trim()
    .replace(/^[^a-z']+/u, "")
    .replace(/[^a-z']+$/u, "");
}

interface VocabMatch {
  phrase: string;
  length: number;
}

function findVocabMatch(
  sortedVocab: string[],
  normalized: string[],
  startIndex: number,
): VocabMatch | undefined {
  for (const phrase of sortedVocab) {
    const parts = phrase.split(/\s+/);
    if (startIndex + parts.length > normalized.length) continue;
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      if (normalized[startIndex + j] !== parts[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return { phrase, length: parts.length };
  }
  return undefined;
}

function mergeOverlappingFillers(ranges: FillerRange[], mergeGap: number): FillerRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.startSec - b.startSec);
  const out: FillerRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur.startSec - prev.endSec <= mergeGap) {
      out[out.length - 1] = {
        startSec: prev.startSec,
        endSec: Math.max(prev.endSec, cur.endSec),
        text: `${prev.text} + ${cur.text}`,
        startWordIndex: prev.startWordIndex,
        endWordIndex: cur.endWordIndex,
      };
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Quick stats for the agent to surface to the user. "I removed 47
 * filler words totalling 8.3 seconds" is a much better summary than a
 * raw range list.
 */
export interface FillerStats {
  count: number;
  totalRemovedSec: number;
  /** Top-5 most frequent fillers, descending. */
  topFillers: Array<{ text: string; count: number }>;
}

export function summarizeFillers(fillers: FillerRange[]): FillerStats {
  const counts = new Map<string, number>();
  let totalRemovedSec = 0;
  for (const f of fillers) {
    totalRemovedSec += f.endSec - f.startSec;
    // For merged ranges the .text is "a + b" — we count each token.
    for (const piece of f.text.split(/\s*\+\s*/)) {
      counts.set(piece, (counts.get(piece) ?? 0) + 1);
    }
  }
  const topFillers = [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    count: fillers.length,
    totalRemovedSec: +totalRemovedSec.toFixed(3),
    topFillers,
  };
}
