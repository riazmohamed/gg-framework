import { describe, expect, it } from "vitest";
import {
  detectApiKey,
  detectLocalWhisper,
  regroupTokensIntoSegments,
  whisperxJsonToTranscript,
} from "./whisper.js";

describe("detectApiKey", () => {
  it("prefers explicit override", () => {
    expect(detectApiKey("explicit-key")).toBe("explicit-key");
  });
  it("falls back to env", () => {
    const before = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "env-key";
    try {
      expect(detectApiKey()).toBe("env-key");
    } finally {
      if (before === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = before;
    }
  });
  it("returns undefined when no key available", () => {
    const before = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(detectApiKey()).toBeUndefined();
    } finally {
      if (before !== undefined) process.env.OPENAI_API_KEY = before;
    }
  });
});

describe("detectLocalWhisper", () => {
  it("returns either a candidate or undefined cleanly", () => {
    const r = detectLocalWhisper();
    if (r) {
      expect(typeof r.cmd).toBe("string");
      expect(["whisper-cli", "whisper", "main"]).toContain(r.cmd);
    }
    // If undefined, that's fine — most CI envs lack whisper.cpp.
  });
});

describe("whisperxJsonToTranscript", () => {
  // Shape modelled on real whisperx output observed across
  // typedef-ai/fenic, fastrepl/char, and pavelzbornik/whisperX-FastAPI fixtures.
  it("parses segments with speaker labels", () => {
    const t = whisperxJsonToTranscript({
      language: "en",
      segments: [
        { start: 0.5, end: 4.2, text: "Welcome.", speaker: "SPEAKER_00" },
        { start: 4.8, end: 7.1, text: "Thanks.", speaker: "SPEAKER_01" },
      ],
    });
    expect(t.language).toBe("en");
    expect(t.segments).toHaveLength(2);
    expect(t.segments[0].speaker).toBe("SPEAKER_00");
    expect(t.segments[1].speaker).toBe("SPEAKER_01");
    expect(t.durationSec).toBe(7.1);
  });

  it("lifts word-level timing and trims leading-space whisperx tokens", () => {
    // Real whisperx puts a leading space on every word: " Let", " me", ...
    const t = whisperxJsonToTranscript({
      language: "en",
      segments: [
        {
          start: 2.94,
          end: 3.74,
          text: "Let me ask",
          speaker: "SPEAKER_01",
          words: [
            { start: 2.94, end: 3.12, word: " Let", speaker: "SPEAKER_01" },
            { start: 3.12, end: 3.26, word: " me", speaker: "SPEAKER_01" },
            { start: 3.26, end: 3.74, word: " ask", speaker: "SPEAKER_01" },
          ],
        },
      ],
    });
    const seg = t.segments[0];
    expect(seg.words).toBeDefined();
    expect(seg.words![0].text).toBe("Let");
    expect(seg.words![1].text).toBe("me");
    expect(seg.words![2].text).toBe("ask");
    expect(seg.words![0].start).toBe(2.94);
  });

  it("drops words with non-finite timings (real whisperx sometimes emits NaN)", () => {
    const t = whisperxJsonToTranscript({
      segments: [
        {
          start: 0,
          end: 1,
          text: "hi",
          words: [
            { start: 0, end: 0.3, word: "hi" },
            { start: NaN as unknown as number, end: 0.6, word: "???" },
            { start: 0.6, end: 1, word: "there" },
          ],
        },
      ],
    });
    expect(t.segments[0].words).toHaveLength(2);
  });

  it("omits speaker / words when absent (no diarize, no alignment)", () => {
    const t = whisperxJsonToTranscript({
      segments: [{ start: 0, end: 2, text: "hello" }],
    });
    expect(t.segments[0].speaker).toBeUndefined();
    expect(t.segments[0].words).toBeUndefined();
  });

  it("falls back to provided language when JSON omits it", () => {
    const t = whisperxJsonToTranscript({ segments: [] }, "de");
    expect(t.language).toBe("de");
    expect(t.segments).toEqual([]);
    expect(t.durationSec).toBe(0);
  });
});

describe("regroupTokensIntoSegments", () => {
  it("flushes a segment at sentence punctuation", () => {
    const segs = regroupTokensIntoSegments([
      { offsets: { from: 0, to: 200 }, text: "Hello" },
      { offsets: { from: 200, to: 500 }, text: "world." },
      { offsets: { from: 600, to: 800 }, text: "Next" },
      { offsets: { from: 800, to: 1100 }, text: "sentence." },
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].text).toBe("Hello world.");
    expect(segs[0].words).toHaveLength(2);
    expect(segs[0].start).toBe(0);
    expect(segs[0].end).toBe(0.5);
    expect(segs[1].text).toBe("Next sentence.");
  });

  it("flushes any tail tokens that don't end with punctuation", () => {
    const segs = regroupTokensIntoSegments([
      { offsets: { from: 0, to: 100 }, text: "hanging" },
      { offsets: { from: 100, to: 200 }, text: "line" },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].words).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(regroupTokensIntoSegments([])).toEqual([]);
  });

  it("skips empty / whitespace-only tokens", () => {
    const segs = regroupTokensIntoSegments([
      { offsets: { from: 0, to: 100 }, text: "hi" },
      { offsets: { from: 100, to: 110 }, text: "   " },
      { offsets: { from: 110, to: 200 }, text: "there." },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].words).toHaveLength(2);
    expect(segs[0].text).toBe("hi there.");
  });
});
