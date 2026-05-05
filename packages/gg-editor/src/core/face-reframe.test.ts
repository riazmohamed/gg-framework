import { describe, expect, it } from "vitest";
import {
  buildReframeFilter,
  parseAspect,
  reframeCropSize,
  type ReframePlan,
} from "./face-reframe.js";

function plan(overrides: Partial<ReframePlan> = {}): ReframePlan {
  return {
    shots: [],
    totalSec: 10,
    fps: 30,
    sourceWidth: 1920,
    sourceHeight: 1080,
    ...overrides,
  };
}

describe("parseAspect", () => {
  it("parses each supported ratio", () => {
    expect(parseAspect("9:16")).toEqual({ w: 9, h: 16 });
    expect(parseAspect("1:1")).toEqual({ w: 1, h: 1 });
    expect(parseAspect("4:5")).toEqual({ w: 4, h: 5 });
    expect(parseAspect("16:9")).toEqual({ w: 16, h: 9 });
  });
});

describe("reframeCropSize", () => {
  it("9:16 from 1920x1080 → height-bound; outW = 1080 * 9/16 = 607 → even 606", () => {
    const { outW, outH } = reframeCropSize(1920, 1080, "9:16");
    expect(outH).toBe(1080);
    expect(outW).toBe(606); // floor(607.5) -> 607 -> even-floor 606
  });

  it("1:1 from 1920x1080 → height-bound; outW = outH = 1080", () => {
    const { outW, outH } = reframeCropSize(1920, 1080, "1:1");
    expect(outW).toBe(1080);
    expect(outH).toBe(1080);
  });

  it("4:5 from 1920x1080 → height-bound; outW = 1080 * 4/5 = 864", () => {
    const { outW, outH } = reframeCropSize(1920, 1080, "4:5");
    expect(outH).toBe(1080);
    expect(outW).toBe(864);
  });

  it("16:9 from 1920x1080 → width-bound (full source)", () => {
    const { outW, outH } = reframeCropSize(1920, 1080, "16:9");
    expect(outW).toBe(1920);
    expect(outH).toBe(1080);
  });

  it("9:16 from a square 1080x1080 source → width-bound; outH > srcH? no — width-bound", () => {
    // height-from-w = 1080 * 16/9 = 1920 > srcH 1080 → fall to height-bound:
    // outH = 1080, outW = 1080 * 9 / 16 = 607.5 → 606
    const { outW, outH } = reframeCropSize(1080, 1080, "9:16");
    expect(outH).toBe(1080);
    expect(outW).toBe(606);
  });

  it("rejects non-positive source dimensions", () => {
    expect(() => reframeCropSize(0, 1080, "9:16")).toThrow();
    expect(() => reframeCropSize(1920, -1, "9:16")).toThrow();
  });
});

describe("buildReframeFilter", () => {
  it("emits a centre-crop filter when there are no shots (filter falls through to centreX)", () => {
    const r = buildReframeFilter(plan({ shots: [] }), "9:16");
    // outW from 1920x1080 9:16 = 606; centreX = floor((1920-606)/2) = 657
    expect(r.outWidth).toBe(606);
    expect(r.outHeight).toBe(1080);
    // No shots → no `if(...)` wrapping; filter = "crop=606:1080:x='657':y=0"
    expect(r.filter).toBe("crop=606:1080:x='657':y=0");
    expect(r.shotXs).toEqual([]);
  });

  it("clamps a face at the right edge to the maximum legal X", () => {
    const p = plan({
      shots: [
        {
          startSec: 0,
          endSec: 5,
          frames: [],
          smoothedX: 0.99, // pushes crop way past the right edge
          smoothedY: 0.5,
          mode: "face",
        },
      ],
    });
    const r = buildReframeFilter(p, "9:16");
    // maxX = 1920 - 606 = 1314
    expect(r.shotXs[0]).toBe(1314);
    expect(r.filter).toContain("between(t\\,0\\,5)");
    expect(r.filter).toContain("\\,1314\\,");
  });

  it("clamps a face at the left edge to X=0", () => {
    const p = plan({
      shots: [
        {
          startSec: 1,
          endSec: 2,
          frames: [],
          smoothedX: 0.01,
          smoothedY: 0.5,
          mode: "face",
        },
      ],
    });
    const r = buildReframeFilter(p, "9:16");
    expect(r.shotXs[0]).toBe(0);
    expect(r.filter).toContain("between(t\\,1\\,2)");
    expect(r.filter).toContain("\\,0\\,");
  });

  it("uses centred X for a face at exact 0.5", () => {
    const p = plan({
      shots: [
        {
          startSec: 0,
          endSec: 4,
          frames: [],
          smoothedX: 0.5,
          smoothedY: 0.5,
          mode: "face",
        },
      ],
    });
    const r = buildReframeFilter(p, "9:16");
    // desiredCx = round(0.5 * 1920) = 960; x = 960 - floor(606/2) = 960 - 303 = 657
    expect(r.shotXs[0]).toBe(657);
  });

  it("nests two shots into a single piecewise X expression", () => {
    const p = plan({
      shots: [
        { startSec: 0, endSec: 3, frames: [], smoothedX: 0.3, smoothedY: 0.5, mode: "face" },
        { startSec: 3, endSec: 6, frames: [], smoothedX: 0.7, smoothedY: 0.5, mode: "face" },
      ],
    });
    const r = buildReframeFilter(p, "9:16");
    expect(r.shotXs).toHaveLength(2);
    expect(r.filter).toContain("between(t\\,0\\,3)");
    expect(r.filter).toContain("between(t\\,3\\,6)");
    // Outer if() should be the FIRST shot (sorted by start); inner the SECOND.
    const idx0 = r.filter.indexOf("between(t\\,0\\,3)");
    const idx3 = r.filter.indexOf("between(t\\,3\\,6)");
    expect(idx0).toBeGreaterThanOrEqual(0);
    expect(idx3).toBeGreaterThan(idx0);
    // Final fallback (centre): 657 appears as the innermost else of x='...'.
    // x is wrapped in single quotes; closing the y arg follows.
    expect(r.filter).toMatch(/657\)\)':y=0$/);
  });

  it("produces an even outW × outH for libx264 compatibility", () => {
    // Test a few odd source resolutions.
    for (const [w, h] of [
      [1280, 720],
      [3840, 2160],
      [1281, 721],
    ]) {
      const r = buildReframeFilter(plan({ sourceWidth: w, sourceHeight: h }), "9:16");
      expect(r.outWidth % 2).toBe(0);
      expect(r.outHeight % 2).toBe(0);
    }
  });

  it("sorts shots by startSec even when caller passes them out of order", () => {
    const p = plan({
      shots: [
        { startSec: 5, endSec: 7, frames: [], smoothedX: 0.7, smoothedY: 0.5, mode: "face" },
        { startSec: 0, endSec: 2, frames: [], smoothedX: 0.3, smoothedY: 0.5, mode: "face" },
      ],
    });
    const r = buildReframeFilter(p, "9:16");
    const idx0 = r.filter.indexOf("between(t\\,0\\,2)");
    const idx5 = r.filter.indexOf("between(t\\,5\\,7)");
    // Outer wraps inner; the FIRST sorted shot must appear first in the string.
    expect(idx0).toBeGreaterThanOrEqual(0);
    expect(idx5).toBeGreaterThan(idx0);
  });

  it("includes scale-back? — nope; we only emit a single crop filter (no scale)", () => {
    // The tool layer chooses whether to upscale; the filter we emit is a
    // pure crop. Verify there's no `scale=` in the output.
    const r = buildReframeFilter(plan({ shots: [] }), "9:16");
    expect(r.filter).not.toContain("scale=");
  });
});
