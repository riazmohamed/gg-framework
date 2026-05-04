import { describe, expect, it } from "vitest";
import type { Transcript } from "./whisper.js";
import {
  detectFillerRanges,
  keepRangesFromFillers,
  keepRangesToFrameRanges,
  keepRangesToTimelineCuts,
  summarizeFillers,
} from "./filler-words.js";

/**
 * Build a synthetic transcript whose words have known timing. Each word
 * is 0.3s long with a 0.05s gap between, starting at `startAt`.
 */
function makeTranscript(text: string, startAt = 0): Transcript {
  const tokens = text.split(/\s+/).filter(Boolean);
  let t = startAt;
  const words = tokens.map((tok) => {
    const start = t;
    const end = t + 0.3;
    t = end + 0.05;
    return { start, end, text: tok };
  });
  return {
    language: "en",
    durationSec: t,
    segments: [
      {
        start: words[0]?.start ?? 0,
        end: words[words.length - 1]?.end ?? 0,
        text: tokens.join(" "),
        words,
      },
    ],
  };
}

describe("detectFillerRanges", () => {
  it("finds single-word fillers (um, uh)", () => {
    const t = makeTranscript("hello um world uh goodbye");
    const fillers = detectFillerRanges(t);
    expect(fillers).toHaveLength(2);
    expect(fillers[0].text).toBe("um");
    expect(fillers[1].text).toBe("uh");
  });

  it("matches multi-word phrases (you know)", () => {
    const t = makeTranscript("the answer you know is forty two");
    const fillers = detectFillerRanges(t);
    expect(fillers).toHaveLength(1);
    expect(fillers[0].text).toBe("you know");
    // The cut should span both words.
    const word2 = t.segments[0].words![2]; // "you"
    const word3 = t.segments[0].words![3]; // "know"
    expect(fillers[0].startSec).toBeLessThanOrEqual(word2.start);
    expect(fillers[0].endSec).toBeGreaterThanOrEqual(word3.end);
  });

  it("multi-word phrases match before single-word substrings", () => {
    // 'you know' is multi-word filler. 'know' alone is not.
    const t = makeTranscript("you know about it");
    const fillers = detectFillerRanges(t);
    expect(fillers).toHaveLength(1);
    expect(fillers[0].text).toBe("you know");
    expect(fillers[0].endWordIndex - fillers[0].startWordIndex).toBe(2);
  });

  it("strips punctuation when matching ('Um,' → 'um')", () => {
    const t = makeTranscript("Hello Um, world.");
    const fillers = detectFillerRanges(t);
    expect(fillers).toHaveLength(1);
    expect(fillers[0].text).toBe("um");
  });

  it("merges adjacent fillers within mergeGapMs", () => {
    // "um uh" with a 0.05s gap between words — well within default 150ms.
    const t = makeTranscript("um uh hello");
    const fillers = detectFillerRanges(t);
    expect(fillers).toHaveLength(1);
    expect(fillers[0].text).toContain("um");
    expect(fillers[0].text).toContain("uh");
  });

  it("respects custom vocabulary", () => {
    const t = makeTranscript("hello banana world");
    const fillers = detectFillerRanges(t, { fillers: ["banana"] });
    expect(fillers).toHaveLength(1);
    expect(fillers[0].text).toBe("banana");
  });

  it("aggressiveSingleWords=false skips 'like' / 'so' / 'actually'", () => {
    const t = makeTranscript("i like the so called actually working idea");
    // Default: aggressive=true → these match.
    expect(detectFillerRanges(t).length).toBeGreaterThan(0);
    // Off: only the safe-list filler vocabulary applies.
    const safe = detectFillerRanges(t, { aggressiveSingleWords: false });
    expect(safe).toHaveLength(0);
  });

  it("returns empty when transcript has no word timings", () => {
    const t: Transcript = {
      language: "en",
      durationSec: 5,
      segments: [{ start: 0, end: 5, text: "um hello uh world" }],
    };
    expect(detectFillerRanges(t)).toEqual([]);
  });

  it("padding SHRINKS the cut range (preserves speech around the filler)", () => {
    const t = makeTranscript("hello um world");
    const um = t.segments[0].words![1];
    const fillers = detectFillerRanges(t, { paddingStartMs: 50, paddingEndMs: 50 });
    // padStart=50ms means cut starts 50ms LATER than the word boundary —
    // i.e. we keep MORE of the previous word's tail.
    expect(fillers[0].startSec).toBeCloseTo(um.start + 0.05, 3);
    expect(fillers[0].endSec).toBeCloseTo(um.end - 0.05, 3);
  });

  it("default padding is 0 — trust whisper's word boundaries", () => {
    const t = makeTranscript("hello um world");
    const um = t.segments[0].words![1];
    const fillers = detectFillerRanges(t);
    // No padding by default: cut spans exactly the word's reported timing.
    expect(fillers[0].startSec).toBeCloseTo(um.start, 3);
    expect(fillers[0].endSec).toBeCloseTo(um.end, 3);
  });

  it("falls back to unpadded boundaries when padding would invert the range", () => {
    // 200ms of padding on a 100ms word would produce a negative duration.
    // We clamp by reverting to the unpadded word boundaries rather than
    // emitting a degenerate range.
    const t = makeTranscript("um hello world");
    const um = t.segments[0].words![0];
    const fillers = detectFillerRanges(t, { paddingStartMs: 200, paddingEndMs: 200 });
    expect(fillers[0].startSec).toBeCloseTo(um.start, 3);
    expect(fillers[0].endSec).toBeCloseTo(um.end, 3);
  });
});

describe("keepRangesFromFillers", () => {
  it("emits the inverse of filler ranges", () => {
    const fillers = [
      { startSec: 1, endSec: 2, text: "um", startWordIndex: 0, endWordIndex: 1 },
      { startSec: 4, endSec: 5, text: "uh", startWordIndex: 0, endWordIndex: 1 },
    ];
    const keeps = keepRangesFromFillers(fillers, 7);
    expect(keeps).toEqual([
      { startSec: 0, endSec: 1 },
      { startSec: 2, endSec: 4 },
      { startSec: 5, endSec: 7 },
    ]);
  });

  it("returns the whole timeline when there are no fillers", () => {
    expect(keepRangesFromFillers([], 10)).toEqual([{ startSec: 0, endSec: 10 }]);
  });

  it("handles fillers at the very start and end", () => {
    const fillers = [
      { startSec: 0, endSec: 0.5, text: "um", startWordIndex: 0, endWordIndex: 1 },
      { startSec: 4.5, endSec: 5, text: "uh", startWordIndex: 0, endWordIndex: 1 },
    ];
    const keeps = keepRangesFromFillers(fillers, 5);
    expect(keeps).toEqual([{ startSec: 0.5, endSec: 4.5 }]);
  });

  it("drops sub-minimum keep ranges", () => {
    const fillers = [
      { startSec: 1, endSec: 2, text: "um", startWordIndex: 0, endWordIndex: 1 },
      { startSec: 2.02, endSec: 3, text: "uh", startWordIndex: 0, endWordIndex: 1 },
    ];
    const keeps = keepRangesFromFillers(fillers, 5, 0.05);
    // The 0.02s gap between the two fillers should be dropped.
    expect(keeps).toEqual([
      { startSec: 0, endSec: 1 },
      { startSec: 3, endSec: 5 },
    ]);
  });
});

describe("keepRangesToFrameRanges", () => {
  it("rounds OUTWARD (floor start, ceil end) to preserve speech in partial frames", () => {
    const keeps = [{ startSec: 0.4, endSec: 1.6 }];
    const frames = keepRangesToFrameRanges(keeps, 30);
    // floor(0.4 * 30) = 12 ; ceil(1.6 * 30) = 48
    expect(frames).toEqual([{ startFrame: 12, endFrame: 48 }]);
  });

  it("keeps tiny ranges intact (used to drop them with inward rounding)", () => {
    // floor(0.97 * 30) = 29 ; ceil(1.0 * 30) = 30 — 1-frame keep, valid.
    // (Was zero-frame and dropped under inward rounding — the bug that ate 5+ s
    //  of speech across 73 cuts.)
    const keeps = [{ startSec: 0.97, endSec: 1.0 }];
    const frames = keepRangesToFrameRanges(keeps, 30);
    expect(frames).toEqual([{ startFrame: 29, endFrame: 30 }]);
  });

  it("drops zero-frame ranges (start equals end after rounding)", () => {
    // floor(1.0 * 30) = 30 ; ceil(1.0 * 30) = 30 — same frame, dropped.
    const keeps = [{ startSec: 1.0, endSec: 1.0 }];
    const frames = keepRangesToFrameRanges(keeps, 30);
    expect(frames).toEqual([]);
  });
});

describe("summarizeFillers", () => {
  it("counts occurrences and total removed time", () => {
    const fillers = [
      { startSec: 0, endSec: 0.3, text: "um", startWordIndex: 0, endWordIndex: 1 },
      { startSec: 1, endSec: 1.5, text: "um", startWordIndex: 0, endWordIndex: 1 },
      { startSec: 2, endSec: 2.5, text: "uh", startWordIndex: 0, endWordIndex: 1 },
    ];
    const stats = summarizeFillers(fillers);
    expect(stats.count).toBe(3);
    expect(stats.totalRemovedSec).toBeCloseTo(1.3, 3);
    expect(stats.topFillers[0]).toEqual({ text: "um", count: 2 });
    expect(stats.topFillers[1]).toEqual({ text: "uh", count: 1 });
  });

  it("splits merged fillers when counting", () => {
    const fillers = [
      { startSec: 0, endSec: 0.5, text: "um + uh", startWordIndex: 0, endWordIndex: 2 },
    ];
    const stats = summarizeFillers(fillers);
    const counts = Object.fromEntries(stats.topFillers.map((f) => [f.text, f.count]));
    expect(counts).toEqual({ um: 1, uh: 1 });
  });
});

describe("keepRangesToTimelineCuts", () => {
  it("emits one cut per junction in TIMELINE space (cumulative keep durations)", () => {
    // Source: keep [0,10] + filler [10,12] + keep [12,25] + filler [25,28] + keep [28,40]
    // After import_edl, the timeline = 10s + 13s + 12s = 35s with cuts at 10s and 23s
    const keeps = [
      { startSec: 0, endSec: 10 },
      { startSec: 12, endSec: 25 },
      { startSec: 28, endSec: 40 },
    ];
    expect(keepRangesToTimelineCuts(keeps)).toEqual([10, 23]);
  });

  it("returns empty when there are zero or one keep ranges", () => {
    expect(keepRangesToTimelineCuts([])).toEqual([]);
    expect(keepRangesToTimelineCuts([{ startSec: 0, endSec: 10 }])).toEqual([]);
  });

  it("compounds the cumulative offset correctly across many small keeps", () => {
    // Each keep is 5s with 1s of filler between them.
    // Timeline cuts land at 5, 10, 15, 20.
    const keeps = [
      { startSec: 0, endSec: 5 },
      { startSec: 6, endSec: 11 },
      { startSec: 12, endSec: 17 },
      { startSec: 18, endSec: 23 },
      { startSec: 24, endSec: 29 },
    ];
    expect(keepRangesToTimelineCuts(keeps)).toEqual([5, 10, 15, 20]);
  });

  it("the SOURCE-vs-TIMELINE drift bug — cuts diverge linearly with cumulative removed time", () => {
    // The bug we're protecting against: agent passes source timestamps to a
    // timeline tool. After 24s of total filler removed, a source-space cut at
    // 60s is at timeline 60s - 24s = 36s. By 100s+ the drift is the full 24s.
    // This test documents the math we're encoding for the agent.
    const keeps = [
      { startSec: 0, endSec: 30 }, // 30s kept
      { startSec: 32, endSec: 60 }, // 28s kept (source 30-32 = 2s filler removed)
      { startSec: 65, endSec: 100 }, // 35s kept (5s filler removed)
    ];
    const timelineCuts = keepRangesToTimelineCuts(keeps);
    expect(timelineCuts).toEqual([30, 58]); // junction 1 at 30s timeline, junction 2 at 30+28=58s
    // If the agent had passed SOURCE timestamps (32s and 65s), the second
    // SFX would have landed at timeline=65s — 7s LATE relative to the actual
    // junction at 58s. That's the bug.
  });
});
