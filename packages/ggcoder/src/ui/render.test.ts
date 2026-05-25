import { describe, expect, it } from "vitest";
import { getResetClearMode } from "./render.js";

describe("getResetClearMode", () => {
  it("uses a full screen redraw for terminal resize remounts", () => {
    expect(getResetClearMode({ resizeRedraw: true })).toBe("screen");
  });

  it("keeps ordinary overlay remounts to a viewport clear", () => {
    expect(getResetClearMode(undefined)).toBe("viewport");
    expect(getResetClearMode({})).toBe("viewport");
  });

  it("uses a full screen redraw for explicit session/history replacement", () => {
    expect(getResetClearMode({ wipeSession: true })).toBe("screen");
    expect(getResetClearMode({ history: [{ kind: "banner", id: "banner" }] })).toBe("screen");
  });
});
