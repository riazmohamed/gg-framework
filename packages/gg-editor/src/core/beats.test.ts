import { describe, expect, it } from "vitest";
import { snapCuts } from "./beats.js";

describe("snapCuts", () => {
  it("returns empty results for empty cut list", () => {
    const r = snapCuts([], [1, 2, 3], 0.25);
    expect(r.snapped).toEqual([]);
    expect(r.unchanged).toEqual([]);
  });

  it("returns every cut in unchanged when beats list is empty", () => {
    const r = snapCuts([1.0, 2.0], [], 0.25);
    expect(r.snapped).toEqual([]);
    expect(r.unchanged).toEqual([{ atSec: 1.0 }, { atSec: 2.0 }]);
  });

  it("snaps a cut to the nearest beat within tolerance", () => {
    // Beats at 1.0, 2.0, 3.0; cut at 2.07s with tol 0.25 → snaps to 2.0.
    const r = snapCuts([2.07], [1.0, 2.0, 3.0], 0.25);
    expect(r.snapped).toHaveLength(1);
    expect(r.unchanged).toEqual([]);
    expect(r.snapped[0]).toEqual({
      originalSec: 2.07,
      snappedSec: 2.0,
      beatIdx: 1,
      deltaSec: expect.closeTo(-0.07, 5),
    });
  });

  it("leaves a cut unchanged when the closest beat is outside tolerance", () => {
    // Beats at 0, 1; cut at 0.5 → equidistant, but 0.5 > tol of 0.1.
    const r = snapCuts([0.5], [0.0, 1.0], 0.1);
    expect(r.snapped).toEqual([]);
    expect(r.unchanged).toHaveLength(1);
    expect(r.unchanged[0].atSec).toBe(0.5);
    expect(r.unchanged[0].nearestBeatDeltaSec).toBeCloseTo(0.5, 5);
  });

  it("picks the LEFT beat on a perfect tie (earlier beat wins)", () => {
    // Cut at 1.5 between beats at 1.0 and 2.0 — both 0.5 away.
    const r = snapCuts([1.5], [1.0, 2.0], 1.0);
    expect(r.snapped).toHaveLength(1);
    expect(r.snapped[0].snappedSec).toBe(1.0);
    expect(r.snapped[0].beatIdx).toBe(0);
  });

  it("snaps each cut independently and preserves input order", () => {
    const cuts = [3.05, 1.04, 2.5];
    const beats = [1.0, 2.0, 3.0, 4.0];
    const r = snapCuts(cuts, beats, 0.1);
    // 3.05 → 3.0 (delta -0.05)
    // 1.04 → 1.0 (delta -0.04)
    // 2.5  → ties left at 2.0 BUT |0.5| > 0.1 tol → unchanged.
    expect(r.snapped.map((s) => s.originalSec)).toEqual([3.05, 1.04]);
    expect(r.unchanged.map((u) => u.atSec)).toEqual([2.5]);
  });

  it("clamps negative tolerance to 0 (no snap occurs)", () => {
    const r = snapCuts([1.0001], [1.0], -0.5);
    // Tolerance was negative → clamped to 0; cut isn't EXACTLY on the beat,
    // so it falls into unchanged.
    expect(r.snapped).toEqual([]);
    expect(r.unchanged).toHaveLength(1);
  });

  it("handles cuts before the first beat and after the last beat", () => {
    const beats = [5.0, 6.0, 7.0];
    const r = snapCuts([4.95, 7.05, 100], beats, 0.1);
    // 4.95 → 5.0, 7.05 → 7.0, 100 → unchanged (closest delta 93)
    expect(r.snapped.map((s) => s.snappedSec)).toEqual([5.0, 7.0]);
    expect(r.unchanged).toHaveLength(1);
    expect(r.unchanged[0].atSec).toBe(100);
    expect(r.unchanged[0].nearestBeatDeltaSec).toBeCloseTo(93, 1);
  });

  it("sorts beat input defensively", () => {
    // Caller passes beats out of order; we still find the right neighbour.
    const r = snapCuts([2.04], [3.0, 1.0, 2.0], 0.1);
    expect(r.snapped[0].snappedSec).toBe(2.0);
    expect(r.snapped[0].beatIdx).toBe(1); // index in the SORTED list
  });

  it("treats non-finite cuts as unchanged", () => {
    const r = snapCuts([NaN, 1.0], [1.0, 2.0], 0.1);
    expect(r.snapped).toHaveLength(1);
    expect(r.snapped[0].originalSec).toBe(1.0);
    expect(r.unchanged).toHaveLength(1);
    expect(Number.isNaN(r.unchanged[0].atSec)).toBe(true);
  });

  it("zero tolerance only snaps exact-match cuts", () => {
    const r = snapCuts([1.0, 1.001], [1.0, 2.0], 0);
    expect(r.snapped.map((s) => s.originalSec)).toEqual([1.0]);
    expect(r.unchanged.map((u) => u.atSec)).toEqual([1.001]);
  });
});
