import { describe, expect, it } from "vitest";
import { buildAtempo, buildSetpts } from "./speed-ramp.js";

describe("buildSetpts", () => {
  it("rejects fewer than 2 points", () => {
    expect(() => buildSetpts([{ atSec: 0, speed: 1 }])).toThrow(/>=2/);
  });

  it("rejects non-increasing time", () => {
    expect(() =>
      buildSetpts([
        { atSec: 0, speed: 1 },
        { atSec: 0, speed: 2 },
      ]),
    ).toThrow(/strictly increasing/);
  });

  it("two-point identity ramp emits a simple setpts=1*PTS", () => {
    const f = buildSetpts([
      { atSec: 0, speed: 1 },
      { atSec: 5, speed: 1 },
    ]);
    expect(f).toBe("setpts='if(lt(T,5),1*PTS,1*PTS)'");
  });

  it("two-point slow-mo (0.5x) emits k=2*PTS", () => {
    const f = buildSetpts([
      { atSec: 0, speed: 0.5 },
      { atSec: 5, speed: 1 },
    ]);
    expect(f).toBe("setpts='if(lt(T,5),2*PTS,1*PTS)'");
  });

  it("three-point ramp slow → fast → slow nests two if()s", () => {
    const f = buildSetpts([
      { atSec: 0, speed: 0.5 },
      { atSec: 2, speed: 2 },
      { atSec: 5, speed: 0.5 },
    ]);
    expect(f).toBe("setpts='if(lt(T,2),2*PTS,if(lt(T,5),0.5*PTS,2*PTS))'");
  });

  it("four-point ramp produces 3 nested ifs", () => {
    const f = buildSetpts([
      { atSec: 0, speed: 1 },
      { atSec: 1, speed: 0.5 },
      { atSec: 3, speed: 2 },
      { atSec: 4, speed: 1 },
    ]);
    expect(f).toContain("if(lt(T,1),1*PTS,");
    expect(f).toContain("if(lt(T,3),2*PTS,");
    expect(f).toContain("if(lt(T,4),0.5*PTS,1*PTS)");
  });
});

describe("buildAtempo", () => {
  it("returns null filter for unity-speed ramp", () => {
    const r = buildAtempo([
      { atSec: 0, speed: 1 },
      { atSec: 5, speed: 1 },
    ]);
    expect(r.filter).toBeNull();
    expect(r.avgSpeed).toBe(1);
  });

  it("uses one atempo stage for moderate average speed", () => {
    const r = buildAtempo([
      { atSec: 0, speed: 1.5 },
      { atSec: 5, speed: 1.5 },
    ]);
    expect(r.filter).toBe("atempo=1.5");
    expect(r.stages).toBe(1);
  });

  it("chains atempo for very fast (>2) average speed", () => {
    const r = buildAtempo([
      { atSec: 0, speed: 4 },
      { atSec: 1, speed: 4 },
    ]);
    // Average = 4 → atempo=2,atempo=2.
    expect(r.filter).toBe("atempo=2,atempo=2");
    expect(r.stages).toBe(2);
  });
});
