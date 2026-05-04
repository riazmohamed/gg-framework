import { describe, expect, it } from "vitest";

// We test the keep-range computation indirectly via the keepRangesFromFillers
// helper that text_based_cut wraps. The tool's own validation/merge logic is
// covered here by exercising the public interface.
import { keepRangesFromFillers, keepRangesToFrameRanges } from "../core/filler-words.js";

describe("text_based_cut keep-range math (via keepRangesFromFillers)", () => {
  it("emits two keeps when one cut is in the middle", () => {
    const cuts = [{ startSec: 5, endSec: 10, text: "x", startWordIndex: 0, endWordIndex: 0 }];
    const keeps = keepRangesFromFillers(cuts, 30, 0);
    expect(keeps).toEqual([
      { startSec: 0, endSec: 5 },
      { startSec: 10, endSec: 30 },
    ]);
  });

  it("emits one keep when cuts are at the start", () => {
    const cuts = [{ startSec: 0, endSec: 5, text: "head", startWordIndex: 0, endWordIndex: 0 }];
    const keeps = keepRangesFromFillers(cuts, 30, 0);
    expect(keeps).toEqual([{ startSec: 5, endSec: 30 }]);
  });

  it("frame-aligns with OUTWARD rounding to preserve speech in partial frames", () => {
    const keeps = [{ startSec: 1.05, endSec: 2.95 }];
    // 30 fps: floor(31.5)=31, ceil(88.5)=89 — expands keep by one frame on
    // each end. Was inward (32, 88), which lost ~33 ms per junction.
    expect(keepRangesToFrameRanges(keeps, 30)).toEqual([{ startFrame: 31, endFrame: 89 }]);
  });

  it("returns empty when cuts cover the entire source", () => {
    const cuts = [{ startSec: 0, endSec: 30, text: "all", startWordIndex: 0, endWordIndex: 0 }];
    const keeps = keepRangesFromFillers(cuts, 30, 0);
    expect(keeps).toEqual([]);
  });
});
