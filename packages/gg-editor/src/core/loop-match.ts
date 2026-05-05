/**
 * Loop-match filter builder for Shorts.
 *
 * YouTube Shorts auto-replays from the start when the clip ends. A
 * crossfade between the last N ms and the first N ms makes the
 * re-loop feel seamless. Loop rate is a confirmed Shorts ranking
 * signal — see the `youtube-algorithm-primer` skill.
 *
 * This module produces the `-filter_complex` string and the matching
 * `-map` directives. The wrapper tool then runs ffmpeg with libx264 +
 * aac at standard delivery settings.
 *
 * Two modes:
 *   - "crossfade" (default): xfade fade between the tail and a copy of
 *     the head. Audio: acrossfade.
 *   - "jumpcut": no crossfade — simply hard-cut the last cf seconds off
 *     so the loop boundary lands right before the head's first frame.
 *     Cheaper; safe for very short clips where any crossfade would eat
 *     too much of the visible content.
 */

export type LoopMatchMethod = "crossfade" | "jumpcut";

export interface LoopMatchPlan {
  /** Effective crossfade duration after clamping. */
  crossfadeSec: number;
  /** Final output duration after the filter applies. */
  outDurationSec: number;
  method: LoopMatchMethod;
  /** ffmpeg -filter_complex value. */
  filter: string;
  /** -map directives in order. */
  maps: string[];
}

/**
 * Build the filter graph for a loop-match pass.
 *
 * crossfade mode plan:
 *   [0:v] split=2 [main][tail_src];
 *   [main]   trim=0:T-cf, setpts=PTS-STARTPTS [vmain];
 *   [tail_src] trim=T-cf:T,  setpts=PTS-STARTPTS [tail];
 *   [0:v] trim=0:cf, setpts=PTS-STARTPTS [head];
 *   [tail][head] xfade=transition=fade:duration=cf:offset=0 [xfade];
 *   [vmain][xfade] concat=n=2:v=1:a=0 [vout]
 *   ── audio ──
 *   [0:a] asplit=2 [amain][atail_src];
 *   [amain]    atrim=0:T-cf, asetpts=PTS-STARTPTS [aout1];
 *   [atail_src] atrim=T-cf:T, asetpts=PTS-STARTPTS [atail];
 *   [0:a]      atrim=0:cf,    asetpts=PTS-STARTPTS [ahead];
 *   [atail][ahead] acrossfade=d=cf [axfade];
 *   [aout1][axfade] concat=n=2:v=0:a=1 [aout]
 *
 * Final length = (T - cf) + cf = T. Duration unchanged; only the last
 * cf seconds become a crossfade into the head.
 *
 * Pure — easy to unit-test the filter string. Throws on invalid input.
 */
export function buildLoopMatchFilter(
  durationSec: number,
  crossfadeSec: number,
  method: LoopMatchMethod = "crossfade",
): LoopMatchPlan {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("durationSec must be > 0");
  }
  if (!Number.isFinite(crossfadeSec) || crossfadeSec <= 0) {
    throw new Error("crossfadeSec must be > 0");
  }
  // Crossfade can't be ≥ half the clip — there'd be no "main" body left.
  const maxCf = durationSec / 2;
  const cf = Math.min(crossfadeSec, +(maxCf - 0.05).toFixed(3));
  if (cf <= 0) {
    throw new Error(
      `clip too short (${durationSec.toFixed(2)}s) for any crossfade; pass crossfadeSec ≤ ${maxCf.toFixed(2)}`,
    );
  }
  const T = +durationSec.toFixed(3);
  const tailStart = +(T - cf).toFixed(3);

  if (method === "jumpcut") {
    // Just trim the last cf seconds. No xfade. Output is shorter.
    const filter =
      `[0:v]trim=0:${tailStart},setpts=PTS-STARTPTS[vout];` +
      `[0:a]atrim=0:${tailStart},asetpts=PTS-STARTPTS[aout]`;
    return {
      crossfadeSec: cf,
      outDurationSec: tailStart,
      method,
      filter,
      maps: ["[vout]", "[aout]"],
    };
  }

  const filter =
    `[0:v]split=2[main][tail_src];` +
    `[main]trim=0:${tailStart},setpts=PTS-STARTPTS[vmain];` +
    `[tail_src]trim=${tailStart}:${T},setpts=PTS-STARTPTS[tail];` +
    `[0:v]trim=0:${cf},setpts=PTS-STARTPTS[head];` +
    `[tail][head]xfade=transition=fade:duration=${cf}:offset=0[xf];` +
    `[vmain][xf]concat=n=2:v=1:a=0[vout];` +
    `[0:a]asplit=2[amain][atail_src];` +
    `[amain]atrim=0:${tailStart},asetpts=PTS-STARTPTS[aout1];` +
    `[atail_src]atrim=${tailStart}:${T},asetpts=PTS-STARTPTS[atail];` +
    `[0:a]atrim=0:${cf},asetpts=PTS-STARTPTS[ahead];` +
    `[atail][ahead]acrossfade=d=${cf}[axf];` +
    `[aout1][axf]concat=n=2:v=0:a=1[aout]`;

  return {
    crossfadeSec: cf,
    outDurationSec: T,
    method,
    filter,
    maps: ["[vout]", "[aout]"],
  };
}
