import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FfmpegResult, MediaProbe } from "../core/media/ffmpeg.js";
import { createRenderMultiFormatTool } from "./render-multi-format.js";

function makeCtx(signal?: AbortSignal) {
  return {
    signal: signal ?? new AbortController().signal,
    toolCallId: "test",
  } as Parameters<ReturnType<typeof createRenderMultiFormatTool>["execute"]>[1];
}

function mkScratch(): string {
  return mkdtempSync(join(tmpdir(), "gg-multifmt-"));
}

const fakeProbe: MediaProbe = {
  durationSec: 30,
  width: 1920,
  height: 1080,
  frameRate: 30,
  videoCodec: "h264",
  audioCodec: "aac",
};

interface RunCall {
  args: string[];
  startedAt: number;
  finishedAt: number;
  signal?: AbortSignal;
}

function makeMockRunner(opts: {
  delayMs?: number;
  failFor?: (args: string[]) => boolean;
  // tracks concurrent invocations
  liveCounterRef?: { value: number; max: number };
}) {
  const calls: RunCall[] = [];
  const runner = async (
    args: string[],
    runOpts: { signal?: AbortSignal } = {},
  ): Promise<FfmpegResult> => {
    const startedAt = Date.now();
    if (opts.liveCounterRef) {
      opts.liveCounterRef.value++;
      opts.liveCounterRef.max = Math.max(opts.liveCounterRef.max, opts.liveCounterRef.value);
    }
    try {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const fail = opts.failFor?.(args) ?? false;
      const finishedAt = Date.now();
      calls.push({ args, startedAt, finishedAt, signal: runOpts.signal });
      return { code: fail ? 1 : 0, stdout: "", stderr: fail ? "boom" : "" };
    } finally {
      if (opts.liveCounterRef) opts.liveCounterRef.value--;
    }
  };
  return { runner, calls };
}

describe("render_multi_format — argument composition", () => {
  it("composes correct ffmpeg args per format with defaults", async () => {
    const cwd = mkScratch();
    const { runner, calls } = makeMockRunner({});
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: runner,
      probeMedia: () => fakeProbe,
      checkFfmpeg: () => true,
    });

    const out = await tool.execute(
      {
        input: "in.mp4",
        outputDir: "out",
        formats: ["youtube-1080p", "shorts-9x16"],
      },
      makeCtx(),
    );

    expect(typeof out).toBe("string");
    const parsed = JSON.parse(out as string);
    expect(parsed.count).toBe(2);
    expect(parsed.outputs).toHaveLength(2);
    expect(parsed.outputs[0]).toMatchObject({
      format: "youtube-1080p",
      ok: true,
      widthxheight: "1920x1080",
      transform: "scale-pad",
    });
    expect(parsed.outputs[1]).toMatchObject({
      format: "shorts-9x16",
      ok: true,
      widthxheight: "1080x1920",
      transform: "centre-crop",
    });

    expect(calls).toHaveLength(2);
    const ytArgs = calls.find((c) => c.args.some((a) => a.includes("youtube-1080p")))!.args;
    expect(ytArgs).toContain("-c:v");
    expect(ytArgs[ytArgs.indexOf("-c:v") + 1]).toBe("libx264");
    expect(ytArgs[ytArgs.indexOf("-crf") + 1]).toBe("20");
    expect(ytArgs[ytArgs.indexOf("-b:a") + 1]).toBe("192k");
    expect(ytArgs[ytArgs.indexOf("-preset") + 1]).toBe("medium");
    // -vf for youtube is the scale-pad form
    const vf = ytArgs[ytArgs.indexOf("-vf") + 1];
    expect(vf).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(vf).toContain("pad=1920:1080");
    // output path lives in outputDir with format-suffix
    const outPath = ytArgs[ytArgs.length - 1];
    expect(outPath.endsWith("in.youtube-1080p.mp4")).toBe(true);
  });

  it("honours custom codec / crf / audioBitrate", async () => {
    const cwd = mkScratch();
    const { runner, calls } = makeMockRunner({});
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: runner,
      probeMedia: () => fakeProbe,
      checkFfmpeg: () => true,
    });
    await tool.execute(
      {
        input: "in.mp4",
        outputDir: "out",
        formats: ["square-1x1"],
        videoCodec: "libx265",
        crf: 28,
        audioBitrate: "128k",
      },
      makeCtx(),
    );
    const a = calls[0].args;
    expect(a[a.indexOf("-c:v") + 1]).toBe("libx265");
    expect(a[a.indexOf("-crf") + 1]).toBe("28");
    expect(a[a.indexOf("-b:a") + 1]).toBe("128k");
  });

  it("dedupes duplicate format entries while keeping first occurrence order", async () => {
    const cwd = mkScratch();
    const { runner, calls } = makeMockRunner({});
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: runner,
      probeMedia: () => fakeProbe,
      checkFfmpeg: () => true,
    });
    const out = await tool.execute(
      {
        input: "in.mp4",
        outputDir: "out",
        formats: ["square-1x1", "square-1x1", "shorts-9x16"],
      },
      makeCtx(),
    );
    const parsed = JSON.parse(out as string);
    expect(parsed.outputs.map((o: { format: string }) => o.format)).toEqual([
      "square-1x1",
      "shorts-9x16",
    ]);
    expect(calls).toHaveLength(2);
  });

  it("emits a warning when faceTracked=true and uses scale-pad for verticals", async () => {
    const cwd = mkScratch();
    const { runner, calls } = makeMockRunner({});
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: runner,
      probeMedia: () => fakeProbe,
      checkFfmpeg: () => true,
    });
    const out = await tool.execute(
      {
        input: "in.mp4",
        outputDir: "out",
        formats: ["shorts-9x16"],
        faceTracked: true,
      },
      makeCtx(),
    );
    const parsed = JSON.parse(out as string);
    expect(parsed.warning).toMatch(/faceTracked/);
    const vf = calls[0].args[calls[0].args.indexOf("-vf") + 1];
    expect(vf).toContain("scale=1080:1920:force_original_aspect_ratio=decrease");
  });
});

describe("render_multi_format — parallelism", () => {
  it("runs at most 3 ffmpeg processes concurrently when parallel=true", async () => {
    const cwd = mkScratch();
    const counter = { value: 0, max: 0 };
    const { runner } = makeMockRunner({ delayMs: 30, liveCounterRef: counter });
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: runner,
      probeMedia: () => fakeProbe,
      checkFfmpeg: () => true,
    });
    await tool.execute(
      {
        input: "in.mp4",
        outputDir: "out",
        // 5 formats — must split into 3+2.
        formats: [
          "youtube-1080p",
          "shorts-9x16",
          "reels-9x16",
          "tiktok-9x16",
          "square-1x1",
        ],
        parallel: true,
      },
      makeCtx(),
    );
    expect(counter.max).toBeLessThanOrEqual(3);
    expect(counter.max).toBeGreaterThanOrEqual(2);
  });

  it("runs sequentially (max=1) when parallel=false", async () => {
    const cwd = mkScratch();
    const counter = { value: 0, max: 0 };
    const { runner } = makeMockRunner({ delayMs: 10, liveCounterRef: counter });
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: runner,
      probeMedia: () => fakeProbe,
      checkFfmpeg: () => true,
    });
    await tool.execute(
      {
        input: "in.mp4",
        outputDir: "out",
        formats: ["youtube-1080p", "shorts-9x16", "square-1x1"],
        parallel: false,
      },
      makeCtx(),
    );
    expect(counter.max).toBe(1);
  });
});

describe("render_multi_format — context signal propagation", () => {
  it("passes ctx.signal through to runFfmpeg", async () => {
    const cwd = mkScratch();
    const { runner, calls } = makeMockRunner({});
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: runner,
      probeMedia: () => fakeProbe,
      checkFfmpeg: () => true,
    });
    const ac = new AbortController();
    await tool.execute(
      { input: "in.mp4", outputDir: "out", formats: ["youtube-1080p"] },
      makeCtx(ac.signal),
    );
    expect(calls[0].signal).toBe(ac.signal);
  });
});

describe("render_multi_format — error aggregation", () => {
  it("returns a per-format error entry on partial failure", async () => {
    const cwd = mkScratch();
    const { runner } = makeMockRunner({
      failFor: (args) => args.some((a) => a.includes("shorts-9x16")),
    });
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: runner,
      probeMedia: () => fakeProbe,
      checkFfmpeg: () => true,
    });
    const out = await tool.execute(
      {
        input: "in.mp4",
        outputDir: "out",
        formats: ["youtube-1080p", "shorts-9x16"],
      },
      makeCtx(),
    );
    const parsed = JSON.parse(out as string);
    expect(parsed.outputs).toHaveLength(2);
    const yt = parsed.outputs.find((o: { format: string }) => o.format === "youtube-1080p");
    const sh = parsed.outputs.find((o: { format: string }) => o.format === "shorts-9x16");
    expect(yt.ok).toBe(true);
    expect(sh.ok).toBe(false);
    expect(sh.error).toMatch(/ffmpeg exited 1/);
  });

  it("errs when every render fails", async () => {
    const cwd = mkScratch();
    const { runner } = makeMockRunner({ failFor: () => true });
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: runner,
      probeMedia: () => fakeProbe,
      checkFfmpeg: () => true,
    });
    const out = await tool.execute(
      {
        input: "in.mp4",
        outputDir: "out",
        formats: ["youtube-1080p", "shorts-9x16"],
      },
      makeCtx(),
    );
    expect(out as string).toMatch(/^error: all renders failed/);
  });

  it("errs when ffmpeg is missing", async () => {
    const cwd = mkScratch();
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: async () => ({ code: 0, stdout: "", stderr: "" }),
      probeMedia: () => fakeProbe,
      checkFfmpeg: () => false,
    });
    const out = await tool.execute(
      { input: "in.mp4", outputDir: "out", formats: ["youtube-1080p"] },
      makeCtx(),
    );
    expect(out as string).toMatch(/ffmpeg not on PATH/);
  });

  it("errs when probe fails", async () => {
    const cwd = mkScratch();
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: async () => ({ code: 0, stdout: "", stderr: "" }),
      probeMedia: () => null,
      checkFfmpeg: () => true,
    });
    const out = await tool.execute(
      { input: "in.mp4", outputDir: "out", formats: ["youtube-1080p"] },
      makeCtx(),
    );
    expect(out as string).toMatch(/probe failed/);
  });

  it("errs when probe returns no video stream dimensions", async () => {
    const cwd = mkScratch();
    const tool = createRenderMultiFormatTool(cwd, {
      runFfmpeg: async () => ({ code: 0, stdout: "", stderr: "" }),
      probeMedia: () => ({ durationSec: 5 }),
      checkFfmpeg: () => true,
    });
    const out = await tool.execute(
      { input: "in.mp4", outputDir: "out", formats: ["youtube-1080p"] },
      makeCtx(),
    );
    expect(out as string).toMatch(/no video stream dimensions/);
  });
});

describe("render_multi_format — Zod parameter validation", () => {
  it("rejects empty formats[]", async () => {
    const cwd = mkScratch();
    const tool = createRenderMultiFormatTool(cwd);
    await expect(
      tool.parameters.parseAsync({
        input: "in.mp4",
        outputDir: "out",
        formats: [],
      }),
    ).rejects.toThrow();
  });

  it("rejects unknown format strings", async () => {
    const cwd = mkScratch();
    const tool = createRenderMultiFormatTool(cwd);
    await expect(
      tool.parameters.parseAsync({
        input: "in.mp4",
        outputDir: "out",
        formats: ["bogus-format"],
      }),
    ).rejects.toThrow();
  });

  it("accepts every documented format", async () => {
    const cwd = mkScratch();
    const tool = createRenderMultiFormatTool(cwd);
    const parsed = await tool.parameters.parseAsync({
      input: "in.mp4",
      outputDir: "out",
      formats: [
        "youtube-1080p",
        "shorts-9x16",
        "reels-9x16",
        "tiktok-9x16",
        "square-1x1",
        "instagram-4x5",
        "twitter-16x9",
      ],
    });
    expect(parsed.formats).toHaveLength(7);
  });
});
