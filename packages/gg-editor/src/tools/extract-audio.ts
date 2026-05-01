import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@abukhaled/gg-agent";
import { clip, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";

const ExtractAudioParams = z.object({
  input: z.string(),
  output: z.string().describe(".wav recommended for downstream analysis."),
  sampleRate: z.number().int().optional().describe("Default 16000 (whisper-friendly)."),
});

export function createExtractAudioTool(cwd: string): AgentTool<typeof ExtractAudioParams> {
  return {
    name: "extract_audio",
    description:
      "Extract a video's audio as mono WAV (default 16kHz). First step for transcription, " +
      "silence detection, or audio analysis.",
    parameters: ExtractAudioParams,
    async execute({ input, output, sampleRate = 16000 }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      const inAbs = resolvePath(cwd, input);
      const outAbs = resolvePath(cwd, output);
      const r = await runFfmpeg(
        ["-i", inAbs, "-vn", "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_s16le", outAbs],
        { signal: ctx.signal },
      );
      if (r.code !== 0) {
        const tail = r.stderr.split("\n").filter(Boolean).slice(-3).join(" | ");
        return err(`ffmpeg exited ${r.code}: ${clip(tail, 200)}`);
      }
      return `ok:${outAbs}`;
    },
  };
}
