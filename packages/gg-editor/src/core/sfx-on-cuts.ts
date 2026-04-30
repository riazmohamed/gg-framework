/**
 * Sound-design-on-cuts: drop a short SFX (whoosh, pop, swoosh) at
 * every cut point. Sound holds attention longer than visuals, and a
 * subtle whoosh-on-cut is the standard polish on every retention-
 * optimized vlog / short.
 *
 * We layer the SFX on top of the existing audio with a configurable
 * gain offset (default -8 dB so it doesn't fight the voice). One
 * ffmpeg pass — we read the SFX once and use the `adelay` filter to
 * shift one copy per cut point onto its target timestamp, then
 * `amix` everything down with the original audio.
 *
 * Pure logic here just builds the filter graph string; the tool
 * wrapper spawns ffmpeg.
 */

export interface SfxOnCutsOptions {
  /** Cut points in seconds. */
  cutPoints: number[];
  /** Total media duration (sec). Cuts >= total are dropped. */
  totalSec: number;
  /**
   * SFX gain relative to original audio. Default -8 dB. Use -12 dB
   * for very subtle, -4 dB for prominent.
   */
  sfxGainDb?: number;
  /**
   * Original-track sidechain duck depth (dB) at each cut. Default 0
   * (no ducking). Use -3 to -6 to slightly dip the voice under the
   * whoosh — adds polish but harder to undo.
   */
  duckDb?: number;
  /**
   * Min spacing (sec) between SFX hits. Default 0.25s — closer hits
   * get collapsed (fast machine-gun cuts shouldn't stack 8 whooshes).
   */
  minSpacingSec?: number;
}

export interface SfxFilterGraph {
  /**
   * Complete `-filter_complex` value. Two inputs expected on the
   * ffmpeg command line: `[0:a]` (original) and `[1:a]` (sfx file).
   * The output label is `[mix]`.
   */
  filterComplex: string;
  /** Number of SFX hits the graph emits (after deduplication). */
  hits: number;
}

/**
 * Build a filter_complex that lays one SFX hit per cut point onto
 * the original audio, returning the result on label `[mix]`.
 *
 * Strategy:
 *   1. Drop cut points outside [0, totalSec) and dedupe by min spacing.
 *   2. For each hit i: `[1:a]adelay=Tms|Tms,volume=Gd[s_i]` produces a
 *      gained, delayed copy of the SFX on its own label. (`Tms|Tms`
 *      delays both stereo channels equally.)
 *   3. amix=inputs=N+1 sums the original + all SFX copies into [mix].
 */
export function buildSfxOnCutsFilter(opts: SfxOnCutsOptions): SfxFilterGraph {
  const minSpacing = Math.max(0, opts.minSpacingSec ?? 0.25);
  const sfxGain = dbToLinear(opts.sfxGainDb ?? -8);
  const duckDb = opts.duckDb ?? 0;

  const sorted = [...opts.cutPoints]
    .filter((t) => Number.isFinite(t) && t >= 0 && t < opts.totalSec)
    .sort((a, b) => a - b);

  const deduped: number[] = [];
  for (const t of sorted) {
    if (deduped.length === 0 || t - deduped[deduped.length - 1] >= minSpacing) {
      deduped.push(t);
    }
  }

  if (deduped.length === 0) {
    // No-op graph: just label the original audio as [mix].
    return {
      filterComplex: "[0:a]anull[mix]",
      hits: 0,
    };
  }

  const segments: string[] = [];
  const sfxLabels: string[] = [];
  deduped.forEach((t, i) => {
    const ms = Math.max(0, Math.round(t * 1000));
    const label = `s${i}`;
    sfxLabels.push(`[${label}]`);
    segments.push(`[1:a]adelay=${ms}|${ms},volume=${fmt(sfxGain)}[${label}]`);
  });

  // Optional ducking: sidechaincompress the original against a sum of
  // the SFX copies so the voice dips slightly when a whoosh fires.
  // We keep this off by default — pushing the duck depth requires the
  // user understand it.
  let originalLabel = "[0:a]";
  if (duckDb < 0) {
    // Sum sfx copies into [duckSrc] and sidechain.
    segments.push(`${sfxLabels.join("")}amix=inputs=${sfxLabels.length}:normalize=0[duckSrc]`);
    const ratio = duckDbToRatio(duckDb);
    segments.push(
      `[0:a][duckSrc]sidechaincompress=threshold=0.05:ratio=${fmt(ratio)}:attack=5:release=200[ducked]`,
    );
    originalLabel = "[ducked]";
  }

  // Final amix combines the (possibly ducked) original + every SFX copy.
  segments.push(
    `${originalLabel}${sfxLabels.join("")}amix=inputs=${1 + sfxLabels.length}:normalize=0[mix]`,
  );

  return {
    filterComplex: segments.join(";"),
    hits: deduped.length,
  };
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Convert "duck the voice by N dB" into a sidechaincompress ratio. A
 * crude mapping: -3 dB → 2:1, -6 dB → 4:1, -9 dB → 8:1. Floors at 1.5.
 */
function duckDbToRatio(duckDb: number): number {
  const absDb = Math.abs(duckDb);
  return Math.max(1.5, Math.pow(2, absDb / 3));
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number(n.toFixed(4)).toString();
}
