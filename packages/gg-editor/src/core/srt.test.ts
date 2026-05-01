import { describe, expect, it } from "vitest";
import { buildSrt, buildWordLevelSrt, formatSrtTime } from "./srt.js";

describe("formatSrtTime", () => {
  it("formats zero", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
  });
  it("formats sub-second", () => {
    expect(formatSrtTime(0.5)).toBe("00:00:00,500");
  });
  it("formats hours/minutes/seconds/ms", () => {
    expect(formatSrtTime(3661.234)).toBe("01:01:01,234");
  });
  it("clamps negatives to zero", () => {
    expect(formatSrtTime(-3)).toBe("00:00:00,000");
  });
});

describe("buildWordLevelSrt", () => {
  it("emits one cue per word by default", () => {
    const out = buildWordLevelSrt([
      { start: 0, end: 0.3, text: "hello" },
      { start: 0.3, end: 0.6, text: "world" },
    ]);
    expect(out).toContain("1\n00:00:00,000 --> 00:00:00,300\nhello");
    expect(out).toContain("2\n00:00:00,300 --> 00:00:00,600\nworld");
  });

  it("groups words when groupSize > 1", () => {
    const out = buildWordLevelSrt(
      [
        { start: 0, end: 0.2, text: "a" },
        { start: 0.2, end: 0.4, text: "b" },
        { start: 0.4, end: 0.6, text: "c" },
        { start: 0.6, end: 0.8, text: "d" },
      ],
      { groupSize: 2 },
    );
    expect(out).toContain("1\n00:00:00,000 --> 00:00:00,400\na b");
    expect(out).toContain("2\n00:00:00,400 --> 00:00:00,800\nc d");
    expect(out).not.toContain("3\n");
  });

  it("extends cue ends up to next cue start when gapSec allows", () => {
    const out = buildWordLevelSrt(
      [
        { start: 0, end: 0.3, text: "first" },
        { start: 0.5, end: 0.8, text: "second" },
      ],
      { gapSec: 0.5 },
    );
    // First cue should now end at 0.5 (start of second).
    expect(out).toContain("00:00:00,000 --> 00:00:00,500");
  });

  it("does NOT extend across gaps larger than gapSec", () => {
    const out = buildWordLevelSrt(
      [
        { start: 0, end: 0.3, text: "first" },
        { start: 5, end: 5.3, text: "second" },
      ],
      { gapSec: 0.5 },
    );
    expect(out).toContain("00:00:00,000 --> 00:00:00,300");
  });

  it("skips empty / zero-duration words", () => {
    const out = buildWordLevelSrt([
      { start: 0, end: 0.3, text: "a" },
      { start: 0.3, end: 0.3, text: "" },
      { start: 0.3, end: 0.3, text: "   " },
      { start: 0.3, end: 0.6, text: "b" },
    ]);
    // Only "a" and "b" survive.
    expect(out).toContain("1\n00:00:00,000 --> 00:00:00,300\na");
    expect(out).toContain("2\n00:00:00,300 --> 00:00:00,600\nb");
    expect(out).not.toContain("3\n");
  });
});

describe("buildSrt", () => {
  it("emits 1-indexed cues with HH:MM:SS,mmm timestamps", () => {
    const out = buildSrt([
      { start: 1, end: 3.5, text: "Hello world." },
      { start: 4, end: 6, text: "Second cue." },
    ]);
    expect(out).toBe(
      [
        "1",
        "00:00:01,000 --> 00:00:03,500",
        "Hello world.",
        "",
        "2",
        "00:00:04,000 --> 00:00:06,000",
        "Second cue.",
        "",
      ].join("\n"),
    );
  });

  it("preserves multi-line cue text and trims edges", () => {
    const out = buildSrt([{ start: 0, end: 1, text: "  line one\nline two  " }]);
    expect(out.includes("line one\nline two")).toBe(true);
  });

  it("skips empty-text cues without breaking numbering", () => {
    const out = buildSrt([
      { start: 0, end: 1, text: "first" },
      { start: 1, end: 2, text: "   " },
      { start: 2, end: 3, text: "second" },
    ]);
    const lines = out.split("\n");
    expect(lines[0]).toBe("1");
    expect(lines[4]).toBe("2");
    expect(out.includes("first")).toBe(true);
    expect(out.includes("second")).toBe(true);
  });

  it("rejects zero-or-negative duration cues", () => {
    expect(() => buildSrt([{ start: 5, end: 5, text: "x" }])).toThrow(/end/);
    expect(() => buildSrt([{ start: 5, end: 4, text: "x" }])).toThrow(/end/);
  });

  it("returns empty string for no usable cues", () => {
    expect(buildSrt([])).toBe("");
    expect(buildSrt([{ start: 0, end: 1, text: "" }])).toBe("");
  });
});
