import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import { buildEdl } from "../core/edl.js";
import {
  DEFAULT_FILLERS,
  detectFillerRanges,
  keepRangesFromFillers,
  keepRangesToFrameRanges,
  summarizeFillers,
} from "../core/filler-words.js";
import { compact, err } from "../core/format.js";
import { probeMedia } from "../core/media/ffmpeg.js";
import type { Transcript } from "../core/whisper.js";

const CutFillerWordsParams = z.object({
  transcript: z
    .string()
    .describe(
      "Path to a transcript JSON written by `transcribe(wordTimestamps=true)`. Must include " +
        "word-level timings — without them this tool can't locate the fillers. Returns an error otherwise.",
    ),
  sourceVideo: z
    .string()
    .describe(
      "The video the transcript was made from. Used as the source media in the emitted EDL " +
        "(reel name + frame rate detection).",
    ),
  fillers: z
    .array(z.string())
    .optional()
    .describe(
      `Custom filler vocabulary (case-insensitive, supports multi-word phrases). Defaults to ` +
        `[${DEFAULT_FILLERS.join(", ")}]. Override when the speaker's verbal tics differ — ` +
        `e.g. ["right?", "obviously"].`,
    ),
  aggressiveSingleWords: z
    .boolean()
    .optional()
    .describe(
      "When false, skip ambiguous single-word fillers (like, so, actually, basically, " +
        "literally, honestly, right) — useful when the speaker uses them substantively. " +
        "Default true.",
    ),
  paddingStartMs: z
    .number()
    .min(0)
    .optional()
    .describe("Lead-in padding so the cut doesn't clip the previous word's tail. Default 20ms."),
  paddingEndMs: z
    .number()
    .min(0)
    .optional()
    .describe("Lead-out padding so the cut doesn't clip the next word's head. Default 20ms."),
  mergeGapMs: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Adjacent fillers within this gap merge into one cut (avoids 3-frame keep clips). Default 150ms.",
    ),
  edlOutput: z
    .string()
    .optional()
    .describe("Path for the emitted .edl file (relative resolves to cwd). Defaults to a tempfile."),
  reel: z
    .string()
    .optional()
    .describe(
      "EDL reel name. Default = source video basename without extension (truncated to 8 chars).",
    ),
  frameRate: z
    .number()
    .positive()
    .optional()
    .describe("Override frame rate. Auto-detected from probe if omitted; 30 if probe fails."),
  /**
   * Returns the EDL path + summary stats but does NOT call import_edl.
   * The agent typically chains this tool to `import_edl(path)` separately
   * (so the user can review filler choices first).
   */
  dryRun: z
    .boolean()
    .optional()
    .describe(
      "If true (default), return the EDL path + stats without importing. The agent should " +
        "surface stats to the user before calling import_edl. Pass false to skip the review step.",
    ),
});

/**
 * cut_filler_words — the canonical "podcast / interview / vlog" cleanup
 * step. Read a word-timestamped transcript, find every filler-word
 * range, emit an EDL of KEEP ranges, write it, return stats.
 *
 * The agent's job is then to surface the stats ("removed 47 fillers,
 * 8.3s total — top: um (24), uh (15)"), wait for user OK, then call
 * import_edl(path) to apply the cuts.
 */
export function createCutFillerWordsTool(cwd: string): AgentTool<typeof CutFillerWordsParams> {
  return {
    name: "cut_filler_words",
    description:
      "Detect and remove filler words ('um', 'uh', 'you know', 'i mean', …) from a " +
      "word-timestamped transcript. Emits an EDL of KEEP ranges (the parts to keep, with " +
      "small padding so cuts don't clip syllables). REQUIRES word-level timings — call " +
      "transcribe(wordTimestamps=true) first. Returns {path, stats, keeps}; agent should " +
      "show the stats to the user, then import_edl(path) when approved. The single biggest " +
      "creator-time-saver on long-form talking-head content.",
    parameters: CutFillerWordsParams,
    async execute(args) {
      try {
        const transcriptAbs = resolvePath(cwd, args.transcript);
        const sourceAbs = resolvePath(cwd, args.sourceVideo);

        let raw: string;
        try {
          raw = readFileSync(transcriptAbs, "utf8");
        } catch (e) {
          return err(
            `cannot read transcript ${transcriptAbs}: ${(e as Error).message}`,
            "verify the transcript JSON exists",
          );
        }

        let transcript: Transcript;
        try {
          transcript = JSON.parse(raw) as Transcript;
        } catch (e) {
          return err(
            `transcript is not valid JSON: ${(e as Error).message}`,
            "regenerate via transcribe(wordTimestamps=true)",
          );
        }

        const hasWords = transcript.segments.some(
          (s) => Array.isArray(s.words) && s.words.length > 0,
        );
        if (!hasWords) {
          return err(
            "transcript has no word-level timings",
            "rerun transcribe(wordTimestamps=true) — without word timings we can't locate fillers",
          );
        }

        const fillers = detectFillerRanges(transcript, {
          fillers: args.fillers,
          aggressiveSingleWords: args.aggressiveSingleWords,
          paddingStartMs: args.paddingStartMs,
          paddingEndMs: args.paddingEndMs,
          mergeGapMs: args.mergeGapMs,
        });

        const probe = probeMedia(sourceAbs);
        const totalSec = probe?.durationSec ?? transcript.durationSec;
        const fps = args.frameRate ?? probe?.frameRate ?? 30;

        const keeps = keepRangesFromFillers(fillers, totalSec);
        const frameKeeps = keepRangesToFrameRanges(keeps, fps);

        if (frameKeeps.length === 0) {
          return err(
            "no keep ranges produced — fillers may cover the entire transcript",
            "broaden vocabulary or check word timings",
          );
        }

        const reelName =
          args.reel ?? basename(sourceAbs, extname(sourceAbs)).replace(/[^A-Za-z0-9_]/g, "_");

        const edl = buildEdl({
          title: `${basename(sourceAbs)} (filler-cut)`,
          frameRate: fps,
          events: frameKeeps.map((k) => ({
            reel: reelName,
            track: "B",
            sourceInFrame: k.startFrame,
            sourceOutFrame: k.endFrame,
            clipName: basename(sourceAbs),
          })),
        });

        const outAbs = args.edlOutput
          ? resolvePath(cwd, args.edlOutput)
          : join(mkdtempSync(join(tmpdir(), "gg-fillercut-")), "fillers.edl");
        if (args.edlOutput) mkdirSync(dirname(outAbs), { recursive: true });
        writeFileSync(outAbs, edl, "utf8");

        const stats = summarizeFillers(fillers);
        const dryRun = args.dryRun ?? true;

        return compact({
          path: outAbs,
          dryRun,
          stats,
          keeps: keeps.length,
          fps,
          totalSec,
          // Surface a short list so the agent can quote it back to the user.
          sample: fillers.slice(0, 10).map((f) => ({
            atSec: +f.startSec.toFixed(2),
            text: f.text,
          })),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
