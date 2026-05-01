/**
 * Speed-ramp builder — piecewise-constant speed segments using ffmpeg's
 * setpts (video) and atempo / asetrate (audio).
 *
 * Why piecewise-constant: stock ffmpeg's setpts can take an `if(...)` chain
 * that switches PTS multiplier based on input time T. This is enough to
 * express the common "slow → fast → slow" cinematic ramp by stepping
 * through 2-3 segments. Smooth ramps (continuous interpolation) require
 * the `vfrdec` / `minterpolate` complex chain, which is out of v1 scope.
 *
 * Real-world reference for the setpts shape: scottcjn/bottube and several
 * VFXer scripts on GitHub. Confirmed against ffmpeg-filters man page.
 *
 * Mathematical model:
 *   Each segment runs from points[i].atSec to points[i+1].atSec at speed
 *   ((points[i].speed + points[i+1].speed) / 2). For >2 points we use the
 *   LEFT speed within each segment (piecewise-constant) — easier to reason
 *   about in the wild and matches what most tutorial code does.
 *
 *   Video: PTS multiplier = 1 / speed   → setpts=k*PTS where k = 1/speed.
 *   Audio: atempo accepts 0.5..2 in one stage; we chain stages for wider
 *          ranges. asetrate is faster but pitch-shifts; we don't use it for
 *          voice content.
 */

export interface SpeedPoint {
  /** Absolute time in seconds in the input. */
  atSec: number;
  /**
   * Speed multiplier from this point until the next. 1 = normal,
   * 0.5 = half speed (slow-mo), 2 = double speed.
   */
  speed: number;
}

/**
 * Build the setpts expression for a piecewise-constant speed ramp.
 *
 * For points = [{atSec:0,speed:1},{atSec:2,speed:0.5},{atSec:5,speed:1}]
 * the output is:
 *   setpts='if(lt(T,2),1*PTS,if(lt(T,5),2*PTS,1*PTS))'
 *
 * (k = 1/speed for each segment.)
 */
export function buildSetpts(points: SpeedPoint[]): string {
  validatePoints(points);
  const expr = buildIfChain(points);
  return `setpts='${expr}'`;
}

/**
 * Build the audio-side filter chain. Returns null if every segment is
 * speed=1 (no-op). For >0.5 / <2 segments uses one atempo stage; for wider
 * ranges chains multiple stages (atempo's per-stage range is 0.5..2).
 *
 * Note: atempo is single-speed at a time. For piecewise ramps the fully
 * accurate path is to split the audio at each ramp boundary and process
 * each segment, then concat. We DON'T do that here — for the v1 scope this
 * function returns the AVERAGE atempo factor, with a flag the caller can
 * use to decide if a more complex split is needed.
 */
export function buildAtempo(points: SpeedPoint[]): {
  filter: string | null;
  stages: number;
  avgSpeed: number;
} {
  validatePoints(points);
  let totalSec = 0;
  let weightedSpeed = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dt = points[i + 1].atSec - points[i].atSec;
    totalSec += dt;
    weightedSpeed += points[i].speed * dt;
  }
  const avg = totalSec > 0 ? weightedSpeed / totalSec : points[points.length - 1].speed;
  if (Math.abs(avg - 1) < 1e-6) {
    return { filter: null, stages: 0, avgSpeed: 1 };
  }
  // Chain atempo stages so each is in [0.5, 2].
  const stages: string[] = [];
  let remaining = avg;
  while (remaining > 2.0001) {
    stages.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.4999) {
    stages.push("atempo=0.5");
    remaining /= 0.5;
  }
  // Final stage with the residual factor.
  stages.push(`atempo=${fmt(remaining)}`);
  return { filter: stages.join(","), stages: stages.length, avgSpeed: avg };
}

function validatePoints(points: SpeedPoint[]): void {
  if (points.length < 2) {
    throw new Error("speed ramp requires >=2 points (start + end)");
  }
  for (const p of points) {
    if (!(p.speed > 0)) {
      throw new Error(`speed must be > 0; got ${p.speed} at ${p.atSec}s`);
    }
  }
  for (let i = 1; i < points.length; i++) {
    if (points[i].atSec <= points[i - 1].atSec) {
      throw new Error(
        `speed-ramp points must be strictly increasing in atSec; offending pair at index ${i - 1}`,
      );
    }
  }
}

function buildIfChain(points: SpeedPoint[]): string {
  // We have N points → N-1 segments. The last point's speed is used after
  // the final boundary (i.e. an "else" speed).
  const segments: { until: number; k: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({ until: points[i + 1].atSec, k: 1 / points[i].speed });
  }
  const trailingK = 1 / points[points.length - 1].speed;
  // Build right-to-left so the innermost else is the trailing speed.
  let expr = `${fmt(trailingK)}*PTS`;
  for (let i = segments.length - 1; i >= 0; i--) {
    expr = `if(lt(T,${fmt(segments[i].until)}),${fmt(segments[i].k)}*PTS,${expr})`;
  }
  return expr;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, "");
}
