import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "./media/ffmpeg.js";

/**
 * Frame extraction helpers. Used by score_shot and (later) any other tool
 * that needs sampled frames.
 *
 * Two modes:
 *  - extractAtTimes: per-timestamp sampling (one ffmpeg call per frame). Slower
 *    but precise; agent picks exactly what to inspect.
 *  - extractAtInterval: regular sampling via the fps filter (one ffmpeg call
 *    total). Fast; ideal for "score this whole video".
 */

export interface ExtractedFrame {
  path: string;
  atSec: number;
}

export interface ExtractOptions {
  /** Output dir; defaults to a fresh temp dir. */
  outDir?: string;
  /** JPEG quality 1-31 (lower = better, ffmpeg convention). Default 4. */
  quality?: number;
  /** Optional max width to scale frames down to (saves vision tokens). */
  maxWidth?: number;
  signal?: AbortSignal;
}

/**
 * Extract one frame per requested timestamp. Returns paths in the same order.
 */
export async function extractAtTimes(
  inputPath: string,
  times: number[],
  opts: ExtractOptions = {},
): Promise<ExtractedFrame[]> {
  const dir = opts.outDir ?? mkdtempSync(join(tmpdir(), "gg-editor-frames-"));
  const q = String(opts.quality ?? 4);
  const out: ExtractedFrame[] = [];

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const path = join(dir, `frame-t${t.toFixed(3)}-${i.toString().padStart(4, "0")}.jpg`);
    const args = ["-ss", String(t), "-i", inputPath, "-frames:v", "1", "-q:v", q];
    if (opts.maxWidth) args.push("-vf", `scale=${opts.maxWidth}:-1`);
    args.push(path);

    const r = await runFfmpeg(args, { signal: opts.signal });
    if (r.code !== 0) {
      throw new Error(`ffmpeg failed extracting frame @${t}s: ${tail(r.stderr)}`);
    }
    out.push({ path, atSec: t });
  }
  return out;
}

/**
 * Extract one frame every `intervalSec`. Returns frames in temporal order.
 *
 * Single ffmpeg invocation regardless of how many frames are produced; way
 * faster than per-timestamp for whole-video sampling.
 */
export async function extractAtInterval(
  inputPath: string,
  intervalSec: number,
  totalSec: number,
  opts: ExtractOptions = {},
): Promise<ExtractedFrame[]> {
  if (intervalSec <= 0) throw new Error("intervalSec must be > 0");
  const dir = opts.outDir ?? mkdtempSync(join(tmpdir(), "gg-editor-frames-"));
  const q = String(opts.quality ?? 4);
  const pattern = join(dir, "frame-%04d.jpg");

  const filter = opts.maxWidth
    ? `fps=1/${intervalSec},scale=${opts.maxWidth}:-1`
    : `fps=1/${intervalSec}`;

  const r = await runFfmpeg(["-i", inputPath, "-vf", filter, "-q:v", q, pattern], {
    signal: opts.signal,
  });
  if (r.code !== 0) {
    throw new Error(`ffmpeg failed sampling frames: ${tail(r.stderr)}`);
  }

  // The fps filter starts the first frame at intervalSec/2 by ffmpeg
  // convention; agent code shouldn't rely on exact alignment. We compute
  // expected times as N * intervalSec offset by intervalSec/2.
  // We can also list the directory, but predicting timestamps avoids fs walk.
  const count = Math.floor(totalSec / intervalSec);
  const out: ExtractedFrame[] = [];
  for (let i = 1; i <= count; i++) {
    const path = join(dir, `frame-${i.toString().padStart(4, "0")}.jpg`);
    const atSec = (i - 0.5) * intervalSec;
    out.push({ path, atSec });
  }
  return out;
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}
