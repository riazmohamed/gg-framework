import { describe, expect, it } from "vitest";
import { HOOK_PATTERNS, parseRewriteResponse } from "./hook-rewrite.js";

describe("HOOK_PATTERNS", () => {
  it("includes all 12 patterns + auto", () => {
    expect(HOOK_PATTERNS).toContain("auto");
    expect(HOOK_PATTERNS).toContain("click-to-unpause");
    expect(HOOK_PATTERNS).toContain("shock-intrigue-satisfy");
    expect(HOOK_PATTERNS).toContain("foreshadow-ending");
    expect(HOOK_PATTERNS).toContain("but-so-escalation");
    expect(HOOK_PATTERNS).toContain("power-word");
    expect(HOOK_PATTERNS).toContain("crazy-progression");
    expect(HOOK_PATTERNS).toContain("match-thumbnail");
    expect(HOOK_PATTERNS).toContain("i-asked-google");
    expect(HOOK_PATTERNS).toContain("credibility-plus-n");
    expect(HOOK_PATTERNS).toContain("cliffhanger");
    expect(HOOK_PATTERNS).toContain("first-frame-thumbnail");
  });
});

describe("parseRewriteResponse", () => {
  it("returns 3 candidates when the model gives 3", () => {
    const content = JSON.stringify({
      candidates: [
        { line: "A", pattern: "power-word", why: "punchy" },
        { line: "B", pattern: "power-word", why: "punchy" },
        { line: "C", pattern: "power-word", why: "punchy" },
      ],
      chosenPattern: "power-word",
      why: "loud opener",
    });
    const r = parseRewriteResponse(content, "auto");
    expect(r.candidates).toHaveLength(3);
    expect(r.chosenPattern).toBe("power-word");
  });

  it("pads to 3 when the model gives fewer", () => {
    const content = JSON.stringify({
      candidates: [{ line: "only one", pattern: "cliffhanger", why: "x" }],
      chosenPattern: "cliffhanger",
    });
    const r = parseRewriteResponse(content, "auto");
    expect(r.candidates).toHaveLength(3);
    expect(r.candidates.every((c) => c.line === "only one")).toBe(true);
  });

  it("returns no candidates when model gives nothing", () => {
    const r = parseRewriteResponse(JSON.stringify({ candidates: [] }), "auto");
    expect(r.candidates).toHaveLength(0);
  });

  it("falls back chosenPattern to the requested pattern", () => {
    const content = JSON.stringify({
      candidates: [{ line: "x", pattern: "power-word", why: "y" }],
    });
    const r = parseRewriteResponse(content, "power-word");
    expect(r.chosenPattern).toBe("power-word");
  });

  it("throws on non-JSON", () => {
    expect(() => parseRewriteResponse("not json", "auto")).toThrow();
  });
});
