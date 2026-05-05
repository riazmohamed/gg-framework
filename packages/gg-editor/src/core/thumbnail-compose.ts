/**
 * Pure helper for composing a single thumbnail frame: pull a frame at
 * `atSec` and burn a headline on top with ffmpeg drawtext.
 *
 * Extracted from compose-thumbnail.ts so `compose_thumbnail_variants`
 * can call the same logic three times without duplicating the drawtext
 * filter construction.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { runFfmpeg } from "./media/ffmpeg.js";

export interface ComposeThumbnailOpts {
  /** Source video path (already absolute or pre-resolved). */
  input: string;
  /** Output .jpg/.png absolute path. */
  output: string;
  /** Frame timestamp. */
  atSec: number;
  /** Headline text overlay (raw — escaping is handled internally). */
  text: string;
  /** Path to a TTF font; falls back to common system locations. */
  fontFile?: string;
  fontSize?: number;
  fontColor?: string;
  /** Empty string disables outline. Default 'black'. */
  outlineColor?: string;
  position?: "top" | "center" | "bottom";
  /** Optional output width (height auto). */
  width?: number;
  signal?: AbortSignal;
}

const SYSTEM_FONT_GUESSES = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "C:\\Windows\\Fonts\\Arial.ttf",
];

export interface ComposeThumbnailResult {
  ok: true;
  path: string;
  fontFile: string;
}

/**
 * Burn a headline onto a single frame from the source video and write
 * it to disk. Returns the resolved font path so callers can surface it
 * in their output.
 *
 * Throws on:
 *   - no system font found (and none provided)
 *   - ffmpeg drawtext exit ≠ 0
 */
export async function composeThumbnailFrame(
  opts: ComposeThumbnailOpts,
  cwd: string = process.cwd(),
): Promise<ComposeThumbnailResult> {
  const fontFile = opts.fontFile ? resolvePath(cwd, opts.fontFile) : pickFont();
  if (!fontFile) {
    throw new Error(
      "no system font found — pass fontFile=<path-to-.ttf> (~/Library/Fonts on macOS, /usr/share/fonts on Linux)",
    );
  }
  const fontSize = opts.fontSize ?? 96;
  const fontColor = opts.fontColor ?? "white";
  const outlineColor = opts.outlineColor === "" ? "" : (opts.outlineColor ?? "black");
  const pos = opts.position ?? "bottom";
  const yExpr =
    pos === "top" ? "h*0.08" : pos === "center" ? "(h-text_h)/2" : "h-text_h-h*0.08";
  const safeText = escapeDrawtextValue(opts.text);
  const drawText =
    `drawtext=fontfile=${escapeFilterPath(fontFile)}:` +
    `text='${safeText}':` +
    `fontsize=${fontSize}:` +
    `fontcolor=${fontColor}:` +
    `x=(w-text_w)/2:` +
    `y=${yExpr}` +
    (outlineColor ? `:bordercolor=${outlineColor}:borderw=4` : "");

  const vf = opts.width ? `scale=${opts.width}:-1,${drawText}` : drawText;
  mkdirSync(dirname(opts.output), { recursive: true });
  const r = await runFfmpeg(
    [
      "-ss",
      String(opts.atSec),
      "-i",
      opts.input,
      "-frames:v",
      "1",
      "-vf",
      vf,
      "-q:v",
      "2",
      opts.output,
    ],
    { signal: opts.signal },
  );
  if (r.code !== 0) {
    throw new Error(
      `ffmpeg drawtext exited ${r.code} — verify atSec is in range and ffmpeg has --enable-libfreetype`,
    );
  }
  return { ok: true, path: opts.output, fontFile };
}

export function pickFont(): string | undefined {
  for (const p of SYSTEM_FONT_GUESSES) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Escape a string for ffmpeg drawtext's `text='...'` parameter.
 *
 * Rules (verified against real-world implementations):
 *   1. `\\` first  → `\\\\`
 *   2. `:`         → `\\:`
 *   3. `'`         → `\\'`
 *   4. `%`         → `\\%`  (because `%{...}` is used for runtime expansions)
 *   5. newlines    → literal `\\n` (drawtext renders as a line break)
 *
 * Backslash MUST come first so subsequent escapes don't double-escape.
 */
export function escapeDrawtextValue(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\r\n?|\n/g, "\\n");
}
