import { describe, expect, it } from "vitest";
import { buildAss } from "./ass.js";
import { buildKeywordCaptions, DEFAULT_STOPLIST, isKeywordToken } from "./keyword-captions.js";

const STOP = new Set<string>(DEFAULT_STOPLIST.map((s) => s.toLowerCase()));

function w(text: string, start: number, end: number) {
  return { start, end, text };
}

describe("isKeywordToken", () => {
  it("rejects stoplist function words", () => {
    expect(isKeywordToken("the", STOP, 5)).toBe(false);
    expect(isKeywordToken("This", STOP, 5)).toBe(false);
    expect(isKeywordToken("um", STOP, 5)).toBe(false);
  });

  it("accepts long content words", () => {
    expect(isKeywordToken("retention", STOP, 5)).toBe(true);
    expect(isKeywordToken("creators", STOP, 5)).toBe(true);
  });

  it("rejects words shorter than minLen", () => {
    expect(isKeywordToken("dog", STOP, 5)).toBe(false);
  });

  it("accepts numbers regardless of length / stoplist", () => {
    expect(isKeywordToken("12", STOP, 5)).toBe(true);
    expect(isKeywordToken("3.14", STOP, 5)).toBe(true);
    expect(isKeywordToken("80%", STOP, 5)).toBe(true);
  });

  it("accepts ALL-CAPS tokens (>= 2 chars) regardless of length", () => {
    expect(isKeywordToken("AI", STOP, 5)).toBe(true);
    expect(isKeywordToken("CEO", STOP, 5)).toBe(true);
    // single capital letter does NOT count (avoids highlighting "I").
    expect(isKeywordToken("I", STOP, 5)).toBe(false);
  });

  it("strips trailing punctuation when matching", () => {
    expect(isKeywordToken("retention,", STOP, 5)).toBe(true);
    expect(isKeywordToken("the.", STOP, 5)).toBe(false);
  });
});

describe("buildKeywordCaptions", () => {
  it("returns empty cues for empty input", () => {
    const r = buildKeywordCaptions([]);
    expect(r.cues).toEqual([]);
    expect(r.styles.length).toBeGreaterThanOrEqual(2);
  });

  it("groups words into cues of groupSize", () => {
    const words = Array.from({ length: 6 }, (_, i) => w(`word${i}`, i * 0.3, i * 0.3 + 0.25));
    const r = buildKeywordCaptions(words, { groupSize: 2, gapSec: 5 });
    expect(r.cues).toHaveLength(3);
  });

  it("breaks cues on a gap >= gapSec even mid-group", () => {
    const words = [w("hello", 0, 0.3), w("world", 0.5, 0.8), w("again", 2.0, 2.3)];
    const r = buildKeywordCaptions(words, { groupSize: 5, gapSec: 0.5 });
    // gap between word2 and word3 is 1.2s — forces a new cue.
    expect(r.cues).toHaveLength(2);
  });

  it("emits two styles named Default and Keyword", () => {
    const r = buildKeywordCaptions([w("retention", 0, 0.3)]);
    const names = r.styles.map((s) => s.name);
    expect(names).toContain("Default");
    expect(names).toContain("Keyword");
  });

  it("wraps the longest content word with {\\rKeyword} ... {\\r}", () => {
    const words = [w("the", 0, 0.2), w("retention", 0.25, 0.65), w("graph", 0.7, 0.95)];
    const r = buildKeywordCaptions(words, { groupSize: 3, maxKeywordsPerCue: 1 });
    expect(r.cues[0].text).toContain("{\\rKeyword}retention{\\r}");
    expect(r.cues[0].text).not.toContain("{\\rKeyword}the");
  });

  it("respects maxKeywordsPerCue=2 — can highlight two words", () => {
    const words = [w("retention", 0, 0.4), w("graph", 0.5, 0.8), w("creators", 0.85, 1.3)];
    const r = buildKeywordCaptions(words, { groupSize: 3, maxKeywordsPerCue: 2 });
    const text = r.cues[0].text;
    expect((text.match(/\{\\rKeyword\}/g) ?? []).length).toBe(2);
  });

  it("respects maxKeywordsPerCue=0 — no highlighting", () => {
    const words = [w("retention", 0, 0.4), w("graph", 0.5, 0.8)];
    const r = buildKeywordCaptions(words, { groupSize: 3, maxKeywordsPerCue: 0 });
    expect(r.cues[0].text).not.toContain("{\\rKeyword}");
  });

  it("pads cue end past the last word", () => {
    const r = buildKeywordCaptions([w("hello", 0, 0.3)], { endPaddingSec: 0.2 });
    expect(r.cues[0].end).toBeCloseTo(0.5, 3);
  });

  it("output cues are accepted by buildAss without errors", () => {
    const words = [w("the", 0, 0.2), w("creator", 0.25, 0.7), w("retention", 0.75, 1.2)];
    const r = buildKeywordCaptions(words);
    const ass = buildAss({ styles: r.styles, cues: r.cues, playResX: 1080, playResY: 1920 });
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("Style: Keyword");
    expect(ass).toContain("retention");
  });
});
