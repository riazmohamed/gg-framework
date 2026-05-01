/**
 * Two-pass video stabilization via ffmpeg's vidstabdetect + vidstabtransform.
 *
 * Pass 1: vidstabdetect analyses motion and writes a transforms file (.trf).
 * Pass 2: vidstabtransform applies the inverse motion to stabilize.
 *
 * Quality knobs:
 *   - shakiness (1-10, default 5): how shaky the input is. Higher = stronger detection.
 *   - smoothing (1-30, default 15): camera-path smoothing window in frames.
 *   - zoom (-10..10, default 0): output zoom percent. Stabilization shrinks
 *     the visible frame; positive zoom hides the resulting borders.
 *
 * Requires ffmpeg compiled with libvidstab. Most modern builds include it
 * (Homebrew, deb-multimedia, the static builds). We probe availability.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "./media/ffmpeg.js";

export interface StabilizeOptions {
  shakiness?: number;
  smoothing?: number;
  zoom?: number;
  signal?: AbortSignal;
}

/**
 * Run pass 1 (analyse) + pass 2 (transform). Returns the path of the
 * transforms file (kept for inspection / re-use).
 */
export async function stabilize(
  inputPath: string,
  outputPath: string,
  opts: StabilizeOptions = {},
): Promise<{ output: string; transformsPath: string }> {
  const shakiness = clamp(opts.shakiness ?? 5, 1, 10);
  const smoothing = clamp(opts.smoothing ?? 15, 1, 30);
  const zoom = clamp(opts.zoom ?? 0, -10, 10);

  const dir = mkdtempSync(join(tmpdir(), "gg-editor-stab-"));
  const trfPath = join(dir, "transforms.trf");

  // Pass 1
  const p1 = await runFfmpeg(
    [
      "-i",
      inputPath,
      "-vf",
      `vidstabdetect=shakiness=${shakiness}:result=${escapePath(trfPath)}`,
      "-f",
      "null",
      "-",
    ],
    { signal: opts.signal },
  );
  if (p1.code !== 0) {
    throw new Error(
      `vidstabdetect exited ${p1.code}. Ensure ffmpeg was compiled with libvidstab. ` +
        `tail: ${tail(p1.stderr)}`,
    );
  }

  // Pass 2 — preserve audio.
  const p2 = await runFfmpeg(
    [
      "-i",
      inputPath,
      "-vf",
      `vidstabtransform=input=${escapePath(trfPath)}:smoothing=${smoothing}:zoom=${zoom}`,
      "-c:a",
      "copy",
      outputPath,
    ],
    { signal: opts.signal },
  );
  if (p2.code !== 0) {
    throw new Error(`vidstabtransform exited ${p2.code}: ${tail(p2.stderr)}`);
  }
  return { output: outputPath, transformsPath: trfPath };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function escapePath(p: string): string {
  // ffmpeg filter args use ':' and '\' as separators; escape both.
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}
