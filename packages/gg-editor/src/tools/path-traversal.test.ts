/**
 * Path-traversal guard tests.
 *
 * Each tool that accepts an agent-supplied `output` path must refuse
 * `../../etc/passwd`-style traversal attempts.  The guard lives in
 * `safeOutputPath()` (src/core/safe-paths.ts); the tools wrap their
 * execute body in try/catch and return `err(...)` on throw.
 *
 * detect-silence and analyze-hook have no `output` parameter — they are
 * read-only analysis tools.  Their entries below confirm this and verify
 * that passing a rogue value through the schema is silently dropped (Zod
 * strips unknown keys by default).
 */

import { describe, expect, it, vi } from "vitest";
import { createAddFadesTool } from "./add-fades.js";
import { createAddSfxAtCutsTool } from "./add-sfx-at-cuts.js";
import { createAnalyzeHookTool } from "./analyze-hook.js";
import { createBurnSubtitlesTool } from "./burn-subtitles.js";
import { createCleanAudioTool } from "./clean-audio.js";
import { createCrossfadeVideosTool } from "./crossfade-videos.js";
import { createDetectSilenceTool } from "./detect-silence.js";
import { createExtractAudioTool } from "./extract-audio.js";
import { createKenBurnsTool } from "./ken-burns.js";
import { createLoopMatchShortTool } from "./loop-match-short.js";
import { createMixAudioTool } from "./mix-audio.js";
import { createNormalizeLoudnessTool } from "./normalize-loudness.js";
import { createPunchInTool } from "./punch-in.js";
import { createRenderTool } from "./render.js";
import { createSpeedRampTool } from "./speed-ramp.js";
import { createStabilizeVideoTool } from "./stabilize-video.js";
import { createTransitionVideosTool } from "./transition-videos.js";
import type { VideoHost } from "../core/hosts/types.js";

// ---------------------------------------------------------------------------
// Mocks — prevent any real ffmpeg / OpenAI calls.
// ---------------------------------------------------------------------------

vi.mock("../core/media/ffmpeg.js", () => ({
  checkFfmpeg: vi.fn(() => true),
  probeMedia: vi.fn(() => ({
    durationSec: 10,
    frameRate: 30,
    width: 1920,
    height: 1080,
    audioCodec: "aac",
    videoCodec: "h264",
  })),
  runFfmpeg: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
}));

vi.mock("../core/bundled-sfx.js", async () => {
  /* eslint-disable @typescript-eslint/consistent-type-imports */
  const actual =
    await vi.importActual<typeof import("../core/bundled-sfx.js")>("../core/bundled-sfx.js");
  /* eslint-enable @typescript-eslint/consistent-type-imports */
  return {
    ...actual,
    resolveSfx: vi.fn(async () => ({ path: "/tmp/sfx.wav", bundled: true, name: "whoosh" })),
  };
});

vi.mock("../core/hook-analysis.js", () => ({
  runHookVision: vi.fn(async () => ({
    onScreenText: false,
    motion: false,
    subjectClarity: false,
    emotionalIntensity: false,
  })),
  buildHookResult: vi.fn(() => ({
    score: 50,
    passes: false,
    findings: [],
    why: "",
    speechAt0_5s: false,
    onScreenText: false,
    motion: false,
    subjectClarity: false,
    emotionalIntensity: false,
  })),
  speechAt0_5sScore: vi.fn(() => false),
}));

vi.mock("../core/frames.js", () => ({
  extractAtTimes: vi.fn(async () => [
    { path: "/tmp/f1.jpg", timeSec: 0.5 },
    { path: "/tmp/f2.jpg", timeSec: 2.5 },
  ]),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRAVERSAL = "../../etc/passwd";
const SAFE_CWD = "/tmp/gg-test-safe-cwd";

/** Shared ctx stub accepted by all tool execute() calls. */
const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as never;

function isErrorResult(result: unknown): boolean {
  return typeof result === "string" && result.startsWith("error:");
}

// ---------------------------------------------------------------------------
// Tools with an `output` parameter — must reject path traversal.
// ---------------------------------------------------------------------------

describe("path-traversal guard — tools with output param", () => {
  it("add_fades rejects traversal output", async () => {
    const tool = createAddFadesTool(SAFE_CWD);
    const result = await tool.execute(
      { input: "clip.mp4", output: TRAVERSAL, fadeInSec: 0.5, fadeOutSec: 0 },
      ctx,
    );
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("transition_videos rejects traversal output", async () => {
    const tool = createTransitionVideosTool(SAFE_CWD);
    const result = await tool.execute(
      { inputA: "a.mp4", inputB: "b.mp4", output: TRAVERSAL, preset: "crossfade" },
      ctx,
    );
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("crossfade_videos rejects traversal output", async () => {
    const tool = createCrossfadeVideosTool(SAFE_CWD);
    const result = await tool.execute(
      { inputA: "a.mp4", inputB: "b.mp4", output: TRAVERSAL, durationSec: 0.5 },
      ctx,
    );
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("speed_ramp rejects traversal output", async () => {
    const tool = createSpeedRampTool(SAFE_CWD);
    const result = await tool.execute(
      {
        input: "clip.mp4",
        output: TRAVERSAL,
        points: [
          { atSec: 0, speed: 1 },
          { atSec: 5, speed: 2 },
        ],
      },
      ctx,
    );
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("ken_burns rejects traversal output", async () => {
    const tool = createKenBurnsTool(SAFE_CWD);
    const result = await tool.execute(
      { input: "photo.jpg", output: TRAVERSAL, durationSec: 3 },
      ctx,
    );
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("burn_subtitles rejects traversal output", async () => {
    const tool = createBurnSubtitlesTool(SAFE_CWD);
    const result = await tool.execute(
      { input: "clip.mp4", subtitles: "subs.srt", output: TRAVERSAL },
      ctx,
    );
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("extract_audio rejects traversal output", async () => {
    const tool = createExtractAudioTool(SAFE_CWD);
    const result = await tool.execute({ input: "clip.mp4", output: TRAVERSAL }, ctx);
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("loop_match_short rejects traversal output", async () => {
    const tool = createLoopMatchShortTool(SAFE_CWD);
    const result = await tool.execute({ input: "clip.mp4", output: TRAVERSAL }, ctx);
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("punch_in rejects traversal output", async () => {
    const tool = createPunchInTool(SAFE_CWD);
    const result = await tool.execute(
      {
        input: "clip.mp4",
        output: TRAVERSAL,
        ranges: [{ startSec: 0, endSec: 2, zoom: 1.1 }],
      },
      ctx,
    );
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("add_sfx_at_cuts rejects traversal output", async () => {
    const tool = createAddSfxAtCutsTool(SAFE_CWD);
    const result = await tool.execute(
      { input: "clip.mp4", sfx: "whoosh", output: TRAVERSAL, cutPoints: [1, 3] },
      ctx,
    );
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  // ── Newly-hardened tools (previously called resolvePath directly). ──

  it("normalize_loudness rejects traversal output", async () => {
    const tool = createNormalizeLoudnessTool(SAFE_CWD);
    const result = await tool.execute(
      { input: "clip.wav", output: TRAVERSAL, platform: "youtube" },
      ctx,
    );
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("clean_audio rejects traversal output", async () => {
    const tool = createCleanAudioTool(SAFE_CWD);
    const result = await tool.execute(
      { input: "clip.wav", output: TRAVERSAL, mode: "denoise" },
      ctx,
    );
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("stabilize_video rejects traversal output", async () => {
    const tool = createStabilizeVideoTool(SAFE_CWD);
    const result = await tool.execute({ input: "clip.mp4", output: TRAVERSAL }, ctx);
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("mix_audio rejects traversal output", async () => {
    const tool = createMixAudioTool(SAFE_CWD);
    const result = await tool.execute({ input: "clip.wav", output: TRAVERSAL }, ctx);
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
  });

  it("render rejects traversal output", async () => {
    // Stub host — traversal throws before render() is invoked.
    const fakeHost = {
      render: vi.fn(async () => {}),
    } as unknown as VideoHost;
    const tool = createRenderTool(fakeHost, SAFE_CWD);
    const result = await tool.execute({ preset: "YouTube 1080p", output: TRAVERSAL }, ctx);
    expect(isErrorResult(result)).toBe(true);
    expect(result).toMatch(/outside allowed roots/);
    expect(fakeHost.render).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Read-only tools — no `output` parameter, so no traversal risk.
// Verify the tool schema does not expose an output field.
// ---------------------------------------------------------------------------

describe("path-traversal guard — read-only tools (no output param)", () => {
  it("detect_silence schema has no output field", () => {
    const tool = createDetectSilenceTool(SAFE_CWD);
    const shape = tool.parameters.shape;
    expect(shape).not.toHaveProperty("output");
  });

  it("analyze_hook schema has no output field", () => {
    const tool = createAnalyzeHookTool(SAFE_CWD);
    const shape = tool.parameters.shape;
    expect(shape).not.toHaveProperty("output");
  });
});
