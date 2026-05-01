import { describe, expect, it } from "vitest";
import { curveFor, easeIn, easeOut, linear, sampleCurve, smooth } from "./keyframes.js";

describe("curve helpers", () => {
  it("linear is the identity, clamped to 0..1", () => {
    expect(linear(0)).toBe(0);
    expect(linear(0.5)).toBe(0.5);
    expect(linear(1)).toBe(1);
    expect(linear(-0.2)).toBe(0);
    expect(linear(1.5)).toBe(1);
  });

  it("easeIn / easeOut are mirrored at t=0.5", () => {
    expect(easeIn(0.5)).toBeCloseTo(0.25);
    expect(easeOut(0.5)).toBeCloseTo(0.75);
    expect(easeIn(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
  });

  it("smooth / smoothstep is symmetric: f(t) + f(1-t) = 1", () => {
    for (const t of [0.1, 0.25, 0.4, 0.5, 0.75]) {
      expect(smooth(t) + smooth(1 - t)).toBeCloseTo(1, 5);
    }
  });
});

describe("curveFor", () => {
  it("maps interp strings to their curve functions", () => {
    expect(curveFor("linear")).toBe(linear);
    expect(curveFor("easeIn")).toBe(easeIn);
    expect(curveFor("easeOut")).toBe(easeOut);
    expect(curveFor("smooth")).toBe(smooth);
    expect(curveFor(undefined)).toBe(linear);
  });
});

describe("sampleCurve", () => {
  it("returns single-keyframe value as constant", () => {
    expect(sampleCurve([{ frame: 0, value: 42 }], 100, 30)).toBe(42);
  });

  it("clamps to first/last value outside the range", () => {
    const kfs = [
      { frame: 10, value: 1 },
      { frame: 20, value: 2 },
    ];
    expect(sampleCurve(kfs, 0, 30)).toBe(1);
    expect(sampleCurve(kfs, 9, 30)).toBe(1);
    expect(sampleCurve(kfs, 100, 30)).toBe(2);
  });

  it("linearly interpolates between two keyframes", () => {
    const kfs = [
      { frame: 0, value: 0 },
      { frame: 30, value: 10 },
    ];
    expect(sampleCurve(kfs, 15, 30)).toBeCloseTo(5);
  });

  it("uses the LEFT keyframe's interp for the segment", () => {
    const kfs = [
      { frame: 0, value: 0, interp: "easeIn" as const },
      { frame: 30, value: 10 },
    ];
    // At t=0.5 with easeIn: t² = 0.25 → value = 0 + 10 * 0.25 = 2.5.
    expect(sampleCurve(kfs, 15, 30)).toBeCloseTo(2.5);
  });

  it("works with multiple segments and uses the right one", () => {
    const kfs = [
      { frame: 0, value: 0 },
      { frame: 30, value: 100 },
      { frame: 60, value: 0 },
    ];
    expect(sampleCurve(kfs, 15, 30)).toBeCloseTo(50);
    expect(sampleCurve(kfs, 45, 30)).toBeCloseTo(50);
  });

  it("throws on empty keyframe list", () => {
    expect(() => sampleCurve([], 0, 30)).toThrow();
  });
});
