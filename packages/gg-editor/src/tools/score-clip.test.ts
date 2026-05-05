import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScoreClipTool, sliceTranscriptText } from "./score-clip.js";

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createScoreClipTool>["execute"]>[1];

function writeTranscript(dir: string, payload: unknown): string {
  const p = join(dir, "t.json");
  writeFileSync(p, JSON.stringify(payload), "utf8");
  return p;
}

describe("score_clip tool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("has a non-empty description naming the next-call hooks", () => {
    const tool = createScoreClipTool("/tmp");
    expect(tool.description.length).toBeGreaterThan(80);
    expect(tool.description).toMatch(/find_viral_moments|virality/i);
  });

  it("errors when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const tool = createScoreClipTool("/tmp");
    const r = await tool.execute(
      { transcript: "no.json", startSec: 0, endSec: 10 },
      ctx,
    );
    expect(r as string).toMatch(/^error:.*OPENAI_API_KEY/);
  });

  it("errors when endSec <= startSec", async () => {
    process.env.OPENAI_API_KEY = "k";
    const tool = createScoreClipTool("/tmp");
    const r = await tool.execute(
      { transcript: "no.json", startSec: 5, endSec: 5 },
      ctx,
    );
    expect(r as string).toMatch(/^error:.*startSec/);
  });

  it("errors when transcript file is missing", async () => {
    process.env.OPENAI_API_KEY = "k";
    const tool = createScoreClipTool("/tmp");
    const r = await tool.execute(
      { transcript: "no/such/file.json", startSec: 0, endSec: 10 },
      ctx,
    );
    expect(r as string).toMatch(/^error:.*cannot read/);
  });

  it("errors on transcript with no segments", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-sc-"));
    writeTranscript(dir, { language: "en", durationSec: 10, segments: [] });
    const tool = createScoreClipTool(dir);
    const r = await tool.execute(
      { transcript: "t.json", startSec: 0, endSec: 5 },
      ctx,
    );
    expect(r as string).toMatch(/^error:.*no segments/);
  });

  it("returns a JSON-shaped success when LLM responds correctly", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-sc-"));
    writeTranscript(dir, {
      language: "en",
      durationSec: 60,
      segments: [
        { start: 0, end: 30, text: "this is a strong hook line about money" },
        { start: 30, end: 60, text: "and the payoff lands cleanly" },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  hook: 0.9,
                  flow: 0.7,
                  engagement: 0.8,
                  trend: 0.6,
                  why: "tight",
                }),
              },
            },
          ],
        }),
        text: async () => "",
      })) as unknown as typeof fetch,
    );
    const tool = createScoreClipTool(dir);
    const r = await tool.execute(
      { transcript: "t.json", startSec: 0, endSec: 60 },
      ctx,
    );
    const parsed = JSON.parse(r as string);
    expect(parsed.score).toBeGreaterThan(0);
    expect(parsed.score).toBeLessThanOrEqual(100);
    expect(parsed.hook).toBe(0.9);
    expect(parsed.durationSec).toBe(60);
    expect(parsed.why).toBeDefined();
  });
});

describe("sliceTranscriptText", () => {
  it("includes overlapping segments and trims", () => {
    const text = sliceTranscriptText(
      {
        language: "en",
        durationSec: 30,
        segments: [
          { start: 0, end: 10, text: "  alpha " },
          { start: 10, end: 20, text: " beta" },
          { start: 20, end: 30, text: "gamma" },
        ],
      },
      5,
      18,
    );
    // overlaps [0,10] and [10,20]; not [20,30]
    expect(text).toBe("alpha beta");
  });

  it("returns empty when nothing overlaps", () => {
    expect(
      sliceTranscriptText(
        { language: "en", durationSec: 10, segments: [{ start: 0, end: 5, text: "x" }] },
        6,
        10,
      ),
    ).toBe("");
  });
});
