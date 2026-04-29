import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReadTranscriptTool } from "./read-transcript.js";
import type { Transcript } from "../core/whisper.js";

/**
 * Filter combinations for read_transcript. The tool is the agent's main
 * pull-only-what-you-need lever — wrong filtering blows the context budget.
 */

function makeTranscriptFile(t: Transcript): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "gg-rt-"));
  const path = join(dir, "transcript.json");
  writeFileSync(path, JSON.stringify(t), "utf8");
  return { dir, path };
}

const TX: Transcript = {
  language: "en",
  durationSec: 120,
  segments: [
    { start: 0, end: 5, text: "Hello, welcome to the show.", speaker: "SPEAKER_00" },
    { start: 5, end: 10, text: "Today we discuss authentication.", speaker: "SPEAKER_00" },
    { start: 10, end: 20, text: "Auth is a deep topic.", speaker: "SPEAKER_01" },
    { start: 20, end: 30, text: "Yeah, OAuth and OIDC.", speaker: "SPEAKER_00" },
    { start: 30, end: 40, text: "Let's wrap with closing thoughts.", speaker: "SPEAKER_01" },
  ],
};

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createReadTranscriptTool>["execute"]>[1];

describe("read_transcript", () => {
  it("returns all segments when no filter supplied", async () => {
    const { dir } = makeTranscriptFile(TX);
    const tool = createReadTranscriptTool(dir);
    const r = await tool.execute({ path: "transcript.json" }, ctx);
    const parsed = JSON.parse(r as string);
    expect(parsed.totalMatched).toBe(5);
    expect(parsed.returned).toBe(5);
  });

  it("filters by [startSec, endSec) interval", async () => {
    const { dir } = makeTranscriptFile(TX);
    const tool = createReadTranscriptTool(dir);
    // Segments fully outside [10, 30) should be excluded; partial overlaps
    // included. End is exclusive so seg [10,20] is in; seg [20,30] is in
    // (start=20 < endSec=30); seg [30,40] is OUT (start >= endSec).
    const r = await tool.execute({ path: "transcript.json", startSec: 10, endSec: 30 }, ctx);
    const parsed = JSON.parse(r as string);
    expect(parsed.totalMatched).toBe(2);
  });

  it("filters by case-insensitive substring", async () => {
    const { dir } = makeTranscriptFile(TX);
    const tool = createReadTranscriptTool(dir);
    const r = await tool.execute({ path: "transcript.json", contains: "AUTH" }, ctx);
    const parsed = JSON.parse(r as string);
    expect(parsed.totalMatched).toBe(3);
  });

  it("filters by speaker (case-insensitive)", async () => {
    const { dir } = makeTranscriptFile(TX);
    const tool = createReadTranscriptTool(dir);
    const r = await tool.execute({ path: "transcript.json", speaker: "speaker_00" }, ctx);
    const parsed = JSON.parse(r as string);
    expect(parsed.totalMatched).toBe(3);
  });

  it("intersects multiple filters (range + speaker + contains)", async () => {
    const { dir } = makeTranscriptFile(TX);
    const tool = createReadTranscriptTool(dir);
    // SPEAKER_00 segments containing "auth" inside [0, 30)
    const r = await tool.execute(
      {
        path: "transcript.json",
        speaker: "SPEAKER_00",
        contains: "auth",
        startSec: 0,
        endSec: 30,
      },
      ctx,
    );
    const parsed = JSON.parse(r as string);
    expect(parsed.totalMatched).toBe(2);
  });

  it("respects limit and surfaces truncated=true", async () => {
    const { dir } = makeTranscriptFile(TX);
    const tool = createReadTranscriptTool(dir);
    const r = await tool.execute({ path: "transcript.json", limit: 2 }, ctx);
    const parsed = JSON.parse(r as string);
    expect(parsed.returned).toBe(2);
    expect(parsed.truncated).toBe(true);
  });

  it("returns surface-level error on missing path", async () => {
    const tool = createReadTranscriptTool("/nonexistent");
    const r = await tool.execute({ path: "missing.json" }, ctx);
    expect(r).toMatch(/^error:/);
  });

  it("includes speaker in compact output when present", async () => {
    const { dir } = makeTranscriptFile(TX);
    const tool = createReadTranscriptTool(dir);
    const r = await tool.execute({ path: "transcript.json", contains: "Hello" }, ctx);
    const parsed = JSON.parse(r as string);
    expect(parsed.segments[0].speaker).toBe("SPEAKER_00");
  });

  it("omits speaker when transcript has no labels", async () => {
    const noSpeaker: Transcript = {
      language: "en",
      durationSec: 5,
      segments: [{ start: 0, end: 5, text: "Hi" }],
    };
    const { dir } = makeTranscriptFile(noSpeaker);
    const tool = createReadTranscriptTool(dir);
    const r = await tool.execute({ path: "transcript.json" }, ctx);
    const parsed = JSON.parse(r as string);
    expect(parsed.segments[0].speaker).toBeUndefined();
  });

  it("includes word-level timing only when includeWords=true", async () => {
    const withWords: Transcript = {
      language: "en",
      durationSec: 1,
      segments: [
        {
          start: 0,
          end: 1,
          text: "hi there",
          words: [
            { start: 0, end: 0.4, text: "hi" },
            { start: 0.5, end: 1, text: "there" },
          ],
        },
      ],
    };
    const { dir } = makeTranscriptFile(withWords);
    const tool = createReadTranscriptTool(dir);

    const r1 = await tool.execute({ path: "transcript.json" }, ctx);
    const p1 = JSON.parse(r1 as string);
    expect(p1.segments[0].words).toBeUndefined();

    const r2 = await tool.execute({ path: "transcript.json", includeWords: true }, ctx);
    const p2 = JSON.parse(r2 as string);
    expect(p2.segments[0].words).toHaveLength(2);
  });
});
