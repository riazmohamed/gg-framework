/**
 * Punch-in (digital zoom on cuts) — the canonical YouTuber trick to
 * disguise jump cuts on a single-camera talking head. Cut filler →
 * punch in slightly on the kept side → the head-jerk vanishes.
 *
 * We implement this with an ffmpeg `crop` filter whose width / height /
 * x / y values are EXPRESSIONS that depend on `t` (current frame
 * timestamp). Outside any punch range, expressions evaluate to a
 * full-frame crop (no-op). Inside a range, they evaluate to a centered
 * sub-frame crop, then a `scale` brings it back to the original size.
 *
 * One ffmpeg pass, no segmenting + concat — fast and simple.
 *
 * The math, for a punch range with zoom Z (>1, e.g. 1.10 = 10% punch):
 *   crop_w = floor(iw / Z)
 *   crop_h = floor(ih / Z)
 *   crop_x = floor((iw - crop_w) / 2)
 *   crop_y = floor((ih - crop_h) / 2)
 *
 * To stitch multiple ranges into a single expression, we wrap each
 * tier in `if(between(t, a, b), <punched>, <prev>)`, falling back to a
 * full-frame crop outside any range.
 *
 * Pure logic; the tool wrapper handles ffmpeg invocation.
 */

export interface PunchInRange {
  /** Range start (seconds, inclusive). */
  startSec: number;
  /** Range end (seconds, inclusive). */
  endSec: number;
  /**
   * Zoom multiplier. 1.10 = 10% punch (subtle, the YouTuber default).
   * 1.0 = no zoom (effectively skipped). Clamped to [1.0, 2.0].
   */
  zoom: number;
}

export interface PunchInOptions {
  /**
   * Default zoom for ranges where `zoom` is omitted. Default 1.10.
   * 1.05 is barely perceptible; 1.15 is a clear pop; >1.20 looks like
   * an effect rather than a hidden cut.
   */
  defaultZoom?: number;
  /**
   * Optional smoothing window (seconds) at each edge to prevent the
   * crop from snapping. The crop gradually ramps from 1.0 → zoom over
   * `rampSec` at the start, and back at the end. Default 0 (instant).
   * Use ~0.08s for subtle, ~0.15s for a noticeable push-in.
   */
  rampSec?: number;
}

/**
 * Build the `-vf` value for ffmpeg that applies all punch ranges in
 * order. Returns the empty string if there are no ranges (no-op
 * caller can decide whether to skip ffmpeg altogether).
 *
 * The filter is structured as `crop=W:H:X:Y,scale=iw_orig:ih_orig`,
 * where W/H/X/Y are nested if-expressions evaluated per-frame.
 */
export function buildPunchInFilter(
  ranges: PunchInRange[],
  origWidth: number,
  origHeight: number,
  opts: PunchInOptions = {},
): string {
  if (origWidth <= 0 || origHeight <= 0) {
    throw new Error("origWidth and origHeight must be positive");
  }
  const defaultZoom = clampZoom(opts.defaultZoom ?? 1.1);
  const ramp = Math.max(0, opts.rampSec ?? 0);

  const cleaned = ranges
    .map((r) => ({
      startSec: r.startSec,
      endSec: r.endSec,
      zoom: clampZoom(r.zoom || defaultZoom),
    }))
    .filter((r) => r.endSec > r.startSec && r.zoom > 1.0001)
    .sort((a, b) => a.startSec - b.startSec);

  if (cleaned.length === 0) return "";

  // We construct one expression for the crop WIDTH and one for HEIGHT.
  // X/Y are derived as (orig - crop) / 2 inside ffmpeg's expression
  // language so we don't need to repeat the zoom logic.
  //
  // Effective per-range zoom (with ramp):
  //   rampedZoom(t) = 1 + (Z - 1) * clamp01(min((t - a)/ramp, (b - t)/ramp))
  //   when ramp > 0; otherwise just Z.
  const widthExpr = buildSizeExpr(cleaned, "iw", ramp);
  const heightExpr = buildSizeExpr(cleaned, "ih", ramp);

  // x,y center the crop. ffmpeg: `(iw-out_w)/2`, `(ih-out_h)/2` — using
  // the special vars `out_w` / `out_h` that reference the crop's own
  // width / height expressions.
  const cropFilter = `crop=w='${widthExpr}':h='${heightExpr}':x='(iw-out_w)/2':y='(ih-out_h)/2'`;
  // Re-scale the (smaller) crop back to the source resolution so the
  // output stream stays the same size as the input. Use lanczos for
  // sharp upscale.
  const scaleFilter = `scale=${origWidth}:${origHeight}:flags=lanczos`;
  return `${cropFilter},${scaleFilter}`;
}

/**
 * Build a piecewise expression for either the cropped width or height.
 * `dim` is the ffmpeg variable for the source size ("iw" / "ih").
 */
function buildSizeExpr(ranges: PunchInRange[], dim: "iw" | "ih", ramp: number): string {
  // Outside any range, the cropped dimension == source dimension (no-op).
  let expr: string = dim;
  // Build from the LAST range backwards so each `if(cond, then, else)`
  // wraps the previously-built else-branch.
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { startSec, endSec, zoom } = ranges[i];
    const a = fmt(startSec);
    const b = fmt(endSec);
    let zExpr: string;
    if (ramp > 0) {
      // 1 + (Z-1) * clamp01(min((t-a)/ramp, (b-t)/ramp))
      const r = fmt(ramp);
      const factor = `clip(min((t-${a})/${r}\\,(${b}-t)/${r})\\,0\\,1)`;
      zExpr = `(1+${fmt(zoom - 1)}*${factor})`;
    } else {
      zExpr = fmt(zoom);
    }
    // Cropped dim = source / zoom.
    const inside = `${dim}/${zExpr}`;
    expr = `if(between(t\\,${a}\\,${b})\\,${inside}\\,${expr})`;
  }
  return expr;
}

/**
 * Auto-derive punch-in ranges from a list of cut points (e.g. the
 * timestamps of every silence-cut or filler-cut). One short punch
 * after each cut hides the discontinuity.
 *
 * @param cutPoints  Seconds where cuts happen.
 * @param totalSec   Media duration (so the last range gets clipped).
 * @param holdSec    How long each punch lasts after the cut. Default 1.5s.
 * @param zoom       Zoom multiplier. Default 1.10.
 */
export function punchInsAfterCuts(
  cutPoints: number[],
  totalSec: number,
  holdSec = 1.5,
  zoom = 1.1,
): PunchInRange[] {
  const sorted = [...cutPoints].filter((t) => t >= 0 && t < totalSec).sort((a, b) => a - b);
  const out: PunchInRange[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    // Don't run a punch into the next cut.
    const next = sorted[i + 1] ?? totalSec;
    const end = Math.min(start + holdSec, next, totalSec);
    if (end - start < 0.1) continue; // skip tiny/no-op ranges
    out.push({ startSec: start, endSec: end, zoom });
  }
  return out;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Use 4 decimals; trim trailing zeros for shorter expressions.
  return Number(n.toFixed(4)).toString();
}

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.max(1.0, Math.min(2.0, z));
}
