import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentTool, StructuredToolResult } from "@abukhaled/gg-agent";
import { z } from "zod";
import { log } from "../core/logger.js";
import type { MotionBundle } from "../core/skills.js";
import {
  isMotionTechnicalReport,
  motionPath,
  motionRegistrationSchema,
  validateMotionManifest,
} from "./motion-review.js";

const exec = promisify(execFile);
const parameters = motionRegistrationSchema.omit({ depth: true, references: true });
const binariesSchema = z.object({
  ffmpeg: z.string().refine(path.isAbsolute),
  ffprobe: z.string().refine(path.isAbsolute),
});
const audioSchema = z.object({ streams: z.array(z.object({ codec_type: z.literal("audio") })) });
const levelsSchema = z.object({ input_i: z.string(), input_tp: z.string() });
const pixelsSchema = z.object({
  ok: z.literal(true),
  videoSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

type CommandOutput = { stdout: string; stderr: string };
/** A busy 15 s WebGL composition sampled at every transition measured ~130 s on an M4 Pro. */
const SOURCE_CHECK_MS = 240_000;
const STEP_MS = 120_000;
const findingSchema = z.object({
  code: z.string(),
  severity: z.string(),
  message: z.string().optional(),
  time: z.number().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  fixHint: z.string().optional(),
});
const sectionSchema = z.object({
  ok: z.boolean().optional(),
  errorCount: z.number().optional(),
  warningCount: z.number().optional(),
  samples: z.union([z.array(z.number()), z.number()]).optional(),
  findings: z.array(findingSchema).optional(),
});
const checkReportSchema = z.object({
  ok: z.boolean(),
  lint: sectionSchema.optional(),
  runtime: sectionSchema.optional(),
  layout: sectionSchema.optional(),
  motion: sectionSchema.optional(),
  contrast: sectionSchema.optional(),
});
const SECTIONS = ["lint", "runtime", "layout", "motion", "contrast"] as const;
const clip = (text: string, size: number): string =>
  text.length <= size ? text : `${text.slice(0, size - 1)}…`;

/**
 * `hf check --json` prints ~100 KB for a busy video. Give the agent what it acts on:
 * per-section counts, the first errors with where and when, warning types, and
 * renderer contract notes (e.g. undeclared fonts) that only appear on stderr.
 */
function summarizeSourceCheck(output: CommandOutput): string {
  let json: unknown;
  try {
    json = JSON.parse(output.stdout);
  } catch {
    return `${output.stdout}\n${output.stderr}`;
  }
  const parsed = checkReportSchema.safeParse(json);
  if (!parsed.success) return `${output.stdout}\n${output.stderr}`;
  const report = parsed.data;
  const lines = [`HyperFrames check: ${report.ok ? "passed" : "found problems"}`];
  // One line per problem and element; later sightings add times instead of lines.
  const errors = new Map<string, { line: string; times: number[] }>();
  const warnings = new Map<string, number>();
  for (const name of SECTIONS) {
    const section = report[name];
    if (!section) continue;
    const samples = Array.isArray(section.samples) ? section.samples.length : section.samples;
    lines.push(
      `${name}: ${section.errorCount ?? 0} errors, ${section.warningCount ?? 0} warnings` +
        (samples ? ` (${samples} samples)` : ""),
    );
    for (const finding of section.findings ?? []) {
      if (finding.severity !== "error") {
        const key = `${name} ${finding.code}`;
        warnings.set(key, (warnings.get(key) ?? 0) + 1);
        continue;
      }
      const key = `${name} ${finding.code} ${finding.selector ?? ""}`;
      const seen = errors.get(key);
      if (seen) {
        if (finding.time !== undefined) seen.times.push(finding.time);
        continue;
      }
      const where = [
        finding.selector ?? "",
        finding.text ? JSON.stringify(clip(finding.text, 40)) : "",
      ]
        .filter(Boolean)
        .join(" ");
      const fix = finding.fixHint ? ` Fix: ${clip(finding.fixHint, 200)}` : "";
      errors.set(key, {
        line: `- ${name} ${finding.code} ${where}: ${clip(finding.message ?? "", 200)}${fix}`,
        times: finding.time === undefined ? [] : [finding.time],
      });
    }
  }
  if (errors.size) {
    const shown = [...errors.values()].slice(0, 15);
    lines.push(`Errors (${shown.length} of ${errors.size} distinct problems listed):`);
    for (const { line, times } of shown) {
      const at = times.length
        ? ` [at ${times.slice(0, 4).join("s, ")}s${times.length > 4 ? " …" : ""}]`
        : "";
      lines.push(`${line}${at}`);
    }
  }
  if (warnings.size) {
    const types = [...warnings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    lines.push(`Warnings by type: ${types.map(([code, count]) => `${code} ×${count}`).join(", ")}`);
  }
  const notes = [
    ...new Set(
      output.stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("[StaticGuard]")),
    ),
  ];
  if (notes.length) lines.push("Renderer notes:", ...notes.map((note) => `- ${clip(note, 400)}`));
  return lines.join("\n");
}

/** One explicit check; the working agent sees the frames, with no separate model or approval loop. */
export function createMotionCheckTool(
  cwd: string,
  bundle: MotionBundle,
  limits: { sourceCheckMs?: number } = {},
): AgentTool<typeof parameters> {
  const sourceCheckMs = limits.sourceCheckMs ?? SOURCE_CHECK_MS;
  return {
    name: "motion_check",
    description:
      "Check a current rendered Motion video once: source lint/runtime/layout/contrast, decoded pixels, " +
      "and audio levels when present. Returns technical findings plus actual rendered images for YOU " +
      "to inspect against the video's plan and inputs. Supply representative action " +
      "windows (start/end seconds); for videos over 180 seconds select a range to inspect. " +
      "This does not approve creative quality or watch/listen to the full video. Do not repeat the " +
      "same checks manually or recheck an unchanged export. All paths must stay inside the workspace.",
    parameters,
    executionMode: "sequential",
    async execute(args, context): Promise<string | StructuredToolResult> {
      const started = Date.now();
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(330_000)]);
      const checks: { name: string; ok: boolean; details: string }[] = [];
      let config: string | undefined;
      let technical = false;
      try {
        const input = parameters.parse(args);
        signal.throwIfAborted();
        const project = await motionPath(cwd, input.project);
        const output = await motionPath(cwd, input.output);
        const holds = input.holds ? await motionPath(cwd, input.holds) : undefined;
        if (!(await fs.stat(project)).isDirectory()) throw new Error("Expected a project folder");
        const outputInfo = await fs.stat(output);
        if (!outputInfo.isFile() || outputInfo.size > 2 * 1024 ** 3)
          throw new Error("Expected a rendered video file under 2 GiB");
        const run = async (
          name: string,
          binary: string,
          argv: string[],
          options: { timeoutMs?: number; describe?: (output: CommandOutput) => string } = {},
        ): Promise<CommandOutput | null> => {
          const timeoutMs = options.timeoutMs ?? STEP_MS;
          const describe = options.describe ?? ((out) => `${out.stdout}\n${out.stderr}`);
          // A signal, not execFile's `timeout`: the launcher forwards SIGTERM and the CLI
          // then exits 0 with no report, which `timeout` would record as a pass.
          const step = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
          try {
            const result = await exec(binary, argv, {
              signal: step,
              maxBuffer: 8 * 1024 * 1024,
              windowsHide: true,
            });
            checks.push({ name, ok: true, details: describe(result).slice(0, 12_000) });
            return result;
          } catch (error) {
            signal.throwIfAborted();
            if (step.aborted) {
              checks.push({
                name,
                ok: false,
                details: `Did not finish within ${timeoutMs / 1000} s, so it produced no result.`,
              });
              return null;
            }
            // A failing check still prints its report; keep it so its findings can be acted on.
            const failed = error as Partial<CommandOutput>;
            const output = { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
            const details = output.stdout ? describe(output) : `${String(error)}\n${output.stderr}`;
            checks.push({ name, ok: false, details: details.slice(0, 12_000) });
            return null;
          }
        };
        const validate = (name: string, ok: boolean): void => {
          checks.push({ name, ok, details: ok ? "passed" : "Missing or failed check evidence" });
        };
        // HyperFrames check includes lint; running `hf lint` separately duplicates that work.
        const runtime = await run(
          "Runtime/layout/contrast (includes lint)",
          process.execPath,
          [bundle.launcher, "check", project, "--json", "--contrast", "--at-transitions"],
          { timeoutMs: sourceCheckMs, describe: summarizeSourceCheck },
        );
        validate(
          "Structured runtime report",
          runtime !== null && isMotionTechnicalReport(runtime.stdout),
        );
        const pixels = await run("Decoded pixel motion", process.execPath, [
          path.join(bundle.root, "bin", "motion-check.mjs"),
          output,
          ...(holds ? ["--holds", holds] : []),
          ...(input.slideshowRequested ? ["--slideshow-requested"] : []),
        ]);
        const pixelReport = pixels ? pixelsSchema.safeParse(JSON.parse(pixels.stdout)) : null;
        validate("Structured pixel report", pixelReport?.success === true);
        const binaries = await exec(
          process.execPath,
          [path.join(bundle.root, "bin", "media-binaries.mjs")],
          {
            signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
            maxBuffer: 64 * 1024,
            windowsHide: true,
          },
        );
        const { ffmpeg, ffprobe } = binariesSchema.parse(JSON.parse(binaries.stdout));
        const audio = await run("Audio metadata", ffprobe, [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-select_streams",
          "a",
          "-show_entries",
          "stream=codec_type",
          "-of",
          "json",
          output,
        ]);
        const streams = audio ? audioSchema.safeParse(JSON.parse(audio.stdout)) : null;
        validate("Structured audio report", streams?.success === true);
        if (streams?.success && streams.data.streams.length > 0) {
          const levels = await run("Audio levels", ffmpeg, [
            "-hide_banner",
            "-nostdin",
            "-xerror",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            output,
            "-vn",
            "-af",
            "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
            "-f",
            "null",
            "-",
          ]);
          if (levels) {
            const start = levels.stderr.lastIndexOf("\n{");
            const end = levels.stderr.indexOf("\n}", start);
            if (start < 0 || end < 0) throw new Error("Missing structured audio measurements");
            const measured = levelsSchema.parse(JSON.parse(levels.stderr.slice(start, end + 2)));
            const loudness = Number(measured.input_i);
            const peak = Number(measured.input_tp);
            // Measure, don't impose a new mix. Clipping is a failure; distribution-specific
            // loudness targets remain the user's contract.
            validate(
              "Audio is finite and not clipping",
              Number.isFinite(loudness) && Number.isFinite(peak) && peak <= 0,
            );
          }
        }
        const id = randomUUID();
        const directory = path.join(path.dirname(output), `.motion-review-${id}`);
        config = path.join(os.tmpdir(), `gg-motion-check-${id}.json`);
        await fs.writeFile(config, JSON.stringify({ windows: input.windows, range: input.range }), {
          flag: "wx",
          signal,
        });
        const frames = await run("Rendered frames", process.execPath, [
          path.join(bundle.root, "bin", "review-frames.mjs"),
          output,
          directory,
          config,
        ]);
        if (!frames)
          return JSON.stringify({ technical: false, output, checks, visual: "not inspected" });
        const evidence = await validateMotionManifest(
          directory,
          output,
          input.windows,
          signal,
          input.range,
        );
        validate(
          "Pixel report matches rendered frames",
          pixelReport?.success === true &&
            pixelReport.data.videoSha256 === evidence.manifest.video.sha256,
        );
        technical = checks.every((check) => check.ok);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                technical,
                output,
                checks,
                coverage: evidence.manifest.range,
                visual:
                  "Inspect the attached rendered frames against the video's plan and inputs. These are samples, not playback or audio listening. No creative approval has been granted.",
              }),
            },
            ...evidence.images.map((image) => ({
              type: "image" as const,
              mediaType: "image/jpeg",
              data: image.toString("base64"),
            })),
          ],
        };
      } catch (error) {
        if (context.signal.aborted) throw context.signal.reason;
        return JSON.stringify({
          technical: false,
          checks,
          error: String(error).slice(0, 4000),
          visual: "unverified",
        });
      } finally {
        if (config) await fs.rm(config, { force: true });
        log("INFO", "motion-check", "Output check finished", {
          project: args.project,
          output: args.output,
          elapsedMs: Date.now() - started,
          technical,
        });
      }
    },
  };
}
