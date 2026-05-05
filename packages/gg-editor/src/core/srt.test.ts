import { describe, expect, it } from "vitest";
import { buildSrt, buildWordLevelSrt, formatSrtTime, msToSrtTime, secondsToMs } from "./srt.js";

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
  it("clamps NaN / Infinity to zero", () => {
    expect(formatSrtTime(Number.NaN)).toBe("00:00:00,000");
    expect(formatSrtTime(Number.POSITIVE_INFINITY)).toBe("00:00:00,000");
  });
  it("rounds half away from zero at the ms boundary", () => {
    // 1.2345s → 1234.5ms → round to 1235 (Math.round rule).
    expect(formatSrtTime(1.2345)).toBe("00:00:01,235");
  });
  it("survives float multiplication artifacts", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754; must still emit 300ms.
    expect(formatSrtTime(0.1 + 0.2)).toBe("00:00:00,300");
  });
});

describe("secondsToMs / msToSrtTime", () => {
  it("secondsToMs rounds half-away-from-zero", () => {
    expect(secondsToMs(0)).toBe(0);
    expect(secondsToMs(0.0005)).toBe(1);
    expect(secondsToMs(0.0014)).toBe(1);
    expect(secondsToMs(35.123)).toBe(35123);
  });
  it("secondsToMs clamps negatives, NaN, Infinity to 0", () => {
    expect(secondsToMs(-1)).toBe(0);
    expect(secondsToMs(Number.NaN)).toBe(0);
    expect(secondsToMs(Number.POSITIVE_INFINITY)).toBe(0);
  });
  it("msToSrtTime accepts pre-converted integer ms (no float round-trip)", () => {
    expect(msToSrtTime(0)).toBe("00:00:00,000");
    expect(msToSrtTime(35123)).toBe("00:00:35,123");
    expect(msToSrtTime(3661234)).toBe("01:01:01,234");
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

  it("drops words whose ms-rounded duration collapses to zero", () => {
    const out = buildWordLevelSrt([
      { start: 0, end: 0.3, text: "keep" },
      // start=0.3001, end=0.3004 — both round to 300ms. Drop silently rather
      // than emit invalid `00:00:00,300 --> 00:00:00,300`.
      { start: 0.3001, end: 0.3004, text: "drop" },
      { start: 0.4, end: 0.6, text: "keep2" },
    ]);
    expect(out).toContain("keep");
    expect(out).toContain("keep2");
    expect(out).not.toContain("drop");
    // Numbering must be contiguous (1, 2 — not 1, 3).
    expect(out).toContain("1\n");
    expect(out).toContain("2\n");
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

  it("rejects cues whose float end>start collapses to the same ms-int", () => {
    // start=0.1001, end=0.1004 — both round to 100ms. Float check would
    // pass, but the SRT line `00:00:00,100 --> 00:00:00,100` is invalid
    // (zero displayed duration). Must throw, matching the post-rounding
    // wire reality.
    expect(() => buildSrt([{ start: 0.1001, end: 0.1004, text: "x" }])).toThrow(/end/);
  });

  it("returns empty string for no usable cues", () => {
    expect(buildSrt([])).toBe("");
    expect(buildSrt([{ start: 0, end: 1, text: "" }])).toBe("");
  });
});
