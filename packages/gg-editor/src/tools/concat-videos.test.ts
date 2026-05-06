import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ffmpegMod from "../core/media/ffmpeg.js";
import { buildConcatListBody, createConcatVideosTool } from "./concat-videos.js";

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createConcatVideosTool>["execute"]>[1];

/**
 * The lossless branch writes an ffmpeg concat list file to os.tmpdir() and must
 * clean it up via try/finally regardless of whether ffmpeg succeeded or failed.
 * We snoop the path by intercepting runFfmpeg and pulling the value of the
 * argument that follows `-i`.
 */
function captureListPathOn(mock: ReturnType<typeof vi.spyOn>): { current(): string | undefined } {
  const ref: { current(): string | undefined } = { current: () => undefined };
  let captured: string | undefined;
  mock.mockImplementation(async (args: string[]) => {
    const i = args.indexOf("-i");
    captured = i >= 0 ? args[i + 1] : undefined;
    return { code: 0, stdout: "", stderr: "" };
  });
  ref.current = () => captured;
  return ref;
}

describe("buildConcatListBody", () => {
  it("single-quotes paths and escapes embedded single quotes", () => {
    const body = buildConcatListBody(["/a/b.mp4", "/weird/it's.mp4"]);
    expect(body).toBe("file '/a/b.mp4'\nfile '/weird/it'\\''s.mp4'");
  });
});

describe("concat_videos temp-file cleanup", () => {
  let workDir: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    workDir = mkdtempSync(join(tmpdir(), "gg-concat-test-"));
    // Make the inputs and output resolve to real-looking files so the
    // pre-flight identity check doesn't trip.
    writeFileSync(join(workDir, "a.mp4"), "");
    writeFileSync(join(workDir, "b.mp4"), "");
    vi.spyOn(ffmpegMod, "checkFfmpeg").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes the concat list file after a successful lossless run", async () => {
    const ff = vi.spyOn(ffmpegMod, "runFfmpeg");
    const captured = captureListPathOn(ff);

    const tool = createConcatVideosTool(workDir);
    const r = await tool.execute(
      { inputs: ["a.mp4", "b.mp4"], output: "out.mp4", lossless: true },
      ctx as Parameters<typeof tool.execute>[1],
    );

    expect(r).not.toMatch(/^error:/);
    const listPath = captured.current();
    expect(listPath).toBeDefined();
    expect(listPath!).toMatch(/gg-concat-/);
    expect(existsSync(listPath!)).toBe(false);
  });

  it("writes the concat list before invoking ffmpeg (sanity-check the body)", async () => {
    let bodyAtFfmpegTime: string | undefined;
    vi.spyOn(ffmpegMod, "runFfmpeg").mockImplementation(async (args: string[]) => {
      const i = args.indexOf("-i");
      const path = args[i + 1];
      bodyAtFfmpegTime = readFileSync(path, "utf8");
      return { code: 0, stdout: "", stderr: "" };
    });

    const tool = createConcatVideosTool(workDir);
    await tool.execute(
      { inputs: ["a.mp4", "b.mp4"], output: "out.mp4", lossless: true },
      ctx as Parameters<typeof tool.execute>[1],
    );

    expect(bodyAtFfmpegTime).toBeDefined();
    expect(bodyAtFfmpegTime!).toContain("file '");
    expect(bodyAtFfmpegTime!).toContain("a.mp4");
    expect(bodyAtFfmpegTime!).toContain("b.mp4");
  });

  it("removes the concat list file when ffmpeg returns a non-zero code", async () => {
    let captured: string | undefined;
    vi.spyOn(ffmpegMod, "runFfmpeg").mockImplementation(async (args: string[]) => {
      const i = args.indexOf("-i");
      captured = args[i + 1];
      return { code: 1, stdout: "", stderr: "boom" };
    });

    const tool = createConcatVideosTool(workDir);
    const r = await tool.execute(
      { inputs: ["a.mp4", "b.mp4"], output: "out.mp4", lossless: true },
      ctx as Parameters<typeof tool.execute>[1],
    );

    expect(r).toMatch(/^error: ffmpeg concat-demuxer exited 1/);
    expect(captured).toBeDefined();
    expect(existsSync(captured!)).toBe(false);
  });

  it("removes the concat list file when runFfmpeg throws", async () => {
    let captured: string | undefined;
    vi.spyOn(ffmpegMod, "runFfmpeg").mockImplementation(async (args: string[]) => {
      const i = args.indexOf("-i");
      captured = args[i + 1];
      throw new Error("spawn failed");
    });

    const tool = createConcatVideosTool(workDir);
    const r = await tool.execute(
      { inputs: ["a.mp4", "b.mp4"], output: "out.mp4", lossless: true },
      ctx as Parameters<typeof tool.execute>[1],
    );

    // The outer try/catch in the tool surfaces thrown errors as err()
    // strings; the temp file must still be gone.
    expect(r).toMatch(/^error: spawn failed/);
    expect(captured).toBeDefined();
    expect(existsSync(captured!)).toBe(false);
  });
});
