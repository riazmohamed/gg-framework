import { describe, expect, it } from "vitest";
import {
  buildSlidingWindows,
  dedupCandidates,
  normalizeCandidates,
  parseProposalResponse,
} from "./viral-moments.js";

describe("buildSlidingWindows", () => {
  it("emits non-overlapping windows when overlap=0", () => {
    const t = {
      language: "en",
      durationSec: 100,
      segments: [
        { start: 0, end: 50, text: "first half" },
        { start: 50, end: 100, text: "second half" },
      ],
    };
    const windows = buildSlidingWindows(t, 50, 0);
    expect(windows).toHaveLength(2);
    expect(windows[0].startSec).toBe(0);
    expect(windows[0].endSec).toBe(50);
    expect(windows[1].startSec).toBe(50);
  });

  it("emits overlapping windows when overlap>0", () => {
    const t = {
      language: "en",
      durationSec: 120,
      segments: [{ start: 0, end: 120, text: "all" }],
    };
    const windows = buildSlidingWindows(t, 60, 30);
    // step=30 → starts at 0, 30, 60, 90; last window clipped to 120
    expect(windows.length).toBeGreaterThanOrEqual(3);
  });

  it("returns [] for zero-duration transcripts", () => {
    expect(
      buildSlidingWindows({ language: "en", durationSec: 0, segments: [] }, 60, 0),
    ).toEqual([]);
  });

  it("rejects invalid args", () => {
    const t = { language: "en", durationSec: 100, segments: [] };
    expect(() => buildSlidingWindows(t, 0, 0)).toThrow();
    expect(() => buildSlidingWindows(t, 30, 30)).toThrow();
    expect(() => buildSlidingWindows(t, 30, 40)).toThrow();
  });
});

describe("dedupCandidates", () => {
  const make = (
    startSec: number,
    endSec: number,
    score: number,
  ): Parameters<typeof dedupCandidates>[0][number] => ({
    startSec,
    endSec,
    durationSec: endSec - startSec,
    score,
    hook: 0,
    flow: 0,
    engagement: 0,
    trend: 0,
    hookLine: "",
    suggestedTitle: "",
    suggestedCaption: "",
    why: "",
  });

  it("keeps the higher-scored of two heavy overlaps", () => {
    const out = dedupCandidates([make(0, 30, 70), make(5, 32, 80)]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(80);
  });

  it("keeps non-overlapping candidates", () => {
    const out = dedupCandidates([make(0, 30, 70), make(60, 90, 65)]);
    expect(out).toHaveLength(2);
  });

  it("keeps both when overlap is <= 50%", () => {
    // a: 0-30, b: 25-55, overlap=5, min length=30, fraction=5/30 ≈ 0.17 → keep both
    const out = dedupCandidates([make(0, 30, 70), make(25, 55, 65)]);
    expect(out).toHaveLength(2);
  });

  it("returns sorted desc by score", () => {
    const out = dedupCandidates([make(0, 30, 70), make(60, 90, 90), make(120, 150, 50)]);
    expect(out.map((c) => c.score)).toEqual([90, 70, 50]);
  });
});

describe("normalizeCandidates", () => {
  it("clamps to [0, total] and drops too-short", () => {
    const out = normalizeCandidates(
      [
        {
          startSec: -5,
          endSec: 25,
          hookLine: "",
          suggestedTitle: "",
          suggestedCaption: "",
          why: "",
        },
        {
          startSec: 50,
          endSec: 51,
          hookLine: "",
          suggestedTitle: "",
          suggestedCaption: "",
          why: "",
        },
      ],
      100,
      20,
      60,
    );
    expect(out).toHaveLength(1);
    expect(out[0].startSec).toBe(0);
    expect(out[0].endSec).toBe(25);
  });

  it("trims overlong clips to maxSec", () => {
    const out = normalizeCandidates(
      [
        {
          startSec: 10,
          endSec: 200,
          hookLine: "",
          suggestedTitle: "",
          suggestedCaption: "",
          why: "",
        },
      ],
      300,
      20,
      60,
    );
    expect(out[0].endSec).toBe(70);
  });
});

describe("parseProposalResponse", () => {
  it("parses well-formed proposals", () => {
    const r = parseProposalResponse(
      JSON.stringify({
        candidates: [
          {
            startSec: 10,
            endSec: 40,
            hookLine: "let me tell you something",
            suggestedTitle: "Why X",
            suggestedCaption: "Watch this",
            why: "tight payoff",
          },
        ],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0].startSec).toBe(10);
    expect(r[0].suggestedTitle).toBe("Why X");
  });

  it("drops malformed entries silently", () => {
    const r = parseProposalResponse(
      JSON.stringify({
        candidates: [
          { startSec: "bad", endSec: 30 },
          { startSec: 10, endSec: 5 }, // end <= start
          { startSec: 0, endSec: 10, hookLine: "ok" },
        ],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0].hookLine).toBe("ok");
  });

  it("returns [] on absent JSON", () => {
    expect(parseProposalResponse("plain prose")).toEqual([]);
  });

  it("caps to 3 candidates", () => {
    const r = parseProposalResponse(
      JSON.stringify({
        candidates: Array.from({ length: 10 }, (_, i) => ({
          startSec: i * 10,
          endSec: i * 10 + 5,
        })),
      }),
    );
    expect(r).toHaveLength(3);
  });
});
