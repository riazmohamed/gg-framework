/**
 * Audio mixing chain — EQ, compressor, gate, reverb, de-esser, limiter.
 *
 * File-only path: pure ffmpeg filter strings, mirroring `audio-cleanup.ts`
 * but with parameter knobs the agent can tune per-clip. We expose this as
 * a single "chain" so the agent can express a full mixing decision in one
 * call (e.g. "vocal preset = highpass 80Hz + 3dB peak at 5kHz + 4:1 comp +
 * -1dB ceiling limiter").
 *
 * All filters confirmed present in stock Homebrew ffmpeg:
 *   - equalizer / highpass / lowpass — eq bands
 *   - acompressor — compressor
 *   - agate — gate
 *   - aecho / aphaser — pseudo-reverb
 *   - alimiter — brick-wall limiter
 *   - adynamicequalizer — de-esser (5-9 kHz dynamic shelf)
 *
 * Real-world reference for filter syntax: ffmpeg-filters man page +
 * jiaaro/pydub's effect chains + scottcjn/bottube's mixing helpers.
 */

import { runFfmpeg } from "./media/ffmpeg.js";

export interface EqBand {
  /** Filter type. */
  type: "low" | "high" | "peak" | "shelf-low" | "shelf-high";
  /** Center / cutoff frequency in Hz. */
  freqHz: number;
  /** Gain in dB (peak / shelf only; ignored for low/high pass). */
  gainDb?: number;
  /** Bandwidth Q-factor. Default 1. Higher = narrower band. */
  q?: number;
}

export interface Compressor {
  /** Threshold in dB below which the comp doesn't act. -18 to -10 typical for voice. */
  thresholdDb: number;
  /** Ratio. 4 = 4:1 = strong voice control. */
  ratio: number;
  /** Attack in ms. Default 20. */
  attackMs?: number;
  /** Release in ms. Default 250. */
  releaseMs?: number;
  /** Makeup gain in dB. Default 0. */
  makeupDb?: number;
}

export interface Gate {
  /** Below threshold the signal is attenuated. -50 dB cuts most room tone. */
  thresholdDb: number;
  /** Ratio. Higher = more aggressive cut. Default 5. */
  ratio?: number;
  attackMs?: number;
  releaseMs?: number;
}

export interface Reverb {
  /** 0..1; how big the room sounds. */
  roomSize: number;
  /** 0..1; balance. 0 = dry, 1 = all wet. */
  wetDryMix: number;
}

export interface Limiter {
  /** Output ceiling in dB. -1 dBTP is the YouTube/Spotify-friendly default. */
  ceilingDb: number;
  releaseMs?: number;
}

export interface DeEsser {
  /** Frequency in Hz where sibilance lives. Default 6500. */
  freqHz?: number;
  /** Threshold in dB above which the dynamic shelf engages. Default -25. */
  thresholdDb?: number;
}

export interface AudioChain {
  eq?: EqBand[];
  compressor?: Compressor;
  gate?: Gate;
  reverb?: Reverb;
  deess?: DeEsser;
  limiter?: Limiter;
}

/**
 * Build the ffmpeg `-af` filter string for a chain. Pure function — tests
 * verify the full string assembly without spawning ffmpeg.
 *
 * Order: gate → eq → de-esser → compressor → reverb → limiter. This matches
 * the conventional mixing console order: clean noise out first, shape tone,
 * tame dynamics, add ambience, then catch peaks.
 */
export function buildMixFilter(chain: AudioChain): string {
  const parts: string[] = [];

  if (chain.gate) {
    const g = chain.gate;
    parts.push(
      [
        `agate`,
        `threshold=${dbToLinear(g.thresholdDb)}`,
        `ratio=${g.ratio ?? 5}`,
        `attack=${g.attackMs ?? 20}`,
        `release=${g.releaseMs ?? 250}`,
      ].join(":"),
    );
  }

  if (chain.eq && chain.eq.length > 0) {
    for (const band of chain.eq) {
      parts.push(buildEqBand(band));
    }
  }

  if (chain.deess) {
    // adynamicequalizer is the modern, present-everywhere de-esser. Ranged
    // shelf around the sibilance frequency.
    const f = chain.deess.freqHz ?? 6500;
    const t = chain.deess.thresholdDb ?? -25;
    parts.push(
      // mode=cutabove → attenuate the target band when detection exceeds
      // threshold. This is the canonical de-esser shape (sibilance pokes
      // above threshold → shelf cuts it). Valid modes on ffmpeg ≥ 5 are:
      // listen | cutbelow | cutabove | boostbelow | boostabove. The older
      // `mode=cut` alias was never accepted — it errors with "Undefined
      // constant or missing '('".
      `adynamicequalizer=dfrequency=${f}:dqfactor=2:tfrequency=${f}:tqfactor=2:threshold=${dbToLinear(t)}:ratio=4:mode=cutabove:tftype=highshelf`,
    );
  }

  if (chain.compressor) {
    const c = chain.compressor;
    parts.push(
      [
        `acompressor`,
        `threshold=${dbToLinear(c.thresholdDb)}`,
        `ratio=${c.ratio}`,
        `attack=${c.attackMs ?? 20}`,
        `release=${c.releaseMs ?? 250}`,
        `makeup=${c.makeupDb ?? 0}`,
      ].join(":"),
    );
  }

  if (chain.reverb) {
    const r = chain.reverb;
    // aecho-based pseudo-reverb. Real reverb requires SoX or impulse response
    // filtering, which Homebrew ffmpeg doesn't ship. The aecho approximation
    // is good enough for "this should sound like a room" at the agent level.
    const delays = roomSizeToDelays(r.roomSize);
    const decays = roomSizeToDecays(r.roomSize);
    const inGain = 1 - r.wetDryMix * 0.5;
    const outGain = 0.5 + r.wetDryMix * 0.5;
    parts.push(
      `aecho=in_gain=${fmt(inGain)}:out_gain=${fmt(outGain)}:delays=${delays}:decays=${decays}`,
    );
  }

  if (chain.limiter) {
    const l = chain.limiter;
    parts.push(
      [
        `alimiter`,
        `level_in=1`,
        `level_out=1`,
        `limit=${dbToLinear(l.ceilingDb)}`,
        `attack=5`,
        `release=${l.releaseMs ?? 50}`,
        `level=disabled`,
      ].join(":"),
    );
  }

  if (parts.length === 0) {
    throw new Error("buildMixFilter: empty chain — supply at least one effect");
  }
  return parts.join(",");
}

function buildEqBand(band: EqBand): string {
  const q = band.q ?? 1;
  const w = q;
  switch (band.type) {
    case "low":
      // Low-pass: cut content above freqHz.
      return `lowpass=f=${band.freqHz}`;
    case "high":
      return `highpass=f=${band.freqHz}`;
    case "peak":
      return `equalizer=f=${band.freqHz}:t=q:w=${w}:g=${band.gainDb ?? 0}`;
    case "shelf-low":
      return `bass=g=${band.gainDb ?? 0}:f=${band.freqHz}:w=${w}`;
    case "shelf-high":
      return `treble=g=${band.gainDb ?? 0}:f=${band.freqHz}:w=${w}`;
    default: {
      const _exhaustive: never = band.type;
      throw new Error(`unknown eq band type: ${String(_exhaustive)}`);
    }
  }
}

/** dB → linear scalar for ffmpeg threshold/ceiling args. */
function dbToLinear(db: number): string {
  return fmt(Math.pow(10, db / 20));
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, "");
}

function roomSizeToDelays(roomSize: number): string {
  // Map 0..1 → a delay pair from a small bedroom to a large hall.
  const small = Math.max(40, Math.round(20 + roomSize * 80));
  const large = Math.max(120, Math.round(100 + roomSize * 800));
  return `${small}|${large}`;
}

function roomSizeToDecays(roomSize: number): string {
  const a = (0.2 + roomSize * 0.4).toFixed(2);
  const b = (0.1 + roomSize * 0.3).toFixed(2);
  return `${a}|${b}`;
}

/** Apply a mixing chain to one input file. Video stream is copied. */
export async function applyMix(
  inputPath: string,
  outputPath: string,
  chain: AudioChain,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const filter = buildMixFilter(chain);
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
    throw new Error(`ffmpeg mix exited ${r.code}: ${tail(r.stderr)}`);
  }
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}
