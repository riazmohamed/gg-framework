import { describe, expect, it } from "vitest";
import { clip, compact, err, framesToTimecode, summarizeList } from "./format.js";

describe("compact", () => {
  it("emits no whitespace", () => {
    expect(compact({ a: 1, b: "x" })).toBe('{"a":1,"b":"x"}');
  });
  it("strips null/undefined fields", () => {
    expect(compact({ a: 1, b: null, c: undefined, d: 2 })).toBe('{"a":1,"d":2}');
  });
});

describe("err", () => {
  it("formats cause only", () => {
    expect(err("bad input")).toBe("error: bad input");
  });
  it("formats cause + fix", () => {
    expect(err("no python", "install python3")).toBe("error: no python; fix: install python3");
  });
});

describe("framesToTimecode", () => {
  it("formats zero", () => {
    expect(framesToTimecode(0, 30)).toBe("00:00:00:00");
  });
  it("formats one second", () => {
    expect(framesToTimecode(30, 30)).toBe("00:00:01:00");
  });
  it("formats sub-second remainder", () => {
    expect(framesToTimecode(45, 30)).toBe("00:00:01:15");
  });
  it("formats hours/minutes", () => {
    expect(framesToTimecode(30 * 3725, 30)).toBe("01:02:05:00");
  });
  it("rounds fractional fps", () => {
    expect(framesToTimecode(24, 23.976)).toBe("00:00:01:00");
  });
  it("clamps negative frames to zero", () => {
    // The CMX 3600 spec doesn't allow negative timecode; we clamp instead of
    // emitting a malformed string.
    expect(framesToTimecode(-30, 30)).toBe("00:00:00:00");
  });
  it("handles 24 hours of footage at 30fps without overflow into 3-digit hours", () => {
    // 24 hours = 24 * 3600 * 30 = 2,592,000 frames — should land at 24:00:00:00.
    expect(framesToTimecode(2592000, 30)).toBe("24:00:00:00");
  });
  it("emits 3-digit hour fields when needed (no truncation)", () => {
    // 100 hours — padStart(2) doesn't TRUNCATE, so we get "100:00:00:00".
    // Out-of-spec for strict CMX 3600 but the most defensive choice.
    const r = framesToTimecode(100 * 3600 * 30, 30);
    expect(r).toBe("100:00:00:00");
  });
  it("frame field never overflows the integer fps (no '60' frames at 30fps)", () => {
    // 30 frames at 30fps must roll into 1 second, NOT show ff=30.
    expect(framesToTimecode(30, 30)).toBe("00:00:01:00");
    // 59 frames at 30fps = 1 sec + 29 frames
    expect(framesToTimecode(59, 30)).toBe("00:00:01:29");
  });
});

describe("summarizeList", () => {
  it("returns head only when under keep", () => {
    const r = summarizeList([1, 2, 3], 10);
    expect(r.total).toBe(3);
    expect(r.omitted).toBe(0);
    expect(r.head).toEqual([1, 2, 3]);
    expect(r.tail).toEqual([]);
  });
  it("splits head/tail when over keep", () => {
    const r = summarizeList(
      Array.from({ length: 100 }, (_, i) => i + 1),
      10,
    );
    expect(r.total).toBe(100);
    expect(r.omitted).toBe(90);
    expect(r.head).toEqual([1, 2, 3, 4, 5]);
    expect(r.tail).toEqual([96, 97, 98, 99, 100]);
  });
});

describe("clip", () => {
  it("returns input when short", () => {
    expect(clip("hi", 10)).toBe("hi");
  });
  it("ellipsizes when long", () => {
    expect(clip("0123456789", 5)).toBe("0123…");
  });
});
