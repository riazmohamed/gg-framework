import { describe, expect, it } from "vitest";
import {
  detectApiKey,
  detectLocalWhisper,
  openAIResponseToTranscript,
  parseTranscript,
  planOpenAIRequest,
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

describe("planOpenAIRequest", () => {
  // Per https://platform.openai.com/docs/api-reference/audio:
  //   - whisper-1                only model with verbose_json + timestamp_granularities
  //   - gpt-4o-(mini-)transcribe response_format must be 'json' (verbose_json rejected)
  //   - gpt-4o-transcribe-diarize must use 'diarized_json'; chunking required >30s
  it("whisper-1 always asks for verbose_json (segment timing comes free)", () => {
    const p = planOpenAIRequest("whisper-1", {});
    expect(p.responseFormat).toBe("verbose_json");
    expect(p.emitsTimestamps).toBe(true);
    expect(p.emitsSpeakers).toBe(false);
    expect(p.chunkingStrategy).toBeUndefined();
  });

  it("gpt-4o-transcribe forces json (verbose_json would 400)", () => {
    const p = planOpenAIRequest("gpt-4o-transcribe", { wordTimestamps: true });
    expect(p.responseFormat).toBe("json");
    expect(p.emitsTimestamps).toBe(false);
    expect(p.emitsSpeakers).toBe(false);
  });

  it("gpt-4o-mini-transcribe forces json", () => {
    const p = planOpenAIRequest("gpt-4o-mini-transcribe", {});
    expect(p.responseFormat).toBe("json");
  });

  it("gpt-4o-transcribe-diarize defaults to diarized_json + auto chunking", () => {
    const p = planOpenAIRequest("gpt-4o-transcribe-diarize", {});
    expect(p.responseFormat).toBe("diarized_json");
    expect(p.emitsSpeakers).toBe(true);
    expect(p.emitsTimestamps).toBe(true);
    expect(p.chunkingStrategy).toBe("auto");
  });

  it("honours an explicit chunkingStrategy on diarize", () => {
    const p = planOpenAIRequest("gpt-4o-transcribe-diarize", { chunkingStrategy: "auto" });
    expect(p.chunkingStrategy).toBe("auto");
  });
});

describe("openAIResponseToTranscript", () => {
  it("verbose_json: lifts segments + word timing onto our shape", () => {
    const t = openAIResponseToTranscript(
      {
        text: "Hello world.",
        language: "en",
        duration: 2.5,
        segments: [{ start: 0, end: 2.5, text: " Hello world." }],
        words: [
          { start: 0, end: 0.5, word: "Hello" },
          { start: 0.6, end: 2.5, word: "world." },
        ],
      },
      {
        responseFormat: "verbose_json",
        emitsTimestamps: true,
        emitsSpeakers: false,
        chunkingStrategy: undefined,
      },
      { wordTimestamps: true },
    );
    expect(t.language).toBe("en");
    expect(t.segments).toHaveLength(1);
    expect(t.segments[0].text).toBe("Hello world.");
    expect(t.segments[0].words).toHaveLength(2);
    expect(t.segments[0].speaker).toBeUndefined();
  });

  it("json (gpt-4o-transcribe): synthesises a single segment from text + duration", () => {
    const t = openAIResponseToTranscript(
      { text: "  full transcript here.  ", language: "en", duration: 12.34 },
      {
        responseFormat: "json",
        emitsTimestamps: false,
        emitsSpeakers: false,
        chunkingStrategy: undefined,
      },
      {},
    );
    expect(t.segments).toHaveLength(1);
    expect(t.segments[0].text).toBe("full transcript here.");
    expect(t.segments[0].start).toBe(0);
    expect(t.segments[0].end).toBe(12.34);
    expect(t.durationSec).toBe(12.34);
  });

  it("json with empty text: returns no segments rather than a 0-length stub", () => {
    const t = openAIResponseToTranscript(
      { text: "" },
      {
        responseFormat: "json",
        emitsTimestamps: false,
        emitsSpeakers: false,
        chunkingStrategy: undefined,
      },
      {},
    );
    expect(t.segments).toEqual([]);
  });

  it("diarized_json: passes through speaker labels per segment", () => {
    const t = openAIResponseToTranscript(
      {
        segments: [
          { start: 0, end: 4.2, text: "Welcome.", speaker: "A" },
          { start: 4.8, end: 7.1, text: "Thanks.", speaker: "B" },
        ],
      },
      {
        responseFormat: "diarized_json",
        emitsTimestamps: true,
        emitsSpeakers: true,
        chunkingStrategy: "auto",
      },
      { language: "en" },
    );
    expect(t.segments[0].speaker).toBe("A");
    expect(t.segments[1].speaker).toBe("B");
    expect(t.language).toBe("en");
    expect(t.durationSec).toBe(7.1); // last segment.end fallback when duration absent
  });

  it("strips speaker fields when the plan says model doesn't emit them", () => {
    // Defensive: even if the response includes speaker (it shouldn't), don't
    // forward speaker labels we can't trust.
    const t = openAIResponseToTranscript(
      {
        segments: [{ start: 0, end: 1, text: "hi", speaker: "SHOULD_BE_DROPPED" }],
      },
      {
        responseFormat: "verbose_json",
        emitsTimestamps: true,
        emitsSpeakers: false,
        chunkingStrategy: undefined,
      },
      {},
    );
    expect(t.segments[0].speaker).toBeUndefined();
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

describe("parseTranscript", () => {
  const validRaw = JSON.stringify({
    language: "en",
    durationSec: 30,
    segments: [
      { start: 0, end: 5, text: "Hello world" },
      { start: 5, end: 10, text: "How are you" },
    ],
  });

  it("returns a valid Transcript for well-formed input", () => {
    const t = parseTranscript(validRaw);
    expect(t.language).toBe("en");
    expect(t.durationSec).toBe(30);
    expect(t.segments).toHaveLength(2);
    expect(t.segments[0].text).toBe("Hello world");
  });

  it("accepts an empty segments array", () => {
    const t = parseTranscript(JSON.stringify({ language: "en", durationSec: 0, segments: [] }));
    expect(t.segments).toHaveLength(0);
  });

  it("passes through optional word-level timings", () => {
    const raw = JSON.stringify({
      language: "en",
      durationSec: 5,
      segments: [
        {
          start: 0,
          end: 5,
          text: "hello",
          words: [{ start: 0, end: 0.5, text: "hello" }],
        },
      ],
    });
    const t = parseTranscript(raw);
    expect(t.segments[0].words).toHaveLength(1);
  });

  it("throws on non-JSON input", () => {
    expect(() => parseTranscript("not json")).toThrow(/Invalid transcript: not valid JSON/);
  });

  it("throws when root is an array, not an object", () => {
    expect(() => parseTranscript("[]")).toThrow(/Invalid transcript: root value must be an object/);
  });

  it("throws when language is missing", () => {
    const raw = JSON.stringify({ durationSec: 10, segments: [] });
    expect(() => parseTranscript(raw)).toThrow(
      /Invalid transcript: missing or non-string 'language'/,
    );
  });

  it("throws when language is not a string", () => {
    const raw = JSON.stringify({ language: 42, durationSec: 10, segments: [] });
    expect(() => parseTranscript(raw)).toThrow(
      /Invalid transcript: missing or non-string 'language'/,
    );
  });

  it("throws when durationSec is missing", () => {
    const raw = JSON.stringify({ language: "en", segments: [] });
    expect(() => parseTranscript(raw)).toThrow(
      /Invalid transcript: missing or invalid 'durationSec'/,
    );
  });

  it("throws when durationSec is not a number", () => {
    const raw = JSON.stringify({ language: "en", durationSec: "30s", segments: [] });
    expect(() => parseTranscript(raw)).toThrow(
      /Invalid transcript: missing or invalid 'durationSec'/,
    );
  });

  it("throws when durationSec is negative", () => {
    const raw = JSON.stringify({ language: "en", durationSec: -1, segments: [] });
    expect(() => parseTranscript(raw)).toThrow(
      /Invalid transcript: missing or invalid 'durationSec'/,
    );
  });

  it("throws when durationSec is null", () => {
    const raw = JSON.stringify({ language: "en", durationSec: null, segments: [] });
    expect(() => parseTranscript(raw)).toThrow(
      /Invalid transcript: missing or invalid 'durationSec'/,
    );
  });

  it("throws when segments is missing", () => {
    const raw = JSON.stringify({ language: "en", durationSec: 10 });
    expect(() => parseTranscript(raw)).toThrow(/'segments' must be an array/);
  });

  it("throws when segments is not an array", () => {
    const raw = JSON.stringify({ language: "en", durationSec: 10, segments: {} });
    expect(() => parseTranscript(raw)).toThrow(/'segments' must be an array/);
  });

  it("throws when a segment is missing start", () => {
    const raw = JSON.stringify({
      language: "en",
      durationSec: 10,
      segments: [{ end: 5, text: "hi" }],
    });
    expect(() => parseTranscript(raw)).toThrow(/segments\[0\]\.start must be a number/);
  });

  it("throws when a segment is missing end", () => {
    const raw = JSON.stringify({
      language: "en",
      durationSec: 10,
      segments: [{ start: 0, text: "hi" }],
    });
    expect(() => parseTranscript(raw)).toThrow(/segments\[0\]\.end must be a number/);
  });

  it("throws when a segment text is not a string", () => {
    const raw = JSON.stringify({
      language: "en",
      durationSec: 10,
      segments: [{ start: 0, end: 5, text: null }],
    });
    expect(() => parseTranscript(raw)).toThrow(/segments\[0\]\.text must be a string/);
  });

  it("reports the correct index for a bad segment in a multi-segment array", () => {
    const raw = JSON.stringify({
      language: "en",
      durationSec: 10,
      segments: [
        { start: 0, end: 2, text: "ok" },
        { start: 2, end: 5 }, // missing text
      ],
    });
    expect(() => parseTranscript(raw)).toThrow(/segments\[1\]\.text must be a string/);
  });
});
