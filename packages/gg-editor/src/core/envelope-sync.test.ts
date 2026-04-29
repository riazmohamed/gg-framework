import { describe, expect, it } from "vitest";
import { correlateEnvelopes } from "./envelope-sync.js";

/**
 * Pure-math tests for the correlator. The full envelope pipeline needs ffmpeg
 * + real audio; the correlator itself is testable in isolation.
 */

function buildEnvelope(events: Array<[number, number]>, length: number): Float64Array {
  const out = new Float64Array(length);
  for (const [pos, amp] of events) out[pos] = amp;
  return out;
}

describe("correlateEnvelopes", () => {
  it("identical envelopes correlate at lag 0 with correlation ~1", () => {
    const e = buildEnvelope(
      [
        [10, 1],
        [20, 0.5],
        [30, 0.8],
      ],
      60,
    );
    const r = correlateEnvelopes(e, e, 30);
    expect(r.lagBlocks).toBe(0);
    expect(r.correlation).toBeCloseTo(1, 3);
  });

  it("a trails b (peaks at later indices) → NEGATIVE lag", () => {
    // b's peaks at 0, 2 (early in b's timeline)
    // a's peaks at 3, 5 (late in a's timeline) — a trails b by 3.
    const b = buildEnvelope(
      [
        [0, 1],
        [2, 1],
      ],
      10,
    );
    const a = buildEnvelope(
      [
        [3, 1],
        [5, 1],
      ],
      10,
    );
    const r = correlateEnvelopes(a, b, 5);
    expect(r.lagBlocks).toBe(-3);
    expect(r.correlation).toBeGreaterThan(0.99);
    // Wall-clock: offsetSec = -lagBlocks * blockSec → positive → a started LATER. ✓
  });

  it("a leads b (peaks at earlier indices) → POSITIVE lag", () => {
    const b = buildEnvelope(
      [
        [5, 1],
        [7, 1],
      ],
      12,
    );
    const a = buildEnvelope(
      [
        [2, 1],
        [4, 1],
      ],
      12,
    );
    const r = correlateEnvelopes(a, b, 5);
    expect(r.lagBlocks).toBe(3);
  });

  it("uncorrelated envelopes return low correlation", () => {
    // pure random-like signals
    const a = new Float64Array(100);
    const b = new Float64Array(100);
    for (let i = 0; i < 100; i++) {
      a[i] = Math.sin(i * 0.4);
      b[i] = Math.cos(i * 0.7);
    }
    const r = correlateEnvelopes(a, b, 10);
    expect(Math.abs(r.correlation)).toBeLessThan(0.7);
  });

  it("respects maxLag cap (won't return a lag outside the search range)", () => {
    const b = buildEnvelope([[0, 1]], 50);
    const a = buildEnvelope([[20, 1]], 50);
    const r = correlateEnvelopes(a, b, 5);
    expect(Math.abs(r.lagBlocks)).toBeLessThanOrEqual(5);
  });
});
