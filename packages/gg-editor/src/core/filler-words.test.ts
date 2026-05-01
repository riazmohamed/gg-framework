import { describe, expect, it } from "vitest";
import type { Transcript } from "./whisper.js";
import {
  detectFillerRanges,
  keepRangesFromFillers,
  keepRangesToFrameRanges,
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

  it("applies start/end padding to cut ranges", () => {
    const t = makeTranscript("hello um world");
    const um = t.segments[0].words![1];
    const fillers = detectFillerRanges(t, { paddingStartMs: 50, paddingEndMs: 50 });
    expect(fillers[0].startSec).toBeCloseTo(um.start - 0.05, 3);
    expect(fillers[0].endSec).toBeCloseTo(um.end + 0.05, 3);
  });

  it("clamps the start padding so it never goes negative", () => {
    const t = makeTranscript("um hello world");
    const fillers = detectFillerRanges(t, { paddingStartMs: 9999 });
    expect(fillers[0].startSec).toBe(0);
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
  it("rounds inward (ceil start, floor end)", () => {
    const keeps = [{ startSec: 0.4, endSec: 1.6 }];
    const frames = keepRangesToFrameRanges(keeps, 30);
    expect(frames).toEqual([{ startFrame: 12, endFrame: 48 }]);
  });

  it("drops zero-frame ranges after rounding", () => {
    // ceil(0.97 * 30) = 30; floor(1.0 * 30) = 30 — zero-frame range, dropped.
    const keeps = [{ startSec: 0.97, endSec: 1.0 }];
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
