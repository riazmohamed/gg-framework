/**
 * Loudness measurement + normalization via ffmpeg's `loudnorm` filter (EBU R128).
 *
 * Two-pass workflow (the only one that actually hits the target consistently):
 *   1. Pass 1 runs loudnorm in print_format=json mode against the source; we
 *      parse the JSON block from stderr to learn measured I / TP / LRA / thresh.
 *   2. Pass 2 applies loudnorm with measured_* params + the desired target. The
 *      filter then linearises rather than dynamically compresses.
 *
 * Platform target presets (the ones agents actually need):
 *   - youtube / spotify / podcast: -14 LUFS, -1 dBTP, LRA 11
 *   - apple-podcasts: -16 LUFS, -1 dBTP, LRA 11
 *   - broadcast-r128: -23 LUFS, -1 dBTP, LRA 7
 *   - tiktok-instagram: -14 LUFS, -1 dBTP, LRA 11
 */
import { runFfmpeg } from "./media/ffmpeg.js";

export interface LoudnessTarget {
  /** Integrated loudness target (LUFS). Negative number, e.g. -14. */
  integratedLufs: number;
  /** True peak ceiling (dBTP). Default -1. */
  truePeakDb?: number;
  /** Loudness range target (LU). Default 11. */
  loudnessRange?: number;
}

export const PLATFORM_TARGETS: Record<string, LoudnessTarget> = {
  youtube: { integratedLufs: -14, truePeakDb: -1, loudnessRange: 11 },
  spotify: { integratedLufs: -14, truePeakDb: -1, loudnessRange: 11 },
  "apple-podcasts": { integratedLufs: -16, truePeakDb: -1, loudnessRange: 11 },
  podcast: { integratedLufs: -16, truePeakDb: -1, loudnessRange: 11 },
  "broadcast-r128": { integratedLufs: -23, truePeakDb: -1, loudnessRange: 7 },
  tiktok: { integratedLufs: -14, truePeakDb: -1, loudnessRange: 11 },
  instagram: { integratedLufs: -14, truePeakDb: -1, loudnessRange: 11 },
};

export interface LoudnessMeasurement {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  /** Offset ffmpeg recommends in pass 2 (dB). */
  targetOffset: number;
}

export interface LoudnormJson {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  output_i?: string;
  output_tp?: string;
  output_lra?: string;
  output_thresh?: string;
  normalization_type?: string;
  target_offset: string;
}

/**
 * Pass 1 — measure source loudness. Runs the filter in print_format=json mode
 * and discards the audio. Parses the JSON block ffmpeg writes to stderr.
 *
 * Pass `dualMono: true` for MONO sources (most podcasts). Without it loudnorm
 * under-measures mono content by ~3 LU and pass 2 over-corrects. The
 * `normalize_loudness` tool auto-detects this from probe output.
 */
export async function measureLoudness(
  inputPath: string,
  opts: { signal?: AbortSignal; dualMono?: boolean } = {},
): Promise<LoudnessMeasurement> {
  const dm = opts.dualMono ? ":dual_mono=true" : "";
  const r = await runFfmpeg(
    [
      "-i",
      inputPath,
      "-af",
      `loudnorm=I=-14:TP=-1:LRA=11${dm}:print_format=json`,
      "-f",
      "null",
      "-",
    ],
    { signal: opts.signal },
  );
  if (r.code !== 0) {
    throw new Error(`ffmpeg measureLoudness exited ${r.code}`);
  }
  const json = extractJsonBlock(r.stderr);
  if (!json) {
    throw new Error("could not parse loudnorm json block from ffmpeg stderr");
  }
  const parsed = JSON.parse(json) as LoudnormJson;
  return {
    inputI: numOrNan(parsed.input_i),
    inputTp: numOrNan(parsed.input_tp),
    inputLra: numOrNan(parsed.input_lra),
    inputThresh: numOrNan(parsed.input_thresh),
    targetOffset: numOrNan(parsed.target_offset),
  };
}

/**
 * Pass 2 — apply loudnorm with measured_* params + the chosen target. Writes a
 * new media file. Audio codec defaults to AAC for video, or PCM for .wav out.
 */
export async function applyLoudnorm(
  inputPath: string,
  outputPath: string,
  measurement: LoudnessMeasurement,
  target: LoudnessTarget,
  opts: { signal?: AbortSignal; dualMono?: boolean } = {},
): Promise<void> {
  const tp = target.truePeakDb ?? -1;
  const lra = target.loudnessRange ?? 11;
  const dm = opts.dualMono ? ":dual_mono=true" : "";
  const filter =
    `loudnorm=I=${target.integratedLufs}:TP=${tp}:LRA=${lra}` +
    `:measured_I=${measurement.inputI}` +
    `:measured_TP=${measurement.inputTp}` +
    `:measured_LRA=${measurement.inputLra}` +
    `:measured_thresh=${measurement.inputThresh}` +
    `:offset=${measurement.targetOffset}` +
    `:linear=true${dm}:print_format=summary`;

  const isWav = /\.wav$/i.test(outputPath);
  const args = [
    "-i",
    inputPath,
    "-af",
    filter,
    // Preserve video as-is; only re-encode audio.
    "-c:v",
    "copy",
    ...(isWav ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "192k"]),
    outputPath,
  ];
  const r = await runFfmpeg(args, { signal: opts.signal });
  if (r.code !== 0) {
    throw new Error(`ffmpeg applyLoudnorm exited ${r.code}: ${tail(r.stderr)}`);
  }
}

/** Extract the LAST {...} JSON block from a string. ffmpeg prints prefix lines. */
export function extractJsonBlock(s: string): string | undefined {
  // Walk balanced braces from the back so we get the final block, not any
  // earlier curly fragment in metadata.
  const close = s.lastIndexOf("}");
  if (close < 0) return undefined;
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const ch = s[i];
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      depth -= 1;
      if (depth === 0) return s.slice(i, close + 1);
    }
  }
  return undefined;
}

function numOrNan(s: string | undefined): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}
