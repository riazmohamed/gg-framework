import { describe, expect, it } from "vitest";
import { buildMixFilter } from "./audio-mix.js";

describe("buildMixFilter", () => {
  it("rejects an empty chain", () => {
    expect(() => buildMixFilter({})).toThrow(/empty chain/);
  });

  it("emits a high-pass band", () => {
    const f = buildMixFilter({
      eq: [{ type: "high", freqHz: 80 }],
    });
    expect(f).toBe("highpass=f=80");
  });

  it("emits a low-pass band", () => {
    const f = buildMixFilter({ eq: [{ type: "low", freqHz: 12000 }] });
    expect(f).toBe("lowpass=f=12000");
  });

  it("emits a peak band with frequency, q, gain", () => {
    const f = buildMixFilter({
      eq: [{ type: "peak", freqHz: 5000, gainDb: 3, q: 1.5 }],
    });
    expect(f).toContain("equalizer=f=5000");
    expect(f).toContain("t=q");
    expect(f).toContain("w=1.5");
    expect(f).toContain("g=3");
  });

  it("emits low-shelf and high-shelf as bass / treble", () => {
    const f = buildMixFilter({
      eq: [
        { type: "shelf-low", freqHz: 200, gainDb: -2 },
        { type: "shelf-high", freqHz: 8000, gainDb: 4 },
      ],
    });
    expect(f).toContain("bass=g=-2:f=200");
    expect(f).toContain("treble=g=4:f=8000");
  });

  it("emits acompressor with linearized threshold", () => {
    const f = buildMixFilter({
      compressor: { thresholdDb: -18, ratio: 4 },
    });
    expect(f).toMatch(/^acompressor:/);
    expect(f).toContain("ratio=4");
    // -18 dB ≈ 0.125892541 linear; the formatter trims trailing zeros.
    expect(f).toMatch(/threshold=0\.125/);
  });

  it("emits agate before everything else when supplied", () => {
    const f = buildMixFilter({
      gate: { thresholdDb: -50 },
      compressor: { thresholdDb: -18, ratio: 4 },
    });
    // Gate index < compressor index.
    expect(f.indexOf("agate")).toBeLessThan(f.indexOf("acompressor"));
  });

  it("emits limiter with -1 dB ceiling", () => {
    const f = buildMixFilter({ limiter: { ceilingDb: -1 } });
    expect(f).toMatch(/^alimiter:/);
    // -1 dB ≈ 0.891 linear.
    expect(f).toMatch(/limit=0\.89/);
    expect(f).toContain("level=disabled");
  });

  it("emits adynamicequalizer for de-esser", () => {
    const f = buildMixFilter({ deess: { freqHz: 6500, thresholdDb: -25 } });
    expect(f).toMatch(/^adynamicequalizer/);
    expect(f).toContain("dfrequency=6500");
    expect(f).toContain("mode=cut");
  });

  it("chains multiple effects in canonical order: gate, eq, deess, comp, reverb, limiter", () => {
    const f = buildMixFilter({
      gate: { thresholdDb: -50 },
      eq: [{ type: "high", freqHz: 80 }],
      deess: {},
      compressor: { thresholdDb: -18, ratio: 4 },
      reverb: { roomSize: 0.4, wetDryMix: 0.2 },
      limiter: { ceilingDb: -1 },
    });
    const order = ["agate", "highpass", "adynamicequalizer", "acompressor", "aecho", "alimiter"];
    let cursor = 0;
    for (const tag of order) {
      const idx = f.indexOf(tag, cursor);
      expect(idx).toBeGreaterThan(-1);
      cursor = idx;
    }
  });

  it("emits aecho for reverb with appropriate delays/decays", () => {
    const f = buildMixFilter({ reverb: { roomSize: 0.5, wetDryMix: 0.3 } });
    expect(f).toContain("aecho=");
    // Two delay/decay channels separated by |
    expect(f).toMatch(/delays=\d+\|\d+/);
    expect(f).toMatch(/decays=[\d.]+\|[\d.]+/);
  });
});
