import { describe, expect, it } from "vitest";
import { buildBleepFilter, findRanges, mergeRanges } from "./bleep-words.js";
import type { Transcript } from "../core/whisper.js";

function transcriptOf(words: Array<{ text: string; start: number; end: number }>): Transcript {
  return {
    language: "en",
    durationSec: 30,
    segments: [
      {
        start: 0,
        end: 30,
        text: words.map((w) => w.text).join(" "),
        words,
      },
    ],
  };
}

describe("findRanges", () => {
  it("matches a single word case-insensitively, strips punctuation", () => {
    const t = transcriptOf([
      { text: "hello", start: 0, end: 0.5 },
      { text: "Damn,", start: 1, end: 1.4 },
      { text: "world", start: 1.5, end: 2 },
    ]);
    const r = findRanges(t, ["damn"], 0);
    expect(r).toEqual([{ startSec: 1, endSec: 1.4, text: "damn" }]);
  });

  it("matches multi-word phrases", () => {
    const t = transcriptOf([
      { text: "you", start: 0, end: 0.3 },
      { text: "know", start: 0.3, end: 0.7 },
      { text: "what", start: 0.7, end: 1 },
    ]);
    const r = findRanges(t, ["you know"], 0);
    expect(r.length).toBe(1);
    expect(r[0].startSec).toBe(0);
    expect(r[0].endSec).toBe(0.7);
    expect(r[0].text).toBe("you know");
  });

  it("applies padding on both sides", () => {
    const t = transcriptOf([{ text: "bad", start: 5, end: 5.4 }]);
    const r = findRanges(t, ["bad"], 0.05);
    expect(r[0].startSec).toBeCloseTo(4.95, 5);
    expect(r[0].endSec).toBeCloseTo(5.45, 5);
  });

  it("clamps negative starts to 0 (padding past start of file)", () => {
    const t = transcriptOf([{ text: "shit", start: 0, end: 0.3 }]);
    const r = findRanges(t, ["shit"], 0.5);
    expect(r[0].startSec).toBe(0);
  });

  it("returns empty when no matches", () => {
    const t = transcriptOf([{ text: "hello", start: 0, end: 0.5 }]);
    expect(findRanges(t, ["nope"], 0)).toEqual([]);
  });

  it("ignores empty / whitespace entries in wordList", () => {
    const t = transcriptOf([{ text: "x", start: 0, end: 1 }]);
    expect(findRanges(t, ["", "   "], 0)).toEqual([]);
  });
});

describe("mergeRanges", () => {
  it("merges overlapping ranges", () => {
    const merged = mergeRanges([
      { startSec: 1, endSec: 2, text: "a" },
      { startSec: 1.5, endSec: 2.5, text: "b" },
    ]);
    expect(merged).toEqual([{ startSec: 1, endSec: 2.5, text: "a/b" }]);
  });

  it("preserves disjoint ranges", () => {
    const merged = mergeRanges([
      { startSec: 1, endSec: 2, text: "a" },
      { startSec: 5, endSec: 6, text: "b" },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("buildBleepFilter", () => {
  it("mute mode emits volume=0 per range", () => {
    const f = buildBleepFilter([{ startSec: 1, endSec: 2, text: "x" }], "mute", 1000);
    expect(f).toContain("volume=enable='between(t,1,2)':volume=0");
    expect(f).toContain("[aout]");
    expect(f).not.toContain("sine=");
  });

  it("bleep mode emits a sine tone per range and amixes", () => {
    const f = buildBleepFilter(
      [
        { startSec: 1, endSec: 2, text: "x" },
        { startSec: 5, endSec: 5.5, text: "y" },
      ],
      "bleep",
      1000,
    );
    expect(f).toContain("sine=frequency=1000:duration=1");
    expect(f).toContain("sine=frequency=1000:duration=0.5");
    expect(f).toContain("amix=inputs=3");
    expect(f).toContain("[aout]");
  });

  it("throws on empty range list", () => {
    expect(() => buildBleepFilter([], "mute", 1000)).toThrow();
  });
});
