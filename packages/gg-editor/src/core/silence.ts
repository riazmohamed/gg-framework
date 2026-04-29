/**
 * Parser for ffmpeg's `silencedetect` filter output.
 *
 * The filter writes pairs of lines to stderr:
 *   [silencedetect @ 0x...] silence_start: 1.234
 *   [silencedetect @ 0x...] silence_end: 2.456 | silence_duration: 1.222
 *
 * If the recording ends mid-silence, the closing `silence_end` is omitted.
 * We close it ourselves using the optional `totalSec` parameter.
 */

export interface SilenceRange {
  startSec: number;
  endSec: number;
  durSec: number;
}

const START_RE = /silence_start:\s*(-?\d+(?:\.\d+)?)/;
const END_RE = /silence_end:\s*(-?\d+(?:\.\d+)?)/;

/**
 * Parse silencedetect lines into ranges. Robust to interleaved ffmpeg log
 * lines, partial buffers, and unterminated final silences.
 *
 * @param stderr  Combined ffmpeg stderr text.
 * @param totalSec  Total media duration. If the last detected silence has no
 *                  matching `silence_end`, it's closed at totalSec.
 */
export function parseSilenceDetect(stderr: string, totalSec?: number): SilenceRange[] {
  const ranges: SilenceRange[] = [];
  let openStart: number | undefined;

  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = START_RE.exec(line);
    if (startMatch) {
      const v = Number(startMatch[1]);
      if (!Number.isFinite(v)) {
        continue;
      }
      // ffmpeg can emit a slightly-negative start (e.g. -0.00133333) when the
      // file leads with silence — it's a filter look-back artifact, not a real
      // negative time. Clamp to 0 so leading-silence detection works.
      // We still reject genuinely-negative values (< -1s) as parse errors.
      if (v < -1) continue;
      openStart = Math.max(0, v);
      continue;
    }
    const endMatch = END_RE.exec(line);
    if (endMatch && openStart !== undefined) {
      const end = Number(endMatch[1]);
      if (Number.isFinite(end) && end > openStart) {
        ranges.push({
          startSec: openStart,
          endSec: end,
          durSec: +(end - openStart).toFixed(6),
        });
      }
      openStart = undefined;
    }
  }

  // Close a trailing unterminated silence at the end of the file.
  if (openStart !== undefined && totalSec !== undefined && totalSec > openStart) {
    ranges.push({
      startSec: openStart,
      endSec: totalSec,
      durSec: +(totalSec - openStart).toFixed(6),
    });
  }

  return ranges;
}

/**
 * Convert silence ranges (in seconds) to frame-aligned ranges. Rounds INWARD
 * — start ceils, end floors — so the resulting cut never trims into speech.
 */
export function silencesToFrameRanges(
  silences: SilenceRange[],
  fps: number,
): Array<{ startFrame: number; endFrame: number }> {
  const out: Array<{ startFrame: number; endFrame: number }> = [];
  for (const s of silences) {
    const sf = Math.ceil(s.startSec * fps);
    const ef = Math.floor(s.endSec * fps);
    if (ef > sf) out.push({ startFrame: sf, endFrame: ef });
  }
  return out;
}

/**
 * Compute the inverse: "keep" ranges between silences. Convenient for the
 * agent which mostly cares about what to KEEP (those become EDL events).
 *
 * Pads each keep range outward by `paddingSec` (clamped to neighbours and
 * total duration) so cuts don't slice the first/last syllable.
 */
export function keepRangesFromSilences(
  silences: SilenceRange[],
  totalSec: number,
  paddingSec = 0,
): SilenceRange[] {
  // Sort defensively; ffmpeg always emits in order but tests/callers may not.
  const sorted = [...silences].sort((a, b) => a.startSec - b.startSec);
  const keeps: SilenceRange[] = [];
  let cursor = 0;

  for (const s of sorted) {
    if (s.startSec > cursor) {
      const start = Math.max(0, cursor - paddingSec);
      const end = Math.min(totalSec, s.startSec + paddingSec);
      if (end > start)
        keeps.push({ startSec: start, endSec: end, durSec: +(end - start).toFixed(6) });
    }
    cursor = Math.max(cursor, s.endSec);
  }
  if (cursor < totalSec) {
    const start = Math.max(0, cursor - paddingSec);
    keeps.push({ startSec: start, endSec: totalSec, durSec: +(totalSec - start).toFixed(6) });
  }
  return keeps;
}
