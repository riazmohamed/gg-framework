import { runPython } from "./python.js";
import { sidecarPath } from "./python/sidecar-path.js";

/**
 * Face-tracked reframe — pure planning + ffmpeg-filter synthesis.
 *
 * `analyzeReframe` shells out to the MediaPipe / PySceneDetect sidecar to get
 * a per-shot smoothed face centre. `buildReframeFilter` is a pure function
 * that compiles the plan into a single ffmpeg `crop=...` expression that
 * follows the subject across shots. Splitting the heavy I/O from the
 * filter math keeps the latter unit-testable without Python installed.
 */

export type Aspect = "9:16" | "1:1" | "4:5" | "16:9";

export interface AspectRatio {
  /** Width side of the ratio (e.g. 9 for 9:16). */
  w: number;
  /** Height side of the ratio (e.g. 16 for 9:16). */
  h: number;
}

export function parseAspect(aspect: Aspect): AspectRatio {
  const [w, h] = aspect.split(":").map((n) => Number(n));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error(`invalid aspect: ${aspect}`);
  }
  return { w, h };
}

export interface ReframeFrameSample {
  atSec: number;
  faceCx: number;
  faceCy: number;
  faceW: number;
  faceH: number;
}

export type ShotMode = "face" | "motion" | "static";

export interface ReframeShot {
  startSec: number;
  endSec: number;
  frames: ReframeFrameSample[];
  /** Smoothed centre X (normalized 0-1). */
  smoothedX: number;
  /** Smoothed centre Y (normalized 0-1). */
  smoothedY: number;
  mode: ShotMode;
}

export interface ReframePlan {
  shots: ReframeShot[];
  totalSec: number;
  fps: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface AnalyzeReframeOptions {
  signal?: AbortSignal;
  /** Frames per second to face-detect. Default 5. */
  sampleFps?: number;
  /** MediaPipe min_detection_confidence. Default 0.5. */
  minDetectionConfidence?: number;
  /** Smoothing window in seconds (informational; sidecar uses median). Default 0.5. */
  smoothingWindowSec?: number;
}

/**
 * Spawn the face-reframe sidecar; return the parsed shot plan.
 * Throws on sidecar failure with the structured error embedded.
 */
export async function analyzeReframe(
  videoPath: string,
  opts: AnalyzeReframeOptions = {},
): Promise<ReframePlan> {
  const script = sidecarPath("face_reframe.py");
  const stdin = JSON.stringify({
    videoPath,
    sampleFps: opts.sampleFps,
    minDetectionConfidence: opts.minDetectionConfidence,
    smoothingWindowSec: opts.smoothingWindowSec,
  });
  const { code, stdout, stderr } = await runPython(script, [], {
    signal: opts.signal,
    stdin,
  });

  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(
      `face-reframe sidecar returned empty stdout (exit ${code}): ${tail(stderr)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `face-reframe sidecar returned malformed output: ${trimmed.slice(-200)} | stderr: ${tail(stderr)}`,
    );
  }
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const err = parsed as { error?: string };
    throw new Error(err.error ?? "unknown face-reframe sidecar error");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as ReframePlan).shots)
  ) {
    throw new Error(`face-reframe sidecar returned unexpected shape: ${trimmed.slice(-200)}`);
  }
  return parsed as ReframePlan;
}

export interface BuildReframeFilterResult {
  /** ffmpeg `-vf` value (already includes both crop + scale). */
  filter: string;
  /** Output width (after crop, before scale-back). */
  outWidth: number;
  /** Output height (after crop, before scale-back). */
  outHeight: number;
  /** Per-shot crop X positions (after clamping into [0, srcW-outW]). */
  shotXs: number[];
}

/**
 * Compute the crop dimensions for a target aspect when cropping FROM a
 * source frame. The crop is sized to fit ENTIRELY inside the source — i.e.
 * we letterbox neither dimension. The returned `outW` × `outH` matches the
 * target aspect exactly.
 *
 * Pure / unit-testable.
 */
export function reframeCropSize(
  srcW: number,
  srcH: number,
  aspect: Aspect,
): { outW: number; outH: number } {
  if (srcW <= 0 || srcH <= 0) {
    throw new Error("source dimensions must be positive");
  }
  const { w: aw, h: ah } = parseAspect(aspect);
  // Two candidate crops:
  //   width-bound: outW = srcW, outH = srcW * ah / aw
  //   height-bound: outH = srcH, outW = srcH * aw / ah
  // Pick whichever fits inside the source frame.
  const heightFromW = (srcW * ah) / aw;
  let outW: number;
  let outH: number;
  if (heightFromW <= srcH) {
    // Width-bound (e.g. 16:9 source → 1:1 crop is height-bound; 16:9 source → 9:16 crop is height-bound;
    // a square source → 9:16 crop is width-bound).
    outW = srcW;
    outH = heightFromW;
  } else {
    outH = srcH;
    outW = (srcH * aw) / ah;
  }
  // Round DOWN to even integers. ffmpeg's libx264 needs even crop dims;
  // rounding down avoids exceeding the source.
  outW = Math.floor(outW / 2) * 2;
  outH = Math.floor(outH / 2) * 2;
  if (outW <= 0 || outH <= 0) {
    throw new Error("computed crop is degenerate");
  }
  return { outW, outH };
}

/**
 * Compile a per-shot smoothed-face plan into one ffmpeg `crop` expression
 * that switches X position by timestamp. Each shot contributes one
 * `if(between(t, a, b), x_i, ...)` tier; the outermost ELSE is a centre
 * crop so the filter is a no-op outside any defined shot.
 *
 * The crop's Y is left static (we don't currently track vertical motion;
 * faces tend to dominate the upper third on portrait crops anyway).
 *
 * Pure / unit-testable. No ffmpeg execution.
 */
export function buildReframeFilter(plan: ReframePlan, aspect: Aspect): BuildReframeFilterResult {
  const { sourceWidth: srcW, sourceHeight: srcH } = plan;
  const { outW, outH } = reframeCropSize(srcW, srcH, aspect);

  // For each shot compute the desired top-left X from the smoothed face
  // centre, then clamp into the legal range so the crop never escapes the
  // frame. Y is centred — vertical face position varies less for talking
  // heads, and exposing both axes invites jitter.
  const yCentre = Math.floor((srcH - outH) / 2);

  const shots = plan.shots
    .filter((s) => s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  const shotXs: number[] = [];
  // Build `xExpr` from the LAST shot backwards so each `if` wraps the next.
  // Default (outside all shots): centre crop.
  const centreX = Math.floor((srcW - outW) / 2);
  let xExpr: string = String(centreX);
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    const desiredCx = Math.round(s.smoothedX * srcW);
    let x = desiredCx - Math.floor(outW / 2);
    // Clamp into [0, srcW - outW].
    if (x < 0) x = 0;
    const maxX = srcW - outW;
    if (x > maxX) x = maxX;
    shotXs[i] = x;
    const a = fmt(s.startSec);
    const b = fmt(s.endSec);
    xExpr = `if(between(t\\,${a}\\,${b})\\,${x}\\,${xExpr})`;
  }

  // crop=W:H:x:y — single filter, single pass. We pin Y to a constant
  // (centre) for now; if we extend to vertical tracking later this becomes
  // a parallel piecewise expression.
  const cropFilter = `crop=${outW}:${outH}:x='${xExpr}':y=${yCentre}`;
  return { filter: cropFilter, outWidth: outW, outHeight: outH, shotXs };
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number(n.toFixed(4)).toString();
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}
