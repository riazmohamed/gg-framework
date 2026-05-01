import { describe, expect, it } from "vitest";
import { buildSkinGradeFilter, parseSkinGradeResponse, type SkinGrade } from "./skin-grade.js";

const NEUTRAL_GRADE: SkinGrade = {
  colorbalance: {
    shadows: [0, 0, 0],
    midtones: [0, 0, 0],
    highlights: [0, 0, 0],
  },
  selectivecolor: {
    reds: [0, 0, 0, 0],
    yellows: [0, 0, 0, 0],
  },
  eq: {
    saturation: 1,
    contrast: 1,
    brightness: 0,
  },
  cdl: {
    slope: [1, 1, 1],
    offset: [0, 0, 0],
    power: [1, 1, 1],
    saturation: 1,
  },
  confidence: 0,
  why: "",
};

describe("buildSkinGradeFilter", () => {
  it("emits empty string for neutral grade", () => {
    expect(buildSkinGradeFilter(NEUTRAL_GRADE)).toBe("");
  });

  it("emits a colorbalance segment when color balance is non-neutral", () => {
    const grade: SkinGrade = {
      ...NEUTRAL_GRADE,
      colorbalance: {
        shadows: [0.05, 0, -0.05],
        midtones: [0.1, 0, -0.1],
        highlights: [0, 0, 0],
      },
    };
    const f = buildSkinGradeFilter(grade);
    expect(f).toContain("colorbalance=");
    expect(f).toContain("rs=0.05");
    expect(f).toContain("bm=-0.1");
    expect(f).toContain("rh=0");
    expect(f).not.toContain("selectivecolor=");
    expect(f).not.toContain("eq=");
  });

  it("emits a selectivecolor segment with reds/yellows tuples", () => {
    const grade: SkinGrade = {
      ...NEUTRAL_GRADE,
      selectivecolor: {
        reds: [0.1, -0.05, 0.2, 0],
        yellows: [0, 0.1, -0.1, 0.05],
      },
    };
    const f = buildSkinGradeFilter(grade);
    expect(f).toContain("selectivecolor=reds=0.1 -0.05 0.2 0");
    expect(f).toContain("yellows=0 0.1 -0.1 0.05");
  });

  it("emits an eq segment when saturation/contrast/brightness are non-neutral", () => {
    const grade: SkinGrade = {
      ...NEUTRAL_GRADE,
      eq: { saturation: 1.1, contrast: 1.05, brightness: 0.02 },
    };
    const f = buildSkinGradeFilter(grade);
    expect(f).toBe("eq=saturation=1.1:contrast=1.05:brightness=0.02");
  });

  it("chains all three components in canonical order", () => {
    const grade: SkinGrade = {
      ...NEUTRAL_GRADE,
      colorbalance: {
        shadows: [0, 0, 0],
        midtones: [0.05, 0, -0.05],
        highlights: [0, 0, 0],
      },
      selectivecolor: {
        reds: [0.1, 0, 0, 0],
        yellows: [0, 0, 0, 0],
      },
      eq: { saturation: 1.05, contrast: 1, brightness: 0 },
    };
    const f = buildSkinGradeFilter(grade);
    const cbIdx = f.indexOf("colorbalance=");
    const scIdx = f.indexOf("selectivecolor=");
    const eqIdx = f.indexOf("eq=");
    expect(cbIdx).toBeGreaterThanOrEqual(0);
    expect(scIdx).toBeGreaterThan(cbIdx);
    expect(eqIdx).toBeGreaterThan(scIdx);
  });
});

describe("parseSkinGradeResponse", () => {
  it("parses a fully-populated response", () => {
    const json = JSON.stringify({
      colorbalance: {
        shadows: [0, 0, 0],
        midtones: [0.05, 0, -0.05],
        highlights: [0.02, 0, -0.02],
      },
      selectivecolor: {
        reds: [0.1, 0, -0.1, 0],
        yellows: [0, 0.05, -0.05, 0],
      },
      eq: { saturation: 1.1, contrast: 1.05, brightness: 0.02 },
      cdl: {
        slope: [1.05, 1, 0.95],
        offset: [0.02, 0, -0.02],
        power: [1, 1, 1],
        saturation: 1.05,
      },
      confidence: 0.7,
      why: "warmth lift",
    });
    const g = parseSkinGradeResponse(json);
    expect(g.colorbalance.midtones).toEqual([0.05, 0, -0.05]);
    expect(g.selectivecolor.reds).toEqual([0.1, 0, -0.1, 0]);
    expect(g.eq.saturation).toBe(1.1);
    expect(g.cdl.slope).toEqual([1.05, 1, 0.95]);
    expect(g.confidence).toBe(0.7);
    expect(g.why).toBe("warmth lift");
  });

  it("falls back to neutral on missing fields", () => {
    const g = parseSkinGradeResponse('{"confidence":0.9}');
    expect(g.colorbalance.shadows).toEqual([0, 0, 0]);
    expect(g.selectivecolor.reds).toEqual([0, 0, 0, 0]);
    expect(g.eq.saturation).toBe(1);
    expect(g.cdl.slope).toEqual([1, 1, 1]);
    expect(g.confidence).toBe(0.9);
  });

  it("clamps colorbalance / selectivecolor / eq / cdl into safe ranges", () => {
    const json = JSON.stringify({
      colorbalance: {
        shadows: [9, -9, 9],
        midtones: [9, 9, 9],
        highlights: [9, 9, 9],
      },
      selectivecolor: {
        reds: [9, -9, 9, 9],
        yellows: [-9, 9, -9, 9],
      },
      eq: { saturation: 99, contrast: 99, brightness: 99 },
      cdl: {
        slope: [99, 0.001, 99],
        offset: [99, -99, 99],
        power: [99, 99, 0.001],
        saturation: 99,
      },
      confidence: 99,
    });
    const g = parseSkinGradeResponse(json);
    expect(g.colorbalance.shadows).toEqual([0.5, -0.5, 0.5]);
    expect(g.selectivecolor.reds).toEqual([1, -1, 1, 1]);
    expect(g.eq.saturation).toBe(3);
    expect(g.eq.brightness).toBe(0.3);
    expect(g.cdl.slope[0]).toBe(2);
    expect(g.cdl.slope[1]).toBe(0.5);
    expect(g.cdl.offset[0]).toBe(0.3);
    expect(g.cdl.offset[1]).toBe(-0.3);
    expect(g.cdl.saturation).toBe(3);
    expect(g.confidence).toBe(1);
  });

  it("survives prose wrapping around the JSON", () => {
    const g = parseSkinGradeResponse('Here is the result:\n{"eq":{"saturation":1.1}}\nThanks.');
    expect(g.eq.saturation).toBe(1.1);
  });

  it("rejects non-array tuple fields gracefully", () => {
    const g = parseSkinGradeResponse(
      JSON.stringify({
        colorbalance: { shadows: "nope", midtones: [1, 2] },
        selectivecolor: { reds: [1, 2, 3] },
      }),
    );
    expect(g.colorbalance.shadows).toEqual([0, 0, 0]);
    expect(g.colorbalance.midtones).toEqual([0, 0, 0]);
    expect(g.selectivecolor.reds).toEqual([0, 0, 0, 0]);
  });

  it("throws on totally absent JSON", () => {
    expect(() => parseSkinGradeResponse("no json at all")).toThrow(/no JSON/);
  });

  it("neutral parsed grade produces empty filter string", () => {
    const g = parseSkinGradeResponse("{}");
    expect(buildSkinGradeFilter(g)).toBe("");
  });
});
