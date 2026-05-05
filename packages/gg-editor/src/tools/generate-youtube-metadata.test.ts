import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenerateYouTubeMetadataTool } from "./generate-youtube-metadata.js";

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<
  ReturnType<typeof createGenerateYouTubeMetadataTool>["execute"]
>[1];

function writeTranscript(dir: string, payload: unknown): string {
  const p = join(dir, "t.json");
  writeFileSync(p, JSON.stringify(payload), "utf8");
  return p;
}

describe("generate_youtube_metadata tool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("description names YouTube + chapters + ranking + ALWAYS-pre-publish", () => {
    const tool = createGenerateYouTubeMetadataTool("/tmp");
    expect(tool.description).toMatch(/YouTube/i);
    expect(tool.description).toMatch(/chapter/i);
    expect(tool.description).toMatch(/ALWAYS|rank/i);
  });

  it("errors when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const tool = createGenerateYouTubeMetadataTool("/tmp");
    const r = await tool.execute({ transcript: "x.json" }, ctx);
    expect(r as string).toMatch(/^error:.*OPENAI_API_KEY/);
  });

  it("errors on missing transcript file", async () => {
    process.env.OPENAI_API_KEY = "k";
    const tool = createGenerateYouTubeMetadataTool("/tmp");
    const r = await tool.execute({ transcript: "no/such.json" }, ctx);
    expect(r as string).toMatch(/^error:.*cannot read/);
  });

  it("errors on transcript with no segments", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-yt-"));
    writeTranscript(dir, { language: "en", durationSec: 10, segments: [] });
    const tool = createGenerateYouTubeMetadataTool(dir);
    const r = await tool.execute({ transcript: "t.json" }, ctx);
    expect(r as string).toMatch(/no segments/);
  });

  it("returns parseable JSON on success and drops chapters for short videos", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-yt-"));
    writeTranscript(dir, {
      language: "en",
      durationSec: 120, // < 5 min → chapters dropped
      segments: [{ start: 0, end: 120, text: "hello world" }],
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
                  titles: ["one", "two", "three"],
                  description: "the desc",
                  tags: ["tech"],
                  chapters: [{ atSec: 0, title: "Intro" }],
                  hashtags: ["#x"],
                }),
              },
            },
          ],
        }),
        text: async () => "",
      })) as unknown as typeof fetch,
    );
    const tool = createGenerateYouTubeMetadataTool(dir);
    const r = await tool.execute({ transcript: "t.json" }, ctx);
    const parsed = JSON.parse(r as string);
    expect(parsed.titles).toHaveLength(3);
    expect(parsed.chapters).toEqual([]);
  });

  it("uses json_object response format and temperature 0", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-yt-"));
    writeTranscript(dir, {
      language: "en",
      durationSec: 60,
      segments: [{ start: 0, end: 60, text: "x" }],
    });
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: { body?: string }) => {
        captured = JSON.parse(init?.body ?? "{}");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    titles: ["a", "b", "c"],
                    description: "x",
                    tags: [],
                    chapters: [],
                    hashtags: [],
                  }),
                },
              },
            ],
          }),
          text: async () => "",
        } as unknown as Response;
      }),
    );
    const tool = createGenerateYouTubeMetadataTool(dir);
    await tool.execute({ transcript: "t.json" }, ctx);
    expect(captured?.response_format).toEqual({ type: "json_object" });
    expect(captured?.temperature).toBe(0);
  });
});
