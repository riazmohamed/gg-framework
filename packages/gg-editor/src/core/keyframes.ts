/**
 * Keyframe sampling + easing curve helpers.
 *
 * Used by file-only ffmpeg helpers (Ken-Burns zoompan, speed-ramp curves)
 * and by tests that want to verify FCPXML emission lines up with the
 * mathematical sampled trajectory.
 *
 * Convention: t is normalized 0..1. Curves are pure functions of t so they
 * compose cleanly. easeIn / easeOut use simple quadratic curves; smooth is
 * smoothstep (3t² − 2t³). Linear is the identity.
 */

import type { Keyframe } from "./fcpxml.js";

/** Linear interpolation. f(t) = t. */
export function linear(t: number): number {
  return clamp01(t);
}

/** Quadratic ease-in. f(t) = t². Slow start, fast finish. */
export function easeIn(t: number): number {
  const c = clamp01(t);
  return c * c;
}

/** Quadratic ease-out. f(t) = 1 − (1−t)². Fast start, slow finish. */
export function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/** Smoothstep. f(t) = 3t² − 2t³. Symmetric ease-in-out. */
export function smooth(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Resolve an "interp" string to its curve function. */
export function curveFor(
  interp: "linear" | "easeIn" | "easeOut" | "smooth" | undefined,
): (t: number) => number {
  switch (interp) {
    case "easeIn":
      return easeIn;
    case "easeOut":
      return easeOut;
    case "smooth":
      return smooth;
    case "linear":
    case undefined:
      return linear;
  }
}

/**
 * Sample a scalar keyframe sequence at a given clip-relative frame.
 *
 * Behaviour:
 *   - Empty list → throws (caller bug).
 *   - Single keyframe → returns its value (constant).
 *   - Frame before first kf → first value (clamp).
 *   - Frame after last kf → last value (clamp).
 *   - Otherwise → interpolate between the two surrounding kfs using the
 *     LEFT keyframe's `interp` setting.
 */
export function sampleCurve(kfs: Keyframe<number>[], frame: number, _fps: number): number {
  if (kfs.length === 0) throw new Error("sampleCurve: empty keyframe list");
  if (kfs.length === 1) return kfs[0].value;
  // Sorted-by-frame assumed; we don't sort here so the caller controls order.
  if (frame <= kfs[0].frame) return kfs[0].value;
  if (frame >= kfs[kfs.length - 1].frame) return kfs[kfs.length - 1].value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const span = b.frame - a.frame;
      if (span <= 0) return b.value;
      const t = (frame - a.frame) / span;
      const eased = curveFor(a.interp)(t);
      return a.value + (b.value - a.value) * eased;
    }
  }
  // Unreachable given the early-exit clamps above.
  return kfs[kfs.length - 1].value;
}

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}
