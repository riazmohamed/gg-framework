/**
 * Audio cleanup helpers — voice-noise reduction, de-essing, hum removal.
 *
 * All routes through ffmpeg filters. We expose a small set of "modes" so the
 * agent doesn't have to learn ffmpeg syntax:
 *   - denoise / denoise-strong: spectral noise gate (afftdn)
 *   - rnnoise: RNN-based noise removal (arnndn). Needs a model file; if none
 *     supplied we fall back to afftdn with a stronger setting.
 *   - dehum: notch out 50/60Hz mains hum
 *   - deess: tame harsh sibilance
 */
import { runFfmpeg } from "./media/ffmpeg.js";

export type CleanupMode = "denoise" | "denoise-strong" | "rnnoise" | "dehum" | "deess";

export interface CleanupOptions {
  /** Mains frequency for `dehum`. Default 50 (most of the world); use 60 for North America. */
  mainsHz?: 50 | 60;
  /** Path to an `arnndn` model (.rnnn). Required for `rnnoise` mode. */
  rnnoiseModel?: string;
  signal?: AbortSignal;
}

/**
 * Build the ffmpeg `-af` filter string for a cleanup mode. Pure function so
 * tests can verify the chain without spawning ffmpeg.
 */
export function buildCleanupFilter(mode: CleanupMode, opts: CleanupOptions = {}): string {
  switch (mode) {
    case "denoise":
      // Mild spectral gate. Good default for podcast room tone.
      return "afftdn=nr=12:nf=-25";
    case "denoise-strong":
      // Aggressive — will start to chew transients on bad source. Only use when
      // the noise floor is genuinely loud.
      return "afftdn=nr=24:nf=-20";
    case "rnnoise":
      if (!opts.rnnoiseModel) {
        // Fallback: stronger afftdn so the tool still produces output even
        // without a model file.
        return "afftdn=nr=20:nf=-22";
      }
      return `arnndn=m=${escapeFfPath(opts.rnnoiseModel)}`;
    case "dehum": {
      const f = opts.mainsHz === 60 ? 60 : 50;
      // Notch the fundamental + first three harmonics. Anchored Q for surgical
      // cuts that don't muddy the rest of the band.
      return [
        `anequalizer=f=${f}:width_type=h:width=10:g=-30`,
        `anequalizer=f=${f * 2}:width_type=h:width=10:g=-25`,
        `anequalizer=f=${f * 3}:width_type=h:width=10:g=-20`,
        `anequalizer=f=${f * 4}:width_type=h:width=10:g=-15`,
      ].join(",");
    }
    case "deess":
      // Sibilance lives 5-9kHz. Light shelf cut + dynamic compression on that band.
      return "deesser=i=0.6:m=0.5:f=0.5:s=o";
    default: {
      const _exhaustive: never = mode;
      throw new Error(`unknown cleanup mode: ${String(_exhaustive)}`);
    }
  }
}

/** Run a single cleanup pass on an audio/video file. Video stream is copied. */
export async function applyCleanup(
  inputPath: string,
  outputPath: string,
  mode: CleanupMode,
  opts: CleanupOptions = {},
): Promise<void> {
  const filter = buildCleanupFilter(mode, opts);
  const isWav = /\.wav$/i.test(outputPath);
  const args = [
    "-i",
    inputPath,
    "-af",
    filter,
    "-c:v",
    "copy",
    ...(isWav ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "192k"]),
    outputPath,
  ];
  const r = await runFfmpeg(args, { signal: opts.signal });
  if (r.code !== 0) {
    throw new Error(`ffmpeg ${mode} exited ${r.code}: ${tail(r.stderr)}`);
  }
}

function escapeFfPath(p: string): string {
  // ffmpeg filter args use ':' and '\' as separators; escape them.
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}
