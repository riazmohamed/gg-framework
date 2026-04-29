/**
 * Sidechain audio ducking via ffmpeg.
 *
 * Two inputs:
 *   - voice (or any "key" track that should be heard)
 *   - background (music / ambient)
 *
 * The voice's amplitude controls a compressor on the background, so when the
 * voice is loud the music gets quieter; when the voice is silent the music
 * comes back up. Standard podcast/YouTube technique.
 *
 * Filter graph:
 *   [bg][voice] sidechaincompress=threshold=...:ratio=...:attack=...:release=... [ducked]
 *   [voice][ducked] amix=inputs=2:duration=longest:weights=1 1 [out]
 *
 * Output is a single audio file (or video with a re-encoded audio stream when
 * the voice / bg inputs are videos). v1 mixes voice + ducked-bg; if you want
 * the voice to ride atop a video timeline, render this as the audio track and
 * import.
 */
import { runFfmpeg } from "./media/ffmpeg.js";

export interface DuckingOptions {
  /**
   * Sidechain threshold (linear amplitude, 0-1). When the voice exceeds
   * this, the compressor clamps the music. Default 0.02 — matches typical
   * dialogue average energy. Real-world podcast implementations cluster at
   * 0.012–0.03; below 0.02 even quiet voice triggers ducking, above 0.05
   * quiet conversation won't duck the music at all.
   */
  threshold?: number;
  /** Compression ratio. Default 8. */
  ratio?: number;
  /** Attack time in ms. Default 5. */
  attackMs?: number;
  /** Release time in ms. Default 250. */
  releaseMs?: number;
  /** Voice gain in linear amplitude. Default 1 (unchanged). */
  voiceGain?: number;
  /** Background gain (post-duck) in linear amplitude. Default 1. */
  bgGain?: number;
  signal?: AbortSignal;
}

export interface DuckingResult {
  output: string;
  filterGraph: string;
}

/**
 * Render a voice + background mix with the background ducked underneath the
 * voice. Both inputs may be audio or video files; the output is whatever
 * extension you give it (PCM .wav for max quality, .m4a/.aac for size).
 */
export async function duckAudio(
  voicePath: string,
  bgPath: string,
  outputPath: string,
  opts: DuckingOptions = {},
): Promise<DuckingResult> {
  const filterGraph = buildDuckingFilter(opts);
  const isWav = /\.wav$/i.test(outputPath);
  const args = [
    "-i",
    voicePath,
    "-i",
    bgPath,
    "-filter_complex",
    filterGraph,
    "-map",
    "[out]",
    ...(isWav ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "192k"]),
    outputPath,
  ];
  const r = await runFfmpeg(args, { signal: opts.signal });
  if (r.code !== 0) {
    throw new Error(`ffmpeg duckAudio exited ${r.code}: ${tail(r.stderr)}`);
  }
  return { output: outputPath, filterGraph };
}

/**
 * Pure builder for the sidechain filter graph. Exposed so tests can verify
 * the chain without spawning ffmpeg.
 */
export function buildDuckingFilter(opts: DuckingOptions = {}): string {
  const threshold = opts.threshold ?? 0.02;
  const ratio = opts.ratio ?? 8;
  const attackMs = opts.attackMs ?? 5;
  const releaseMs = opts.releaseMs ?? 250;
  const voiceGain = opts.voiceGain ?? 1;
  const bgGain = opts.bgGain ?? 1;
  // 0 = voice, 1 = bg. Sidechain expects [main][key].
  return [
    `[1:a]volume=${bgGain}[bgRaw]`,
    `[0:a]volume=${voiceGain}[voiceMain]`,
    `[voiceMain]asplit=2[voiceOut][voiceKey]`,
    `[bgRaw][voiceKey]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attackMs}:release=${releaseMs}[ducked]`,
    `[voiceOut][ducked]amix=inputs=2:duration=longest:dropout_transition=0:weights=1 1[out]`,
  ].join(";");
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}
