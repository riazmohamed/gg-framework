import { describe, expect, it } from "vitest";
import {
  assessTuiCacheExpiry,
  cacheExpiryKey,
  cacheExpiryWarning,
  cacheTouchFor,
} from "./cache-expiry-gate.js";

const route = { provider: "anthropic", model: "claude-opus-5-5" };
const t0 = Date.UTC(2026, 9, 9, 9, 0, 0);
const MIN = 60_000;

describe("TUI cold-cache warning", () => {
  it("stays quiet while the cache is warm or the chat is small", () => {
    const touch = cacheTouchFor(route, t0);
    expect(touch?.policy.ttlMs).toBe(5 * MIN);
    const warm = assessTuiCacheExpiry(route, touch, 120_000, true, t0 + 2 * MIN);
    expect(cacheExpiryWarning(warm, t0 + 2 * MIN)).toBeNull();
    const small = assessTuiCacheExpiry(route, touch, 10_000, true, t0 + 20 * MIN);
    expect(cacheExpiryWarning(small, t0 + 20 * MIN)).toBeNull();
  });

  it("warns once the TTL has passed on a large context", () => {
    const now = t0 + 17 * MIN;
    const status = assessTuiCacheExpiry(route, cacheTouchFor(route, t0), 120_000, true, now);
    expect(cacheExpiryWarning(status, now)).toBe(
      "The prompt cache expired 12m ago. Sending re-reads ~120k tokens at full price. " +
        "Press Enter again to send anyway, or run /compact first.",
    );
  });

  it("explains a model switch and a resumed chat", () => {
    const touch = cacheTouchFor(route, t0);
    const switched = { ...route, model: "claude-haiku-5-5" };
    expect(
      cacheExpiryWarning(assessTuiCacheExpiry(switched, touch, 50_000, true, t0 + MIN), t0 + MIN),
    ).toContain("The model changed");
    expect(
      cacheExpiryWarning(assessTuiCacheExpiry(route, null, 2_500_000, true, t0), t0),
    ).toContain("no warm prompt cache yet");
    expect(assessTuiCacheExpiry(route, null, 200_000, false, t0)).toBeNull();
  });

  it("has no policy, so never warns, for providers without a known TTL", () => {
    expect(cacheTouchFor({ provider: "glm", model: "glm-5.3" }, t0)).toBeNull();
    expect(
      assessTuiCacheExpiry({ provider: "glm", model: "glm-5.3" }, null, 900_000, true, t0),
    ).toBeNull();
  });

  it("keys each lapse separately, so a later lapse warns again", () => {
    const a = assessTuiCacheExpiry(route, cacheTouchFor(route, t0), 90_000, true, t0 + 10 * MIN);
    const later = t0 + 60 * MIN;
    const b = assessTuiCacheExpiry(
      route,
      cacheTouchFor(route, later),
      90_000,
      true,
      later + 9 * MIN,
    );
    expect(a && b && cacheExpiryKey(a) !== cacheExpiryKey(b)).toBe(true);
  });
});
