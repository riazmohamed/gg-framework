import { describe, expect, it } from "vitest";
import { detectHost } from "./detect.js";

describe("detectHost", () => {
  it("returns a valid host name and display string", () => {
    const result = detectHost();
    expect(["resolve", "premiere", "none"]).toContain(result.name);
    expect(typeof result.displayName).toBe("string");
    expect(result.displayName.length).toBeGreaterThan(0);
  });

  it("returns no matches when name is 'none'", () => {
    const result = detectHost();
    if (result.name === "none") {
      expect(result.matched).toEqual([]);
    }
  });
});
