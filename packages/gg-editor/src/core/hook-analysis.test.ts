import { describe, expect, it } from "vitest";
import { buildHookResult, parseHookVisionResponse, speechAt0_5sScore } from "./hook-analysis.js";

describe("speechAt0_5sScore", () => {
  it("returns 1.0 when there are no silences in the window", () => {
    expect(speechAt0_5sScore([])).toBe(1);
  });

  it("returns 0.0 when the entire window is silent", () => {
    expect(speechAt0_5sScore([{ startSec: 0, endSec: 1 }])).toBe(0);
  });

  it("returns 0.5 when half the window is silent", () => {
    expect(speechAt0_5sScore([{ startSec: 0, endSec: 0.25 }])).toBeCloseTo(0.5, 3);
  });

  it("clips silences that start before / extend past the window", () => {
    expect(speechAt0_5sScore([{ startSec: -1, endSec: 0.1 }])).toBeCloseTo(0.8, 3);
    expect(speechAt0_5sScore([{ startSec: 0.4, endSec: 5 }])).toBeCloseTo(0.8, 3);
  });

  it("respects a custom windowSec", () => {
    expect(speechAt0_5sScore([{ startSec: 0, endSec: 1 }], 2)).toBeCloseTo(0.5, 3);
  });
});

describe("parseHookVisionResponse", () => {
  it("parses a well-formed response", () => {
    const j = JSON.stringify({
      onScreenText: 0.8,
      motion: 0.6,
      subjectClarity: 0.9,
      emotionalIntensity: 0.7,
      why: "bold hook text + reaction shot",
    });
    const r = parseHookVisionResponse(j);
    expect(r.onScreenText).toBe(0.8);
    expect(r.motion).toBe(0.6);
    expect(r.subjectClarity).toBe(0.9);
    expect(r.emotionalIntensity).toBe(0.7);
    expect(r.why).toContain("hook");
  });

  it("falls back to 0 on missing fields", () => {
    const r = parseHookVisionResponse("{}");
    expect(r.onScreenText).toBe(0);
    expect(r.motion).toBe(0);
    expect(r.subjectClarity).toBe(0);
    expect(r.emotionalIntensity).toBe(0);
  });

  it("clamps out-of-range values to [0,1]", () => {
    const r = parseHookVisionResponse(
      JSON.stringify({ onScreenText: 99, motion: -5, subjectClarity: 0.5, emotionalIntensity: 1 }),
    );
    expect(r.onScreenText).toBe(1);
    expect(r.motion).toBe(0);
  });

  it("survives prose wrapping around the JSON", () => {
    const r = parseHookVisionResponse(
      'Here:\n{"onScreenText":0.5,"motion":0.5,"subjectClarity":0.5,"emotionalIntensity":0.5}\nDone.',
    );
    expect(r.onScreenText).toBe(0.5);
  });

  it("throws on totally absent JSON", () => {
    expect(() => parseHookVisionResponse("no json")).toThrow(/no JSON/);
  });
});

describe("buildHookResult", () => {
  const strong = {
    onScreenText: 0.9,
    motion: 0.8,
    subjectClarity: 0.9,
    emotionalIntensity: 0.8,
    why: "strong",
  };
  const weak = {
    onScreenText: 0.1,
    motion: 0.1,
    subjectClarity: 0.1,
    emotionalIntensity: 0.1,
    why: "weak",
  };

  it("produces a high score for a strong hook", () => {
    const r = buildHookResult(1, strong);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.passes).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("produces a low score for a weak hook", () => {
    const r = buildHookResult(0, weak);
    expect(r.score).toBeLessThanOrEqual(15);
    expect(r.passes).toBe(false);
    // All five findings should fire.
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain("silent_open");
    expect(ids).toContain("no_on_screen_text");
    expect(ids).toContain("static_first_frame");
    expect(ids).toContain("no_clear_subject");
    expect(ids).toContain("weak_emotional_hook");
  });

  it("flags silent_open with severity=block when speech < 0.2", () => {
    const r = buildHookResult(0.05, strong);
    const f = r.findings.find((x) => x.id === "silent_open");
    expect(f?.severity).toBe("block");
  });

  it("flags silent_open with severity=warn when 0.2 <= speech < 0.5", () => {
    const r = buildHookResult(0.3, strong);
    const f = r.findings.find((x) => x.id === "silent_open");
    expect(f?.severity).toBe("warn");
  });

  it("does not flag silent_open when speech >= 0.5", () => {
    const r = buildHookResult(0.6, strong);
    expect(r.findings.find((x) => x.id === "silent_open")).toBeUndefined();
  });

  it("respects a custom passThreshold", () => {
    const r = buildHookResult(0.5, {
      onScreenText: 0.5,
      motion: 0.5,
      subjectClarity: 0.5,
      emotionalIntensity: 0.5,
      why: "mid",
    });
    // Score ≈ 50 with default weights; passes at threshold 50.
    expect(buildHookResult(0.5, r).score).toBeGreaterThanOrEqual(0);
    expect(
      buildHookResult(
        0.5,
        {
          onScreenText: 0.5,
          motion: 0.5,
          subjectClarity: 0.5,
          emotionalIntensity: 0.5,
          why: "mid",
        },
        { passThreshold: 40 },
      ).passes,
    ).toBe(true);
    expect(
      buildHookResult(
        0.5,
        {
          onScreenText: 0.5,
          motion: 0.5,
          subjectClarity: 0.5,
          emotionalIntensity: 0.5,
          why: "mid",
        },
        { passThreshold: 90 },
      ).passes,
    ).toBe(false);
  });
});
