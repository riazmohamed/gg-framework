import { describe, expect, it } from "vitest";
import { extractJsonBlock, PLATFORM_TARGETS } from "./loudness.js";

describe("extractJsonBlock", () => {
  it("returns the trailing balanced object", () => {
    const s = 'frame=  100 fps=30 q=0\n{ "input_i": "-18.5", "input_tp": "-1.2" }\n';
    expect(extractJsonBlock(s)).toBe('{ "input_i": "-18.5", "input_tp": "-1.2" }');
  });
  it("returns last block when ffmpeg printed multiple curly fragments", () => {
    const s = '[meta]:{"a":1}\n{"input_i":"-14"}';
    expect(extractJsonBlock(s)).toBe('{"input_i":"-14"}');
  });
  it("handles nested objects", () => {
    const s = 'log\n{ "a": { "b": 1 }, "c": 2 }';
    expect(extractJsonBlock(s)).toBe('{ "a": { "b": 1 }, "c": 2 }');
  });
  it("returns undefined when no closing brace", () => {
    expect(extractJsonBlock("no braces here")).toBeUndefined();
  });
});

describe("PLATFORM_TARGETS", () => {
  it("has the right LUFS targets per platform", () => {
    expect(PLATFORM_TARGETS.youtube.integratedLufs).toBe(-14);
    expect(PLATFORM_TARGETS.spotify.integratedLufs).toBe(-14);
    expect(PLATFORM_TARGETS["apple-podcasts"].integratedLufs).toBe(-16);
    expect(PLATFORM_TARGETS["broadcast-r128"].integratedLufs).toBe(-23);
    expect(PLATFORM_TARGETS.tiktok.integratedLufs).toBe(-14);
    expect(PLATFORM_TARGETS.instagram.integratedLufs).toBe(-14);
  });
  it("defaults to TP=-1 LRA=11 for streaming targets", () => {
    expect(PLATFORM_TARGETS.youtube.truePeakDb).toBe(-1);
    expect(PLATFORM_TARGETS.youtube.loudnessRange).toBe(11);
  });
});
