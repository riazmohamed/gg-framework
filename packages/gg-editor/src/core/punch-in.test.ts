import { describe, expect, it } from "vitest";
import { buildPunchInFilter, punchInsAfterCuts } from "./punch-in.js";

describe("buildPunchInFilter", () => {
  it("returns empty string when there are no ranges", () => {
    expect(buildPunchInFilter([], 1920, 1080)).toBe("");
  });

  it("emits a crop+scale filter for a single range", () => {
    const f = buildPunchInFilter([{ startSec: 1, endSec: 2, zoom: 1.1 }], 1920, 1080);
    expect(f).toContain("crop=");
    expect(f).toContain("scale=1920:1080");
    expect(f).toContain("between(t");
    // Centered crop math:
    expect(f).toContain("(iw-out_w)/2");
    expect(f).toContain("(ih-out_h)/2");
    // Inside the range, width = iw / zoom
    expect(f).toContain("iw/1.1");
    expect(f).toContain("ih/1.1");
  });

  it("nests multiple ranges into a single piecewise expression", () => {
    const f = buildPunchInFilter(
      [
        { startSec: 1, endSec: 2, zoom: 1.1 },
        { startSec: 5, endSec: 6, zoom: 1.2 },
      ],
      1920,
      1080,
    );
    // Both zoom levels appear:
    expect(f).toContain("iw/1.1");
    expect(f).toContain("iw/1.2");
    // And both ranges:
    expect(f).toContain("between(t\\,1\\,2)");
    expect(f).toContain("between(t\\,5\\,6)");
  });

  it("falls through to a no-op (full source size) outside ranges", () => {
    const f = buildPunchInFilter([{ startSec: 1, endSec: 2, zoom: 1.1 }], 1920, 1080);
    // The ELSE branch of the outermost if() should reference iw / ih.
    // Walk: if(between(t,1,2), iw/1.1, iw)
    expect(f).toMatch(/iw\/1\.1\\,iw/);
    expect(f).toMatch(/ih\/1\.1\\,ih/);
  });

  it("clamps zoom into [1.0, 2.0]", () => {
    // 9.0 should clamp to 2.0; 0.5 should clamp to 1.0 (and then be filtered out).
    const f = buildPunchInFilter(
      [
        { startSec: 1, endSec: 2, zoom: 9.0 },
        { startSec: 3, endSec: 4, zoom: 0.5 },
      ],
      1920,
      1080,
    );
    expect(f).toContain("iw/2");
    // The 0.5-zoom range collapses to a no-op and should be dropped:
    expect(f).not.toContain("between(t\\,3\\,4)");
  });

  it("uses defaultZoom when an explicit zoom is missing or 0", () => {
    const f = buildPunchInFilter([{ startSec: 1, endSec: 2, zoom: 0 }], 1920, 1080, {
      defaultZoom: 1.15,
    });
    expect(f).toContain("iw/1.15");
  });

  it("applies a ramp expression when rampSec > 0", () => {
    const f = buildPunchInFilter([{ startSec: 1, endSec: 2, zoom: 1.1 }], 1920, 1080, {
      rampSec: 0.1,
    });
    expect(f).toContain("clip(");
    expect(f).toContain("min(");
    // Constant zoom term should NOT appear when ramping:
    expect(f).not.toContain("iw/1.1,");
  });

  it("rejects non-positive source dimensions", () => {
    expect(() => buildPunchInFilter([{ startSec: 0, endSec: 1, zoom: 1.1 }], 0, 1080)).toThrow();
    expect(() => buildPunchInFilter([{ startSec: 0, endSec: 1, zoom: 1.1 }], 1920, -1)).toThrow();
  });

  it("drops zero-duration / inverted ranges", () => {
    const f = buildPunchInFilter(
      [
        { startSec: 1, endSec: 1, zoom: 1.1 },
        { startSec: 5, endSec: 4, zoom: 1.1 },
        { startSec: 10, endSec: 11, zoom: 1.1 },
      ],
      1920,
      1080,
    );
    expect(f).toContain("between(t\\,10\\,11)");
    expect(f).not.toContain("between(t\\,1\\,1)");
    expect(f).not.toContain("between(t\\,5\\,4)");
  });

  it("emits ranges sorted by start time even when caller passes them out of order", () => {
    const f = buildPunchInFilter(
      [
        { startSec: 5, endSec: 6, zoom: 1.2 },
        { startSec: 1, endSec: 2, zoom: 1.1 },
      ],
      1920,
      1080,
    );
    // Outer if should be the first sorted range; inner else handles the second.
    const idx1 = f.indexOf("between(t\\,1\\,2)");
    const idx5 = f.indexOf("between(t\\,5\\,6)");
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx5).toBeGreaterThanOrEqual(0);
    expect(idx1).toBeLessThan(idx5);
  });
});

describe("punchInsAfterCuts", () => {
  it("emits a punch range starting at each cut", () => {
    const ranges = punchInsAfterCuts([2, 5, 9], 12, 1.5, 1.1);
    expect(ranges).toEqual([
      { startSec: 2, endSec: 3.5, zoom: 1.1 },
      { startSec: 5, endSec: 6.5, zoom: 1.1 },
      { startSec: 9, endSec: 10.5, zoom: 1.1 },
    ]);
  });

  it("never overlaps the next cut", () => {
    const ranges = punchInsAfterCuts([2, 2.4], 10, 1.5, 1.1);
    expect(ranges[0].endSec).toBe(2.4);
    expect(ranges[1].startSec).toBe(2.4);
  });

  it("clips the last range at totalSec", () => {
    const ranges = punchInsAfterCuts([8.5], 9, 1.5, 1.1);
    expect(ranges[0].endSec).toBe(9);
  });

  it("filters out cuts outside [0, totalSec)", () => {
    const ranges = punchInsAfterCuts([-1, 0, 5, 11, 12], 10);
    expect(ranges.map((r) => r.startSec)).toEqual([0, 5]);
  });

  it("drops sub-100ms residual ranges", () => {
    // cut at 9.95 with totalSec 10 → 0.05s window — too small.
    const ranges = punchInsAfterCuts([9.95], 10, 1.5, 1.1);
    expect(ranges).toEqual([]);
  });
});
