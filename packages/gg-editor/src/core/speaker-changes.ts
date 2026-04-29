/**
 * Heuristic speaker-change detector.
 *
 * v1 limitation: silence-gap based. Any inter-segment gap > `minGapSec`
 * counts as a candidate speaker boundary. This is REASONABLE for fast-cut
 * interviews where speakers don't overlap and there's a clear pause when one
 * stops talking. It's WRONG for natural conversation with overlap, rapid
 * back-and-forth, or single-speaker monologues with dramatic pauses.
 *
 * Honest output: returns CANDIDATES, not assignments. The agent should
 * present these to the user, not commit to them silently.
 *
 * Real diarization needs a speaker-embedding model (pyannote, WeSpeaker,
 * whisperx). When we wire that, this v1 stays as a no-dependency fallback.
 */
import type { Transcript } from "./whisper.js";

export interface SpeakerChangeCandidate {
  /** Time of the candidate boundary (seconds). */
  atSec: number;
  /** Gap before this point in seconds. */
  gapSec: number;
  /** First segment AFTER the boundary (text preview). */
  nextSegmentText: string;
}

export interface SpeakerChangeOptions {
  /** Minimum inter-segment silence to count as a boundary. Default 1.5s. */
  minGapSec?: number;
}

export function detectSpeakerChanges(
  transcript: Transcript,
  opts: SpeakerChangeOptions = {},
): SpeakerChangeCandidate[] {
  const minGapSec = opts.minGapSec ?? 1.5;
  const segs = [...transcript.segments].sort((a, b) => a.start - b.start);
  const out: SpeakerChangeCandidate[] = [];
  for (let i = 1; i < segs.length; i += 1) {
    const prev = segs[i - 1];
    const cur = segs[i];
    const gap = cur.start - prev.end;
    if (gap > minGapSec) {
      out.push({
        atSec: +cur.start.toFixed(3),
        gapSec: +gap.toFixed(3),
        nextSegmentText: cur.text.slice(0, 80),
      });
    }
  }
  return out;
}
