import { describe, expect, it } from "vitest";
import { detectSpeakerChanges } from "./speaker-changes.js";
import type { Transcript } from "./whisper.js";

function tx(segs: Array<[number, number, string]>): Transcript {
  return {
    language: "en",
    durationSec: segs.at(-1)?.[1] ?? 0,
    segments: segs.map(([start, end, text]) => ({ start, end, text })),
  };
}

describe("detectSpeakerChanges", () => {
  it("returns no boundaries for tightly-packed segments", () => {
    const r = detectSpeakerChanges(
      tx([
        [0, 1, "a"],
        [1.1, 2, "b"],
        [2.2, 3, "c"],
      ]),
    );
    expect(r).toEqual([]);
  });

  it("returns one boundary for a gap > minGapSec", () => {
    const r = detectSpeakerChanges(
      tx([
        [0, 1, "first speaker"],
        [3, 4, "second speaker"],
      ]),
    );
    expect(r).toHaveLength(1);
    expect(r[0].atSec).toBe(3);
    expect(r[0].gapSec).toBe(2);
  });

  it("respects custom minGapSec", () => {
    const r = detectSpeakerChanges(
      tx([
        [0, 1, "a"],
        [1.5, 2.5, "b"],
        [4, 5, "c"],
      ]),
      { minGapSec: 1.2 },
    );
    expect(r).toHaveLength(1); // only the 1.5s gap survives at threshold 1.2
    expect(r[0].atSec).toBe(4);
  });

  it("clips long preview text to 80 chars", () => {
    const long = "x".repeat(200);
    const r = detectSpeakerChanges(
      tx([
        [0, 1, "a"],
        [5, 6, long],
      ]),
    );
    expect(r[0].nextSegmentText.length).toBe(80);
  });
});
