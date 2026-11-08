import { describe, expect, it } from "vitest";
import { formatOpenRouterStatus } from "./openrouter.js";

describe("ogcoder openrouter", () => {
  it("points at sync while the built-in list is in use", () => {
    const lines = formatOpenRouterStatus({
      synced: false,
      count: 0,
      baseUrl: "https://openrouter.ai/api/v1",
    });
    expect(lines[0]).toBe("OpenRouter models: built-in list (https://openrouter.ai/api/v1)");
    expect(lines[1]).toContain("ogcoder openrouter sync");
  });

  it("reports a synced list with its endpoint and skipped rows", () => {
    const lines = formatOpenRouterStatus({
      synced: true,
      count: 42,
      syncedAt: Date.UTC(2026, 10, 9),
      baseUrl: "http://gateway.local/v1",
      skipped: 3,
    });
    expect(lines[0]).toMatch(/^OpenRouter models: 42 synced from http:\/\/gateway\.local\/v1 \(/);
    expect(lines[1]).toBe("3 skipped (no tool calling, or already built in).");
  });

  it("leaves out the skipped line when nothing was skipped", () => {
    const lines = formatOpenRouterStatus({
      synced: true,
      count: 5,
      syncedAt: 0,
      baseUrl: "https://openrouter.ai/api/v1",
      skipped: 0,
    });
    expect(lines).toHaveLength(1);
  });
});
