import { describe, expect, it } from "vitest";
import { REFORMAT_PRESETS, reformatSpec } from "./reformat.js";

describe("reformatSpec", () => {
  it("returns 1080x1920 for 9:16", () => {
    const s = reformatSpec("9:16");
    expect(s.width).toBe(1080);
    expect(s.height).toBe(1920);
  });
  it("returns square 1080x1080 for 1:1", () => {
    expect(reformatSpec("1:1")).toMatchObject({ width: 1080, height: 1080 });
  });
  it("returns 1080x1350 for 4:5 portrait", () => {
    expect(reformatSpec("4:5")).toMatchObject({ width: 1080, height: 1350 });
  });
  it("returns 1920x1080 for 16:9", () => {
    expect(reformatSpec("16:9")).toMatchObject({ width: 1920, height: 1080 });
  });
  it("returns 1440x1080 for 4:3", () => {
    expect(reformatSpec("4:3")).toMatchObject({ width: 1440, height: 1080 });
  });
  it("throws on unknown preset", () => {
    // @ts-expect-error invalid preset for testing
    expect(() => reformatSpec("bogus")).toThrow(/unknown reformat preset/);
  });
  it("exposes a stable preset list", () => {
    expect(REFORMAT_PRESETS).toEqual(["9:16", "1:1", "4:5", "16:9", "4:3"]);
  });
});
