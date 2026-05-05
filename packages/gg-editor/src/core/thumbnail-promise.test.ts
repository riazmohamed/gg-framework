import { describe, expect, it } from "vitest";
import { parsePromiseResponse } from "./thumbnail-promise.js";

describe("parsePromiseResponse", () => {
  it("parses a complete response", () => {
    const content = JSON.stringify({
      matches: 0.7,
      thumbnailPromise: "man underwater",
      openingShows: "man near pool",
      missing: ["actually being submerged"],
      suggestion: "cut to underwater shot at 0:02",
    });
    const r = parsePromiseResponse(content);
    expect(r.matches).toBeCloseTo(0.7);
    expect(r.thumbnailPromise).toBe("man underwater");
    expect(r.missing).toEqual(["actually being submerged"]);
  });

  it("clamps matches to [0,1]", () => {
    const r = parsePromiseResponse(
      JSON.stringify({ matches: 5, thumbnailPromise: "", openingShows: "", missing: [], suggestion: "" }),
    );
    expect(r.matches).toBe(1);
    const r2 = parsePromiseResponse(
      JSON.stringify({ matches: -0.5, thumbnailPromise: "", openingShows: "", missing: [], suggestion: "" }),
    );
    expect(r2.matches).toBe(0);
  });

  it("caps missing at 4 entries", () => {
    const r = parsePromiseResponse(
      JSON.stringify({
        matches: 0.5,
        missing: ["a", "b", "c", "d", "e", "f"],
      }),
    );
    expect(r.missing).toHaveLength(4);
  });

  it("tolerates missing keys", () => {
    const r = parsePromiseResponse(JSON.stringify({}));
    expect(r.matches).toBe(0);
    expect(r.thumbnailPromise).toBe("");
    expect(r.missing).toEqual([]);
  });

  it("throws on non-JSON", () => {
    expect(() => parsePromiseResponse("not json")).toThrow();
  });
});
