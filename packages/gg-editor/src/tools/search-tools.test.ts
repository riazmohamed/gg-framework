import { describe, expect, it } from "vitest";
import { createSearchToolsTool, scoreToolMatch, type SearchableTool } from "./search-tools.js";

const FAKE_TOOLS: SearchableTool[] = [
  { name: "detect_silence", description: "ffmpeg silencedetect → frame-aligned KEEP ranges" },
  { name: "trim_dead_air", description: "Trim leading/trailing or all silence in one call" },
  { name: "write_srt", description: "SubRip caption writer (sentence + word-level)" },
  { name: "burn_subtitles", description: "Hardcode .srt or .ass into a video" },
  { name: "generate_youtube_metadata", description: "Title, description, tags, chapters from a transcript" },
];

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createSearchToolsTool>["execute"]>[1];

describe("scoreToolMatch", () => {
  it("ranks exact name substring highest", () => {
    expect(scoreToolMatch("silence", FAKE_TOOLS[0])).toBeGreaterThan(
      scoreToolMatch("silence", FAKE_TOOLS[2]),
    );
  });

  it("returns 0 when no overlap", () => {
    expect(scoreToolMatch("rocket", FAKE_TOOLS[0])).toBe(0);
  });

  it("rewards multi-word queries", () => {
    const single = scoreToolMatch("youtube", FAKE_TOOLS[4]);
    const multi = scoreToolMatch("youtube metadata", FAKE_TOOLS[4]);
    expect(multi).toBeGreaterThan(single);
  });

  it("handles empty query", () => {
    expect(scoreToolMatch("", FAKE_TOOLS[0])).toBe(0);
  });
});

describe("search_tools tool", () => {
  const tool = createSearchToolsTool(() => FAKE_TOOLS);

  it("returns matches in score order", async () => {
    const r = await tool.execute({ query: "silence" }, ctx);
    expect(typeof r).toBe("string");
    const parsed = JSON.parse(r as string) as { matches: Array<{ name: string }> };
    expect(parsed.matches[0].name).toBe("detect_silence");
  });

  it("limits results", async () => {
    const r = await tool.execute({ query: "the" }, ctx);
    const parsed = JSON.parse(r as string) as { matches: unknown[] };
    expect(parsed.matches.length).toBeLessThanOrEqual(8);
  });

  it("returns empty matches with a note on miss", async () => {
    const r = await tool.execute({ query: "blockchain ethereum" }, ctx);
    const parsed = JSON.parse(r as string) as { matches: unknown[]; note?: string };
    expect(parsed.matches).toEqual([]);
    expect(parsed.note).toBeTruthy();
  });

  it("excludes itself from results", async () => {
    const tools = [...FAKE_TOOLS, { name: "search_tools", description: "Find tools by query" }];
    const t = createSearchToolsTool(() => tools);
    const r = await t.execute({ query: "tools" }, ctx);
    const parsed = JSON.parse(r as string) as { matches: Array<{ name: string }> };
    expect(parsed.matches.find((m) => m.name === "search_tools")).toBeUndefined();
  });
});
