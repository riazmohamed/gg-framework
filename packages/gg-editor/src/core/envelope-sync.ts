/**
 * Envelope-based cross-correlation for multicam alignment.
 *
 * Why not full FFT correlation? For editorial alignment we don't need
 * sub-millisecond precision — we need "the speaker says hello at t=2.4 here
 * and t=3.1 there, so file B leads A by 0.7s". The energy envelope (RMS in
 * 100ms blocks) is sufficient and far cheaper than full PCM correlation.
 *
 * Pipeline:
 *   1. ffmpeg extracts mono 16kHz PCM s16le to a temp file
 *   2. We read PCM as Int16Array, compute per-block RMS → Float64 envelope
 *   3. Time-domain cross-correlation against a reference within ±maxLagSec
 *   4. Peak position → lag in blocks → seconds
 *
 * This is the approach used by tools like PluralEyes for non-slate sync. It
 * works on dialogue, applause, music — anything with energy variation. It
 * fails on sustained tones (test patterns, drone) because there's no
 * envelope to correlate against.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLE_RATE = 16000;
const BLOCK_MS = 100;
const SAMPLES_PER_BLOCK = (SAMPLE_RATE * BLOCK_MS) / 1000; // 1600

export interface EnvelopeResult {
  path: string;
  envelope: Float64Array;
  /** Total file duration in seconds. */
  durationSec: number;
}

export interface EnvelopeSyncOptions {
  /** Search window in seconds. Larger = finds bigger drifts but slower. Default 10. */
  maxLagSec?: number;
  signal?: AbortSignal;
}

export interface EnvelopeSyncResult {
  reference: string;
  results: Array<{
    path: string;
    /** Positive = file starts later than reference. */
    offsetSec: number;
    /** 0..1 normalised correlation strength at the chosen lag. */
    confidence: number;
  }>;
  /** Set when ANY pair correlated below 0.3 (low-confidence alignment). */
  warning?: string;
}

/**
 * Extract a mono 16kHz RMS energy envelope. One value every 100ms.
 */
export async function extractEnvelope(
  inputPath: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EnvelopeResult> {
  const dir = mkdtempSync(join(tmpdir(), "gg-editor-env-"));
  const pcmPath = join(dir, "audio.pcm");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-y",
        "-i",
        inputPath,
        "-f",
        "s16le",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        pcmPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg PCM extract exited ${code}: ${stderr.slice(-300)}`)),
    );
  });

  const buf = readFileSync(pcmPath);
  const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
  const numBlocks = Math.floor(samples.length / SAMPLES_PER_BLOCK);
  const env = new Float64Array(numBlocks);
  for (let b = 0; b < numBlocks; b++) {
    let sumSq = 0;
    const off = b * SAMPLES_PER_BLOCK;
    for (let i = 0; i < SAMPLES_PER_BLOCK; i++) {
      const s = samples[off + i] / 32768;
      sumSq += s * s;
    }
    env[b] = Math.sqrt(sumSq / SAMPLES_PER_BLOCK);
  }
  // Normalize so different gain levels don't bias the correlation.
  let max = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > max) max = env[i];
  if (max > 0) {
    for (let i = 0; i < env.length; i++) env[i] /= max;
  }
  // Clean up the PCM file. The dir survives until process exit.
  try {
    statSync(pcmPath);
  } catch {
    /* */
  }
  return {
    path: inputPath,
    envelope: env,
    durationSec: samples.length / SAMPLE_RATE,
  };
}

/**
 * Find the lag (in blocks) at which envelope `a` best aligns with envelope `b`.
 * Searches ±maxLagBlocks. Returns peak lag and normalised Pearson correlation.
 *
 * Convention: maximises sum(a[i - lag] * b[i]). So:
 *   - Positive lag = `a` LEADS `b` (a's peaks happen at smaller indices than b's)
 *   - Negative lag = `a` TRAILS `b` (a's peaks happen at larger indices)
 *
 * Callers convert this to a wall-clock offset:
 *   offsetSec = -lagBlocks * blockSec
 * (positive offset = `a` started later than `b`).
 */
export function correlateEnvelopes(
  a: Float64Array,
  b: Float64Array,
  maxLagBlocks: number,
): { lagBlocks: number; correlation: number } {
  let bestLag = 0;
  let bestCorr = -Infinity;

  for (let lag = -maxLagBlocks; lag <= maxLagBlocks; lag++) {
    // a is shifted by `lag`; compare against b.
    // Iterate over indices i where both a[i - lag] and b[i] exist.
    const start = Math.max(0, lag);
    const end = Math.min(b.length, a.length + lag);
    if (end - start < 4) continue;
    let sumAB = 0;
    let sumAA = 0;
    let sumBB = 0;
    for (let i = start; i < end; i++) {
      const av = a[i - lag];
      const bv = b[i];
      sumAB += av * bv;
      sumAA += av * av;
      sumBB += bv * bv;
    }
    const denom = Math.sqrt(sumAA * sumBB);
    const corr = denom > 0 ? sumAB / denom : 0;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  return { lagBlocks: bestLag, correlation: bestCorr };
}

/**
 * Align 2+ inputs using envelope correlation. Reference is the first input.
 * For each non-reference input, compute the correlation lag and report the
 * offset in seconds.
 */
export async function envelopeSync(
  inputPaths: string[],
  opts: EnvelopeSyncOptions = {},
): Promise<EnvelopeSyncResult> {
  if (inputPaths.length === 0) {
    throw new Error("envelopeSync: inputs is empty");
  }
  const maxLagSec = opts.maxLagSec ?? 10;
  const maxLagBlocks = Math.round((maxLagSec * 1000) / BLOCK_MS);

  const envs = await Promise.all(
    inputPaths.map((p) => extractEnvelope(p, { signal: opts.signal })),
  );
  const ref = envs[0];

  const results: EnvelopeSyncResult["results"] = [{ path: ref.path, offsetSec: 0, confidence: 1 }];

  let lowConfidence = 0;
  for (let i = 1; i < envs.length; i++) {
    const e = envs[i];
    const { lagBlocks, correlation } = correlateEnvelopes(e.envelope, ref.envelope, maxLagBlocks);
    // lagBlocks > 0 means we shifted e RIGHT to match ref → e starts EARLIER
    // than ref → its offset relative to ref is NEGATIVE.
    const offsetSec = -lagBlocks * (BLOCK_MS / 1000);
    const confidence = Math.max(0, correlation);
    if (confidence < 0.3) lowConfidence += 1;
    results.push({
      path: e.path,
      offsetSec: +offsetSec.toFixed(3),
      confidence: +confidence.toFixed(3),
    });
  }

  return {
    reference: ref.path,
    results,
    warning:
      lowConfidence > 0
        ? `${lowConfidence} of ${results.length - 1} pair(s) correlated below 0.3 \u2014 alignment uncertain`
        : undefined,
  };
}
