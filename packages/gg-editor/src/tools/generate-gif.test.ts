import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ffmpegMod from "../core/media/ffmpeg.js";
import { createGenerateGifTool } from "./generate-gif.js";

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createGenerateGifTool>["execute"]>[1];

/**
 * generate_gif runs ffmpeg twice: pass 1 (palettegen) writes a temp .png to
 * os.tmpdir(); pass 2 (paletteuse) consumes it. The palette is scratch and
 * MUST be cleaned up no matter how the tool exits. We snoop the palette
 * path by capturing the LAST positional arg of pass 1 (palettegen output)
 * or the value following `-i` after the palette is added on pass 2.
 */
function palettePathFromPass1Args(args: string[]): string {
  // palettegen writes its output as the final positional arg.
  return args[args.length - 1];
}

describe("generate_gif temp-file cleanup", () => {
  let workDir: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    workDir = mkdtempSync(join(tmpdir(), "gg-gif-test-"));
    writeFileSync(join(workDir, "in.mp4"), "");
    vi.spyOn(ffmpegMod, "checkFfmpeg").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes the palette file after both passes succeed", async () => {
    let palettePath: string | undefined;
    let call = 0;
    vi.spyOn(ffmpegMod, "runFfmpeg").mockImplementation(async (args: string[]) => {
      call++;
      if (call === 1) {
        palettePath = palettePathFromPass1Args(args);
        // Simulate ffmpeg actually creating the file.
        writeFileSync(palettePath, "");
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const tool = createGenerateGifTool(workDir);
    const r = await tool.execute(
      { input: "in.mp4", output: "out.gif" },
      ctx as Parameters<typeof tool.execute>[1],
    );

    expect(r).not.toMatch(/^error:/);
    expect(palettePath).toBeDefined();
    expect(palettePath!).toMatch(/gg-gif-palette-/);
    // ffmpeg ran twice (palettegen + paletteuse).
    expect(call).toBe(2);
    expect(existsSync(palettePath!)).toBe(false);
  });

  it("removes the palette file when palettegen (pass 1) fails", async () => {
    let palettePath: string | undefined;
    vi.spyOn(ffmpegMod, "runFfmpeg").mockImplementation(async (args: string[]) => {
      palettePath = palettePathFromPass1Args(args);
      // Simulate a partial palette write before the failure.
      writeFileSync(palettePath, "");
      return { code: 1, stdout: "", stderr: "palettegen boom" };
    });

    const tool = createGenerateGifTool(workDir);
    const r = await tool.execute(
      { input: "in.mp4", output: "out.gif" },
      ctx as Parameters<typeof tool.execute>[1],
    );

    expect(r).toMatch(/^error: palettegen exited 1/);
    expect(palettePath).toBeDefined();
    expect(existsSync(palettePath!)).toBe(false);
  });

  it("removes the palette file when paletteuse (pass 2) fails", async () => {
    let palettePath: string | undefined;
    let call = 0;
    vi.spyOn(ffmpegMod, "runFfmpeg").mockImplementation(async (args: string[]) => {
      call++;
      if (call === 1) {
        palettePath = palettePathFromPass1Args(args);
        writeFileSync(palettePath, "");
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 2, stdout: "", stderr: "paletteuse boom" };
    });

    const tool = createGenerateGifTool(workDir);
    const r = await tool.execute(
      { input: "in.mp4", output: "out.gif" },
      ctx as Parameters<typeof tool.execute>[1],
    );

    expect(r).toMatch(/^error: paletteuse exited 2/);
    expect(call).toBe(2);
    expect(palettePath).toBeDefined();
    expect(existsSync(palettePath!)).toBe(false);
  });

  it("removes the palette file when runFfmpeg throws on pass 1", async () => {
    let palettePath: string | undefined;
    vi.spyOn(ffmpegMod, "runFfmpeg").mockImplementation(async (args: string[]) => {
      palettePath = palettePathFromPass1Args(args);
      writeFileSync(palettePath, "");
      throw new Error("spawn failed");
    });

    const tool = createGenerateGifTool(workDir);
    const r = await tool.execute(
      { input: "in.mp4", output: "out.gif" },
      ctx as Parameters<typeof tool.execute>[1],
    );

    expect(r).toMatch(/^error: spawn failed/);
    expect(palettePath).toBeDefined();
    expect(existsSync(palettePath!)).toBe(false);
  });

  it("rmSync uses force semantics: cleanup is a no-op if the palette never landed on disk", async () => {
    let palettePath: string | undefined;
    vi.spyOn(ffmpegMod, "runFfmpeg").mockImplementation(async (args: string[]) => {
      palettePath = palettePathFromPass1Args(args);
      // Deliberately do NOT write the palette file — simulate ffmpeg failing
      // before any output. With { force: true } this must not throw.
      return { code: 1, stdout: "", stderr: "no palette" };
    });

    const tool = createGenerateGifTool(workDir);
    const r = await tool.execute(
      { input: "in.mp4", output: "out.gif" },
      ctx as Parameters<typeof tool.execute>[1],
    );

    expect(r).toMatch(/^error: palettegen exited 1/);
    expect(palettePath).toBeDefined();
    expect(existsSync(palettePath!)).toBe(false);
  });
});
