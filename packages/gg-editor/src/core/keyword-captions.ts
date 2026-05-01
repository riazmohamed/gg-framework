/**
 * Keyword-highlighted captions — the CapCut "active word" style that
 * defines viral short-form aesthetics in 2025-2026.
 *
 * Plain word-by-word burned captions show every word in the same
 * style. Keyword highlighting picks the 1-2 most content-bearing words
 * per phrase and renders them in a stronger color / scale, so the eye
 * locks onto the meaning even when the viewer is half-scrolling.
 *
 * No POS tagger needed — a small heuristic gets us 90% of the way:
 *   - Numbers and ALL-CAPS tokens are always keywords.
 *   - Words ≥ minKeywordLen and NOT in the stoplist are keywords.
 *   - Words in the stoplist (articles / prepositions / fillers) are
 *     never keywords.
 *   - We cap to N keywords per phrase to keep emphasis meaningful.
 *
 * Output: AssCue list with two styles ("Default" + "Keyword"). The
 * caller passes them straight into buildAss(); ffmpeg's `subtitles`
 * filter renders the result.
 */

import type { AssCue, AssStyle } from "./ass.js";
import type { TranscriptWord } from "./whisper.js";

export interface KeywordCaptionOptions {
  /** Words per cue. Default 3 — readable at fast speech rates. */
  groupSize?: number;
  /** Min gap (sec) at which we force a new cue. Default 0.4. */
  gapSec?: number;
  /** Min letters to consider a word a keyword by length. Default 5. */
  minKeywordLen?: number;
  /** Max keywords per cue. Default 1. Clamped to ≥0. */
  maxKeywordsPerCue?: number;
  /** Stoplist override (case-insensitive). Defaults to DEFAULT_STOPLIST. */
  stoplist?: readonly string[];
  /**
   * Per-cue display duration cushion (sec) — extends each cue's end
   * past the last word's end so the caption doesn't pop off mid-syllable.
   * Default 0.08s.
   */
  endPaddingSec?: number;
}

/**
 * The function-words / discourse markers we strip from keyword
 * candidates. Lowercase, no punctuation.
 */
export const DEFAULT_STOPLIST = [
  // articles
  "a",
  "an",
  "the",
  // pronouns
  "i",
  "me",
  "my",
  "mine",
  "you",
  "your",
  "yours",
  "he",
  "him",
  "his",
  "she",
  "her",
  "hers",
  "it",
  "its",
  "we",
  "us",
  "our",
  "ours",
  "they",
  "them",
  "their",
  "theirs",
  "this",
  "that",
  "these",
  "those",
  // common verbs / aux
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "do",
  "does",
  "did",
  "doing",
  "have",
  "has",
  "had",
  "having",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "must",
  "can",
  "could",
  // prepositions / conjunctions
  "of",
  "in",
  "on",
  "at",
  "by",
  "to",
  "for",
  "with",
  "from",
  "as",
  "into",
  "onto",
  "out",
  "off",
  "up",
  "down",
  "over",
  "under",
  "and",
  "or",
  "but",
  "so",
  "if",
  "then",
  "than",
  "because",
  "while",
  "when",
  "where",
  "who",
  "which",
  "what",
  "why",
  "how",
  "not",
  "no",
  "yes",
  "okay",
  "ok",
  "well",
  "just",
  "really",
  "very",
  "much",
  "more",
  "most",
  "some",
  "any",
  "all",
  "each",
  "every",
  // common fillers (also covered by cut_filler_words but we don't
  // assume those are gone)
  "um",
  "uh",
  "uhm",
  "like",
  "you know",
  "i mean",
] as const;

/**
 * Build the cues + styles for a keyword-highlighted caption track.
 *
 * Returns:
 *   - styles: pass directly into AssOptions.styles (always 2 styles).
 *   - cues:   one cue per N words OR per gap boundary. Cues with a
 *             keyword embed the keyword via an inline `{\rKeyword}` ...
 *             `{\rDefault}` reset so a single cue can mix both styles.
 *
 * The caller controls font/size/colors by overriding fields on the
 * returned styles before passing them to buildAss.
 */
export function buildKeywordCaptions(
  words: TranscriptWord[],
  opts: KeywordCaptionOptions = {},
): { cues: AssCue[]; styles: AssStyle[] } {
  const groupSize = Math.max(1, opts.groupSize ?? 3);
  const gapSec = Math.max(0, opts.gapSec ?? 0.4);
  const minLen = Math.max(1, opts.minKeywordLen ?? 5);
  const maxKw = Math.max(0, opts.maxKeywordsPerCue ?? 1);
  const endPad = Math.max(0, opts.endPaddingSec ?? 0.08);
  const stoplist = new Set((opts.stoplist ?? DEFAULT_STOPLIST).map((s) => s.toLowerCase().trim()));

  const styles = defaultKeywordStyles();
  const cues: AssCue[] = [];

  if (words.length === 0) return { cues, styles };

  let cueWords: TranscriptWord[] = [];
  const flush = () => {
    if (cueWords.length === 0) return;
    cues.push(buildCue(cueWords, stoplist, minLen, maxKw, endPad));
    cueWords = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cueWords.length === 0) {
      cueWords.push(w);
      continue;
    }
    const prev = cueWords[cueWords.length - 1];
    const gap = w.start - prev.end;
    if (gap >= gapSec || cueWords.length >= groupSize) {
      flush();
    }
    cueWords.push(w);
  }
  flush();

  return { cues, styles };
}

/**
 * Decide whether a single token (already normalized) is a keyword.
 * Exported for unit testing.
 */
export function isKeywordToken(raw: string, stoplist: Set<string>, minLen: number): boolean {
  const stripped = raw.replace(/[^a-zA-Z0-9']/g, "");
  if (stripped.length === 0) return false;
  // Numbers always count.
  if (/^\d+([.,]\d+)?$/.test(stripped)) return true;
  // Pure ALL-CAPS at length >=2 (avoids "I").
  if (stripped.length >= 2 && stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped)) {
    return true;
  }
  const lower = stripped.toLowerCase();
  if (stoplist.has(lower)) return false;
  // Multi-word stoplist phrases like "you know" — token might be either
  // half. We only check single-token entries here (multi-word stops are
  // applied at the cut_filler_words layer).
  if (stripped.length < minLen) return false;
  return true;
}

// ── Internals ───────────────────────────────────────────────

function buildCue(
  cueWords: TranscriptWord[],
  stoplist: Set<string>,
  minLen: number,
  maxKw: number,
  endPad: number,
): AssCue {
  // Score each word: 0 = function word, 1 = candidate keyword.
  // Sort by length (longer = more salient), break ties by source order.
  const candidates = cueWords
    .map((w, idx) => ({ idx, isKw: isKeywordToken(w.text, stoplist, minLen) }))
    .filter((c) => c.isKw);
  // Take up to maxKw, preferring longer words.
  const chosen = new Set(
    [...candidates]
      .sort((a, b) => {
        const la = cueWords[a.idx].text.length;
        const lb = cueWords[b.idx].text.length;
        if (la !== lb) return lb - la;
        return a.idx - b.idx;
      })
      .slice(0, maxKw)
      .map((c) => c.idx),
  );

  // Build the ASS dialogue text. ASS supports inline style overrides via
  // {\rStyleName} which switches to that style; {\r} resets to default.
  const parts: string[] = [];
  cueWords.forEach((w, idx) => {
    const text = w.text.trim();
    if (chosen.has(idx)) {
      parts.push(`{\\rKeyword}${text}{\\r}`);
    } else {
      parts.push(text);
    }
  });

  return {
    start: cueWords[0].start,
    end: cueWords[cueWords.length - 1].end + endPad,
    text: parts.join(" "),
  };
}

/**
 * Sensible defaults that look right for vertical / 9:16 shorts:
 *   - Default style: large white sans-serif with thick outline.
 *   - Keyword style: punchy yellow, slightly larger, same font.
 *
 * Override via the returned array before passing into buildAss().
 */
export function defaultKeywordStyles(): AssStyle[] {
  return [
    {
      name: "Default",
      fontName: "Arial",
      fontSize: 84,
      primaryColor: "FFFFFF",
      outlineColor: "000000",
      outline: 4,
      bold: true,
      alignment: 2,
      marginV: 220,
    },
    {
      name: "Keyword",
      fontName: "Arial",
      fontSize: 96,
      primaryColor: "FFEA00",
      outlineColor: "000000",
      outline: 5,
      bold: true,
      alignment: 2,
      marginV: 220,
    },
  ];
}
