import { describe, expect, it } from "vitest";
import { tuiOutputCap } from "./output-cap.js";

describe("tuiOutputCap", () => {
  it("uses the model's own output ceiling instead of the flat fallback", () => {
    expect(
      tuiOutputCap({ provider: "anthropic", model: "claude-opus-5-5", fallback: 16_384 }),
    ).toBe(128_000);
  });

  it("trims a ceiling that would not fit beside the compaction trigger", () => {
    expect(tuiOutputCap({ provider: "moonshot", model: "kimi-k2.7-code", fallback: 16_384 })).toBe(
      39_321,
    );
  });

  it("falls back for a model missing from the registry", () => {
    expect(tuiOutputCap({ provider: "local", model: "local/x/unknown", fallback: 16_384 })).toBe(
      16_384,
    );
  });
});
