/**
 * Multi-format render presets — the "render every platform at once" matrix.
 *
 * Pure dispatcher for `render_multi_format`: given a source resolution and a
 * preset name, produces the ffmpeg `-vf` filter graph plus the target W×H.
 * Spawning ffmpeg lives in the tool layer so this module stays trivially
 * unit-testable.
 *
 * Two transform modes:
 *
 *   - "scale-pad"   — letterbox/pillarbox the source into the target frame
 *                     without cropping. Used for 16:9-into-16:9 (different
 *                     resolution) and any time we want to preserve every
 *                     pixel of the source.
 *
 *   - "centre-crop" — crop the source to the target aspect, then scale to
 *                     target resolution. The dumb / mechanical version of
 *                     content-aware reframing — for face-tracked re-cropping
 *                     the agent should pipe the source through `face_reframe`
 *                     or Resolve `smart_reframe` BEFORE calling this tool.
 */

export type MultiFormat =
  | "youtube-1080p"
  | "shorts-9x16"
  | "reels-9x16"
  | "tiktok-9x16"
  | "square-1x1"
  | "instagram-4x5"
  | "twitter-16x9";

export const MULTI_FORMATS: readonly MultiFormat[] = [
  "youtube-1080p",
  "shorts-9x16",
  "reels-9x16",
  "tiktok-9x16",
  "square-1x1",
  "instagram-4x5",
  "twitter-16x9",
] as const;

export type MultiFormatTransform = "scale-pad" | "centre-crop";

interface PresetSpec {
  width: number;
  height: number;
  transform: MultiFormatTransform;
}

/**
 * Per-preset target resolution + default transform.
 *
 * Resolutions are platform-canonical: 1080p horizontal, 1080×1920 vertical,
 * 1080-square IG, 1080×1350 IG-portrait, 720p Twitter (their feed downsamples
 * anything taller anyway).
 */
const PRESETS: Record<MultiFormat, PresetSpec> = {
  "youtube-1080p": { width: 1920, height: 1080, transform: "scale-pad" },
  "shorts-9x16": { width: 1080, height: 1920, transform: "centre-crop" },
  "reels-9x16": { width: 1080, height: 1920, transform: "centre-crop" },
  "tiktok-9x16": { width: 1080, height: 1920, transform: "centre-crop" },
  "square-1x1": { width: 1080, height: 1080, transform: "centre-crop" },
  "instagram-4x5": { width: 1080, height: 1350, transform: "centre-crop" },
  "twitter-16x9": { width: 1280, height: 720, transform: "scale-pad" },
};

export function multiFormatSpec(format: MultiFormat): PresetSpec {
  const spec = PRESETS[format];
  if (!spec) {
    throw new Error(
      `unknown multi-format preset: ${format}; valid: ${Object.keys(PRESETS).join(", ")}`,
    );
  }
  return spec;
}

export interface BuildRenderFilterResult {
  targetW: number;
  targetH: number;
  vf: string;
  transform: MultiFormatTransform;
}

export interface BuildRenderFilterOptions {
  /**
   * If true, treat the source as already cropped to the target aspect (e.g.
   * via face_reframe / smart_reframe upstream). Forces a non-cropping
   * scale-pad regardless of the preset's default transform.
   */
  faceTracked?: boolean;
}

/**
 * Build the ffmpeg `-vf` filter for a single (source, preset) pair.
 *
 * Pure function — no side effects, no I/O. Used by `render_multi_format`
 * to compose ffmpeg args, and by the unit tests to lock the filter math.
 *
 * Math notes for centre-crop:
 *
 *   srcAR = srcW/srcH, tgtAR = Wt/Ht. The crop keeps the larger axis full.
 *
 *   - srcAR > tgtAR  ⇒  source is wider than target. Crop width.
 *       cropW = ih * Wt/Ht ; cropH = ih ; x = (iw - cropW)/2 ; y = 0
 *   - srcAR < tgtAR  ⇒  source is taller than target. Crop height.
 *       cropW = iw ; cropH = iw * Ht/Wt ; x = 0 ; y = (ih - cropH)/2
 *   - srcAR == tgtAR ⇒  no crop needed; emit `scale=Wt:Ht` only.
 *
 * Float crop dimensions are passed through to ffmpeg (which accepts them
 * and rounds internally); the trailing `scale=Wt:Ht` enforces the final
 * even-dimension target so x264 stays happy.
 */
export function buildRenderFilter(
  srcW: number,
  srcH: number,
  format: MultiFormat,
  opts: BuildRenderFilterOptions = {},
): BuildRenderFilterResult {
  if (!Number.isFinite(srcW) || srcW <= 0 || !Number.isFinite(srcH) || srcH <= 0) {
    throw new Error(`invalid source dimensions: ${srcW}x${srcH}`);
  }
  const spec = multiFormatSpec(format);
  const targetW = spec.width;
  const targetH = spec.height;
  const transform: MultiFormatTransform = opts.faceTracked ? "scale-pad" : spec.transform;

  if (transform === "scale-pad") {
    const vf =
      `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,` +
      `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black`;
    return { targetW, targetH, vf, transform };
  }

  // centre-crop
  const srcAR = srcW / srcH;
  const tgtAR = targetW / targetH;
  // Use a tiny tolerance so 1920x1080 vs perfectly-equal 16:9 sources round
  // to the no-crop branch; prevents emitting `crop=iw:ih:0:0`.
  const eps = 1e-6;
  if (Math.abs(srcAR - tgtAR) < eps) {
    return {
      targetW,
      targetH,
      vf: `scale=${targetW}:${targetH}`,
      transform,
    };
  }
  if (srcAR > tgtAR) {
    // crop width
    const cropW = formatNum((srcH * targetW) / targetH);
    const x = formatNum((srcW - (srcH * targetW) / targetH) / 2);
    const vf = `crop=${cropW}:${srcH}:${x}:0,scale=${targetW}:${targetH}`;
    return { targetW, targetH, vf, transform };
  }
  // srcAR < tgtAR — crop height
  const cropH = formatNum((srcW * targetH) / targetW);
  const y = formatNum((srcH - (srcW * targetH) / targetW) / 2);
  const vf = `crop=${srcW}:${cropH}:0:${y},scale=${targetW}:${targetH}`;
  return { targetW, targetH, vf, transform };
}

/**
 * Format a number for inclusion in an ffmpeg filter expression. Trims any
 * `.0` tail (e.g. 1080.0 → "1080") so integer paths remain integer-looking
 * in the filter graph; otherwise emits up to 2 decimals.
 */
function formatNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Two decimals is enough for any practical (W, H) from canonical sources;
  // the trailing `scale` rounds to the final integer target.
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
