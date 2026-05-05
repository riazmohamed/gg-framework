import { describe, expect, it } from "vitest";
import { buildTrimConcatFilter, computeKeeps } from "./trim-dead-air.js";

describe("computeKeeps", () => {
  it("head-tail trims leading and trailing silence", () => {
    const sil = [
      { startSec: 0, endSec: 1.5 },
      { startSec: 28, endSec: 30 },
    ];
    const keeps = computeKeeps(sil, 30, "head-tail", 0);
    expect(keeps).toEqual([{ startSec: 1.5, endSec: 28 }]);
  });

  it("head-tail keeps mid-recording silence intact", () => {
    const sil = [
      { startSec: 0, endSec: 1 },
      { startSec: 10, endSec: 12 },
      { startSec: 29, endSec: 30 },
    ];
    const keeps = computeKeeps(sil, 30, "head-tail", 0);
    expect(keeps).toEqual([{ startSec: 1, endSec: 29 }]);
  });

  it("head-tail returns full duration when no silences detected", () => {
    const keeps = computeKeeps([], 30, "head-tail", 0);
    expect(keeps).toEqual([{ startSec: 0, endSec: 30 }]);
  });

  it("all mode emits keeps between every silence", () => {
    const sil = [
      { startSec: 5, endSec: 6 },
      { startSec: 12, endSec: 13 },
    ];
    const keeps = computeKeeps(sil, 20, "all", 0);
    expect(keeps).toEqual([
      { startSec: 0, endSec: 5 },
      { startSec: 6, endSec: 12 },
      { startSec: 13, endSec: 20 },
    ]);
  });

  it("padding extends keeps and merges overlaps", () => {
    const sil = [
      { startSec: 5, endSec: 5.1 },
      { startSec: 5.3, endSec: 5.4 },
    ];
    // Padding of 0.2 makes the two surrounding keeps overlap, merging to one.
    const keeps = computeKeeps(sil, 10, "all", 0.2);
    expect(keeps.length).toBe(1);
    expect(keeps[0].startSec).toBeCloseTo(0, 5);
    expect(keeps[0].endSec).toBeCloseTo(10, 5);
  });

  it("returns empty when totalSec is 0", () => {
    expect(computeKeeps([], 0, "head-tail", 0)).toEqual([]);
  });
});

describe("buildTrimConcatFilter", () => {
  it("single keep emits one trim + atrim labelled [v][a]", () => {
    const f = buildTrimConcatFilter([{ startSec: 1, endSec: 5 }]);
    expect(f).toContain("trim=start=1:end=5");
    expect(f).toContain("atrim=start=1:end=5");
    expect(f).toContain("[v]");
    expect(f).toContain("[a]");
  });

  it("multiple keeps emit per-segment trims and a concat", () => {
    const f = buildTrimConcatFilter([
      { startSec: 0, endSec: 2 },
      { startSec: 5, endSec: 8 },
    ]);
    expect(f).toContain("[v0]");
    expect(f).toContain("[v1]");
    expect(f).toContain("[a0]");
    expect(f).toContain("[a1]");
    expect(f).toContain("concat=n=2:v=1:a=1[v][a]");
  });

  it("throws on empty keep list", () => {
    expect(() => buildTrimConcatFilter([])).toThrow();
  });
});
