import { describe, expect, it } from "vitest";
import { keepRangesFromSilences, parseSilenceDetect, silencesToFrameRanges } from "./silence.js";

describe("parseSilenceDetect", () => {
  it("parses a clean pair", () => {
    const stderr = `
[silencedetect @ 0x1234] silence_start: 1.500
[silencedetect @ 0x1234] silence_end: 3.000 | silence_duration: 1.500
`;
    expect(parseSilenceDetect(stderr)).toEqual([{ startSec: 1.5, endSec: 3.0, durSec: 1.5 }]);
  });

  it("parses multiple ranges interleaved with other ffmpeg log lines", () => {
    const stderr = `
frame=  100 fps=30 q=0
[silencedetect @ 0x1] silence_start: 0.0
size=N/A time=00:00:01
[silencedetect @ 0x1] silence_end: 1.0 | silence_duration: 1.0
[silencedetect @ 0x1] silence_start: 5.5
[silencedetect @ 0x1] silence_end: 6.25 | silence_duration: 0.75
`;
    expect(parseSilenceDetect(stderr)).toEqual([
      { startSec: 0, endSec: 1, durSec: 1 },
      { startSec: 5.5, endSec: 6.25, durSec: 0.75 },
    ]);
  });

  it("ignores end without preceding start", () => {
    const stderr = `[silencedetect @ 0x1] silence_end: 2.0 | silence_duration: 2.0`;
    expect(parseSilenceDetect(stderr)).toEqual([]);
  });

  it("closes trailing silence at totalSec when end is missing", () => {
    const stderr = `[silencedetect @ 0x1] silence_start: 9.5`;
    expect(parseSilenceDetect(stderr, 10)).toEqual([{ startSec: 9.5, endSec: 10, durSec: 0.5 }]);
  });

  it("does not close trailing silence when totalSec not provided", () => {
    const stderr = `[silencedetect @ 0x1] silence_start: 9.5`;
    expect(parseSilenceDetect(stderr)).toEqual([]);
  });

  it("rejects non-finite starts and starts more than a second negative", () => {
    const stderr = `
[silencedetect @ 0x1] silence_start: -5.0
[silencedetect @ 0x1] silence_end: 2.0 | silence_duration: 3.0
`;
    expect(parseSilenceDetect(stderr)).toEqual([]);
  });

  it("clamps near-zero negative starts to 0 (leading-silence artifact)", () => {
    // ffmpeg often emits silence_start: -0.00133333 when the file leads with
    // silence — a filter look-back artifact. Real-world fixtures observed in
    // the wild (danbooru, jappeace/cut-the-crap).
    const stderr = `[silencedetect @ 0x1] silence_start: -0.00133333
[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1.5`;
    const r = parseSilenceDetect(stderr);
    expect(r).toHaveLength(1);
    expect(r[0].startSec).toBe(0);
    expect(r[0].endSec).toBe(1.5);
  });

  it("survives concatenated ffmpeg log junk after the start value", () => {
    // jappeace test fixture: silence_start: 430.41'peed= 858x
    const stderr = `[silencedetect @ 0x1] silence_start: 430.41'peed= 858x
[silencedetect @ 0x1] silence_end: 432.5 | silence_duration: 2.09`;
    const r = parseSilenceDetect(stderr);
    expect(r).toHaveLength(1);
    expect(r[0].startSec).toBe(430.41);
    expect(r[0].endSec).toBe(432.5);
  });
});

describe("silencesToFrameRanges", () => {
  it("rounds inward (start ceils, end floors)", () => {
    const r = silencesToFrameRanges([{ startSec: 1.01, endSec: 1.99, durSec: 0.98 }], 30);
    // start: ceil(1.01 * 30) = 31. end: floor(1.99 * 30) = 59.
    expect(r).toEqual([{ startFrame: 31, endFrame: 59 }]);
  });

  it("drops ranges that collapse after rounding", () => {
    const r = silencesToFrameRanges([{ startSec: 1.01, endSec: 1.02, durSec: 0.01 }], 30);
    expect(r).toEqual([]);
  });
});

describe("keepRangesFromSilences", () => {
  it("inverts silences to keeps", () => {
    const k = keepRangesFromSilences(
      [
        { startSec: 1, endSec: 2, durSec: 1 },
        { startSec: 5, endSec: 6, durSec: 1 },
      ],
      10,
    );
    expect(k).toEqual([
      { startSec: 0, endSec: 1, durSec: 1 },
      { startSec: 2, endSec: 5, durSec: 3 },
      { startSec: 6, endSec: 10, durSec: 4 },
    ]);
  });

  it("returns the whole duration when there are no silences", () => {
    expect(keepRangesFromSilences([], 10)).toEqual([{ startSec: 0, endSec: 10, durSec: 10 }]);
  });

  it("applies padding without exceeding bounds or neighbours", () => {
    const k = keepRangesFromSilences([{ startSec: 1, endSec: 2, durSec: 1 }], 10, 0.2);
    // First keep: 0..1 padded to 0..1.2 (start clamped at 0)
    // Second keep: 2..10 padded to 1.8..10 (end at totalSec, no cap needed)
    expect(k[0].startSec).toBe(0);
    expect(k[0].endSec).toBeCloseTo(1.2);
    expect(k[1].startSec).toBeCloseTo(1.8);
    expect(k[1].endSec).toBe(10);
  });

  it("emits no keeps when silence covers the entire file", () => {
    expect(keepRangesFromSilences([{ startSec: 0, endSec: 10, durSec: 10 }], 10)).toEqual([]);
  });

  it("does not emit a zero-length keep between two adjacent silences", () => {
    // Silence ends at 5; next silence starts at 5 — no keep should be emitted
    // for the zero-width gap.
    const k = keepRangesFromSilences(
      [
        { startSec: 1, endSec: 5, durSec: 4 },
        { startSec: 5, endSec: 8, durSec: 3 },
      ],
      10,
    );
    // Two keeps total: 0..1 and 8..10. NO keep at [5,5].
    expect(k).toEqual([
      { startSec: 0, endSec: 1, durSec: 1 },
      { startSec: 8, endSec: 10, durSec: 2 },
    ]);
  });

  it("merges overlapping silences correctly", () => {
    // s1 = [1,5], s2 = [3,8] (overlapping). cursor advances to max(5,8)=8.
    const k = keepRangesFromSilences(
      [
        { startSec: 1, endSec: 5, durSec: 4 },
        { startSec: 3, endSec: 8, durSec: 5 },
      ],
      10,
    );
    expect(k).toEqual([
      { startSec: 0, endSec: 1, durSec: 1 },
      { startSec: 8, endSec: 10, durSec: 2 },
    ]);
  });

  it("handles a silence that runs past totalSec without spurious trailing keep", () => {
    const k = keepRangesFromSilences([{ startSec: 5, endSec: 100, durSec: 95 }], 10);
    expect(k).toEqual([{ startSec: 0, endSec: 5, durSec: 5 }]);
  });

  it("sorts unsorted input defensively", () => {
    const k = keepRangesFromSilences(
      [
        { startSec: 5, endSec: 6, durSec: 1 },
        { startSec: 1, endSec: 2, durSec: 1 },
      ],
      10,
    );
    expect(k).toEqual([
      { startSec: 0, endSec: 1, durSec: 1 },
      { startSec: 2, endSec: 5, durSec: 3 },
      { startSec: 6, endSec: 10, durSec: 4 },
    ]);
  });
});
