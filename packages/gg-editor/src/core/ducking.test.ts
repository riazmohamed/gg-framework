import { describe, expect, it } from "vitest";
import { buildDuckingFilter } from "./ducking.js";

describe("buildDuckingFilter", () => {
  it("uses default threshold/ratio/attack/release", () => {
    const f = buildDuckingFilter();
    expect(f).toContain("threshold=0.02");
    expect(f).toContain("ratio=8");
    expect(f).toContain("attack=5");
    expect(f).toContain("release=250");
  });

  it("respects overrides", () => {
    const f = buildDuckingFilter({
      threshold: 0.02,
      ratio: 12,
      attackMs: 1,
      releaseMs: 400,
    });
    expect(f).toContain("threshold=0.02");
    expect(f).toContain("ratio=12");
    expect(f).toContain("attack=1");
    expect(f).toContain("release=400");
  });

  it("splits the voice into output + sidechain key", () => {
    const f = buildDuckingFilter();
    expect(f).toContain("asplit=2[voiceOut][voiceKey]");
  });

  it("mixes voice + ducked bg into [out]", () => {
    const f = buildDuckingFilter();
    expect(f).toContain("[voiceOut][ducked]amix");
    expect(f).toMatch(/\[out\]$/);
  });

  it("applies bg + voice gain controls", () => {
    const f = buildDuckingFilter({ voiceGain: 1.2, bgGain: 0.3 });
    expect(f).toContain("[1:a]volume=0.3");
    expect(f).toContain("[0:a]volume=1.2");
  });
});
