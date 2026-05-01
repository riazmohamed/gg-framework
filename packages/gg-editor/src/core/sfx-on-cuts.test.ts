import { describe, expect, it } from "vitest";
import { buildSfxOnCutsFilter } from "./sfx-on-cuts.js";

describe("buildSfxOnCutsFilter", () => {
  it("emits a no-op graph when there are no cut points", () => {
    const r = buildSfxOnCutsFilter({ cutPoints: [], totalSec: 10 });
    expect(r.filterComplex).toBe("[0:a]anull[mix]");
    expect(r.hits).toBe(0);
  });

  it("emits one delayed SFX copy per cut, mixed with the original", () => {
    const r = buildSfxOnCutsFilter({ cutPoints: [1, 2.5, 4], totalSec: 10 });
    expect(r.hits).toBe(3);
    expect(r.filterComplex).toContain("adelay=1000|1000");
    expect(r.filterComplex).toContain("adelay=2500|2500");
    expect(r.filterComplex).toContain("adelay=4000|4000");
    // Final mix should sum 1 (original) + 3 (sfx copies) = 4 inputs.
    expect(r.filterComplex).toContain("amix=inputs=4");
  });

  it("drops cut points outside [0, totalSec)", () => {
    const r = buildSfxOnCutsFilter({ cutPoints: [-1, 0, 5, 10, 11], totalSec: 10 });
    expect(r.hits).toBe(2);
  });

  it("dedupes cut points within minSpacingSec", () => {
    const r = buildSfxOnCutsFilter({
      cutPoints: [1, 1.1, 1.2, 2, 2.1, 5],
      totalSec: 10,
      minSpacingSec: 0.25,
    });
    // Expect: keep 1, drop 1.1 and 1.2, keep 2 (dist from 1 = 1s ≥ 0.25),
    // drop 2.1, keep 5.
    expect(r.hits).toBe(3);
  });

  it("renders sfxGainDb as a linear volume coefficient", () => {
    // -6dB ≈ 0.5012
    const r = buildSfxOnCutsFilter({ cutPoints: [1], totalSec: 10, sfxGainDb: -6 });
    expect(r.filterComplex).toContain("volume=0.5012");
  });

  it("inserts a sidechaincompress stage when duckDb < 0", () => {
    const r = buildSfxOnCutsFilter({ cutPoints: [1], totalSec: 10, duckDb: -6 });
    expect(r.filterComplex).toContain("sidechaincompress");
    expect(r.filterComplex).toContain("[ducked]");
    expect(r.filterComplex).toContain("amix=inputs=2"); // ducked original + 1 sfx
  });

  it("does NOT insert sidechaincompress when duckDb is 0", () => {
    const r = buildSfxOnCutsFilter({ cutPoints: [1], totalSec: 10, duckDb: 0 });
    expect(r.filterComplex).not.toContain("sidechaincompress");
  });

  it("uses integer ms in adelay (no decimals)", () => {
    const r = buildSfxOnCutsFilter({ cutPoints: [1.2342], totalSec: 10 });
    expect(r.filterComplex).toContain("adelay=1234|1234");
    expect(r.filterComplex).not.toMatch(/adelay=\d+\.\d+/);
  });
});
