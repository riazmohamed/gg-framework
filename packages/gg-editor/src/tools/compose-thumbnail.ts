import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";

const ComposeThumbnailParams = z.object({
  input: z.string().describe("Source video."),
  output: z.string().describe("Thumbnail .jpg or .png."),
  atSec: z.number().min(0).describe("Frame timestamp."),
  text: z.string().min(1).describe("Headline text overlay."),
  fontSize: z.number().int().min(8).optional().describe("Default 96."),
  fontColor: z.string().optional().describe("Hex RRGGBB. Default 'white'."),
  outlineColor: z
    .string()
    .optional()
    .describe("Outline hex RRGGBB. Default 'black'. Use empty string to disable."),
  position: z.enum(["top", "center", "bottom"]).optional().describe("Default 'bottom'."),
  fontFile: z
    .string()
    .optional()
    .describe(
      "Path to a TTF font file. ffmpeg drawtext requires this on most systems. " +
        "Default tries common system locations.",
    ),
  width: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional output width (height auto). Common: 1280 for YouTube."),
});

const SYSTEM_FONT_GUESSES = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "C:\\Windows\\Fonts\\Arial.ttf",
];

export function createComposeThumbnailTool(cwd: string): AgentTool<typeof ComposeThumbnailParams> {
  return {
    name: "compose_thumbnail",
    description:
      "Pull a frame and burn a text headline on top, in one shot. YouTube/TikTok thumbnail " +
      "generation. ffmpeg drawtext requires a TTF font path; we try common system locations " +
      "(macOS Helvetica, DejaVu on Linux, Arial on Windows) when fontFile isn't given. Default " +
      "is large white text with black outline at the bottom — readable at thumbnail scale.",
    parameters: ComposeThumbnailParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, args.input);
        const outAbs = resolvePath(cwd, args.output);
        const fontFile = args.fontFile ? resolvePath(cwd, args.fontFile) : pickFont();
        if (!fontFile) {
          return err(
            "no system font found",
            "pass fontFile=<path-to-.ttf> (try ~/Library/Fonts on macOS or /usr/share/fonts on Linux)",
          );
        }
        const fontSize = args.fontSize ?? 96;
        const fontColor = args.fontColor ?? "white";
        const outlineColor = args.outlineColor === "" ? "" : (args.outlineColor ?? "black");
        const pos = args.position ?? "bottom";
        const yExpr =
          pos === "top" ? "h*0.08" : pos === "center" ? "(h-text_h)/2" : "h-text_h-h*0.08";
        const safeText = escapeDrawtextValue(args.text);
        const drawText =
          `drawtext=fontfile=${escapeFilterPath(fontFile)}:` +
          `text='${safeText}':` +
          `fontsize=${fontSize}:` +
          `fontcolor=${fontColor}:` +
          `x=(w-text_w)/2:` +
          `y=${yExpr}` +
          (outlineColor ? `:bordercolor=${outlineColor}:borderw=4` : "");

        const vf = args.width ? `scale=${args.width}:-1,${drawText}` : drawText;
        mkdirSync(dirname(outAbs), { recursive: true });
        const r = await runFfmpeg(
          [
            "-ss",
            String(args.atSec),
            "-i",
            inAbs,
            "-frames:v",
            "1",
            "-vf",
            vf,
            "-q:v",
            "2",
            outAbs,
          ],
          { signal: ctx.signal },
        );
        if (r.code !== 0) {
          return err(
            `ffmpeg drawtext exited ${r.code}`,
            "verify atSec is in range and ffmpeg has --enable-libfreetype",
          );
        }
        return compact({ ok: true, path: outAbs, atSec: args.atSec, fontFile });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

function pickFont(): string | undefined {
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
 * Rules (verified against real-world implementations — GVCLab/CutClaw,
 * g0ldyy/comet, ehendrix23/tesla_dashcam):
 *   1. `\\` first  → `\\\\`
 *   2. `:`         → `\\:`
 *   3. `'`         → `\\'`
 *   4. `%`         → `\\%`  (because `%{...}` is used for runtime expansions like timecode)
 *   5. newlines    → literal `\\n` (drawtext renders `\\n` as a line break)
 *
 * Backslash MUST come first so subsequent escapes don't double-escape it.
 */
export function escapeDrawtextValue(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\r\n?|\n/g, "\\n");
}
