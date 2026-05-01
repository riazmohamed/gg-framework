/**
 * Multicam clap-sync — first-transient alignment via ffmpeg silencedetect.
 *
 * v1 limitation: works only when each take starts with a clap, slate, or sharp
 * sound louder than the surrounding lead-in silence. For dialogue-only takes
 * with no slate, this tool can't align — that needs cross-correlation, deferred
 * to a future v2 (would require an FFT lib or numpy).
 */
import { runFfmpeg } from "./media/ffmpeg.js";
import { parseSilenceDetect } from "./silence.js";

export interface TransientResult {
  path: string;
  /** Seconds from file start where the first audible event begins, or null. */
  transientSec: number | null;
}

export interface MulticamSyncResult {
  /** Path used as the t=0 reference (transient closest to file start). */
  reference: string;
  results: Array<{
    path: string;
    /** Positive = file starts later than reference. null = no transient detected. */
    offsetSec: number | null;
    transientSec: number | null;
  }>;
  thresholdDb: number;
  /** Set if any input had no detectable transient. */
  warning?: string;
}

/**
 * Detect the first transient (end of leading silence) in a media file.
 *
 * Runs `silencedetect` with a strict noise floor and a long min-silence so the
 * lead-in counts as silence; the first `silence_end` is the first audible event.
 */
export async function detectFirstTransient(
  inputPath: string,
  opts: { thresholdDb?: number; minSilenceSec?: number; signal?: AbortSignal } = {},
): Promise<TransientResult> {
  const thresholdDb = opts.thresholdDb ?? -40;
  const minSilenceSec = opts.minSilenceSec ?? 0.5;
  const r = await runFfmpeg(
    [
      "-i",
      inputPath,
      "-af",
      `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}`,
      "-f",
      "null",
      "-",
    ],
    { signal: opts.signal },
  );
  if (r.code !== 0) {
    return { path: inputPath, transientSec: null };
  }
  const ranges = parseSilenceDetect(r.stderr);
  // The first range's endSec is the first transient (end of lead-in silence).
  const first = ranges[0];
  return {
    path: inputPath,
    transientSec: first ? first.endSec : null,
  };
}

/**
 * Align 2+ inputs by their first transient. Pick the input with the smallest
 * transient as reference (transient at t=0 in the synced timeline). Other
 * offsets = transient[i] - reference.transient.
 */
export async function multicamSync(
  inputPaths: string[],
  opts: { thresholdDb?: number; minSilenceSec?: number; signal?: AbortSignal } = {},
): Promise<MulticamSyncResult> {
  if (inputPaths.length === 0) {
    throw new Error("multicamSync: inputs is empty");
  }
  const thresholdDb = opts.thresholdDb ?? -40;
  const transients = await Promise.all(
    inputPaths.map((p) =>
      detectFirstTransient(p, {
        thresholdDb,
        minSilenceSec: opts.minSilenceSec,
        signal: opts.signal,
      }),
    ),
  );

  // Pick reference: smallest finite transient. If all null, fall back to first.
  const withTransient = transients.filter((t) => t.transientSec !== null);
  const reference =
    withTransient.length > 0
      ? withTransient.reduce((acc, t) =>
          (t.transientSec as number) < (acc.transientSec as number) ? t : acc,
        )
      : transients[0];
  const refSec = reference.transientSec ?? 0;

  const results = transients.map((t) => ({
    path: t.path,
    transientSec: t.transientSec,
    offsetSec: t.transientSec === null ? null : +(t.transientSec - refSec).toFixed(6),
  }));

  const missing = results.filter((r) => r.offsetSec === null);
  const warning =
    missing.length > 0
      ? `no transient detected for ${missing.length} of ${results.length} input(s); manual alignment needed`
      : undefined;

  return {
    reference: reference.path,
    results,
    thresholdDb,
    warning,
  };
}
