import { describe, expect, it } from "vitest";
import { parseColorMatchResponse } from "./color-match.js";

describe("parseColorMatchResponse", () => {
  it("parses a well-formed CDL JSON object", () => {
    const r = parseColorMatchResponse(
      '{"slope":[1.05,1.0,0.95],"offset":[0,0,0.02],"power":[1,1,1],"saturation":1.05,"confidence":0.7,"why":"warm shift"}',
    );
    expect(r.slope).toEqual([1.05, 1.0, 0.95]);
    expect(r.offset).toEqual([0, 0, 0.02]);
    expect(r.saturation).toBe(1.05);
    expect(r.confidence).toBe(0.7);
    expect(r.why).toBe("warm shift");
  });

  it("falls back to neutral on missing fields", () => {
    const r = parseColorMatchResponse('{"confidence":0.9}');
    expect(r.slope).toEqual([1, 1, 1]);
    expect(r.offset).toEqual([0, 0, 0]);
    expect(r.power).toEqual([1, 1, 1]);
    expect(r.saturation).toBe(1);
    expect(r.confidence).toBe(0.9);
  });

  it("clamps saturation and confidence to sane ranges", () => {
    const r = parseColorMatchResponse('{"saturation":99,"confidence":2}');
    expect(r.saturation).toBe(4);
    expect(r.confidence).toBe(1);
  });

  it("survives prose wrapping around the JSON", () => {
    const r = parseColorMatchResponse(
      'Here is the result:\n{"saturation":1.1,"confidence":0.5}\nThanks',
    );
    expect(r.saturation).toBe(1.1);
    expect(r.confidence).toBe(0.5);
  });

  it("throws on totally absent JSON", () => {
    expect(() => parseColorMatchResponse("no json at all")).toThrow(/no JSON/);
  });

  it("rejects non-array slope/offset/power gracefully", () => {
    const r = parseColorMatchResponse('{"slope":"not-an-array","offset":[1,2]}');
    expect(r.slope).toEqual([1, 1, 1]);
    // offset is wrong length → fallback
    expect(r.offset).toEqual([0, 0, 0]);
  });
});
