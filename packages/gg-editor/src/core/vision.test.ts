import { describe, expect, it } from "vitest";
import { clampScore, clampWhy, parseScoreResponse } from "./vision.js";

describe("parseScoreResponse", () => {
  it("parses a clean JSON array", () => {
    const out = parseScoreResponse(
      '[{"score":9,"why":"sharp eyes"},{"score":3,"why":"blurry"}]',
      2,
    );
    expect(out).toEqual([
      { score: 9, why: "sharp eyes" },
      { score: 3, why: "blurry" },
    ]);
  });

  it("unwraps an object containing the array", () => {
    const out = parseScoreResponse('{"shots":[{"score":7,"why":"ok"}]}', 1);
    expect(out).toEqual([{ score: 7, why: "ok" }]);
  });

  it("recovers from prose-wrapped JSON", () => {
    const content = 'Sure! Here are the scores: [{"score":8,"why":"good"}] hope this helps';
    const out = parseScoreResponse(content, 1);
    expect(out).toEqual([{ score: 8, why: "good" }]);
  });

  it("pads missing entries to expected length", () => {
    const out = parseScoreResponse('[{"score":5,"why":"x"}]', 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ score: 5, why: "x" });
    expect(out[1]).toEqual({});
    expect(out[2]).toEqual({});
  });

  it("truncates extra entries to expected length", () => {
    const out = parseScoreResponse(
      '[{"score":1,"why":"a"},{"score":2,"why":"b"},{"score":3,"why":"c"}]',
      2,
    );
    expect(out).toHaveLength(2);
  });

  it("returns empty objects on invalid input", () => {
    const out = parseScoreResponse("not json at all", 2);
    expect(out).toEqual([{}, {}]);
  });
});

describe("clampScore", () => {
  it("keeps scores already in [0, 10]", () => {
    expect(clampScore(0)).toBe(0);
    expect(clampScore(7.4)).toBe(7.4);
    expect(clampScore(10)).toBe(10);
  });
  it("clamps out-of-range scores", () => {
    expect(clampScore(-3)).toBe(0);
    expect(clampScore(99)).toBe(10);
  });
  it("rounds to one decimal place", () => {
    expect(clampScore(7.456)).toBe(7.5);
    expect(clampScore(7.44)).toBe(7.4);
  });
  it("coerces string-numbers (LLMs sometimes wrap numbers in strings)", () => {
    expect(clampScore("8")).toBe(8);
    expect(clampScore("8.7")).toBe(8.7);
  });
  it("defaults non-finite values to 0", () => {
    expect(clampScore(NaN)).toBe(0);
    expect(clampScore(undefined)).toBe(0);
    expect(clampScore(null)).toBe(0);
    expect(clampScore("not a number")).toBe(0);
  });
});

describe("clampWhy", () => {
  it("passes short strings unchanged", () => {
    expect(clampWhy("sharp eyes, well-lit")).toBe("sharp eyes, well-lit");
  });
  it("truncates at 80 chars (no ellipsis — caller's choice)", () => {
    const long = "x".repeat(100);
    expect(clampWhy(long)).toHaveLength(80);
  });
  it("collapses non-strings to empty", () => {
    expect(clampWhy(42)).toBe("");
    expect(clampWhy(undefined)).toBe("");
    expect(clampWhy(null)).toBe("");
    expect(clampWhy({ note: "x" })).toBe("");
  });
});
