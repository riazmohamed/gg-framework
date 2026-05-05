import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSuggestBrollTool } from "./suggest-broll.js";
import type { Transcript } from "../core/whisper.js";

/**
 * suggest_broll mocks the network (OpenAI + Pexels) and the filesystem
 * download path. It never actually hits the wire.
 *
 * Test ordering matters because we mutate process.env.PEXELS_API_KEY /
 * OPENAI_API_KEY and stub global.fetch — every `it` cleans up.
 */

const TX: Transcript = {
  language: "en",
  durationSec: 60,
  segments: [
    { start: 0, end: 5, text: "Today I want to talk about my morning coffee routine." },
    { start: 5, end: 10, text: "I drive down the highway as the sun rises." },
    { start: 10, end: 15, text: "Then I open my laptop and start typing." },
  ],
};

function makeTranscriptFile(t: Transcript): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "gg-sbr-"));
  const path = join(dir, "transcript.json");
  writeFileSync(path, JSON.stringify(t), "utf8");
  return { dir, path };
}

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createSuggestBrollTool>["execute"]>[1];

// JSON helper for fetch mocks
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function llmResponse(queries: Array<{ atSec: number; query: string; why: string }>): Response {
  return jsonResponse({
    choices: [{ message: { content: JSON.stringify({ queries }) } }],
  });
}

function pexelsVideo(opts: {
  id: number;
  duration?: number;
  link?: string;
  user?: string;
  url?: string;
}): unknown {
  return {
    id: opts.id,
    width: 1920,
    height: 1080,
    duration: opts.duration ?? 12,
    url: opts.url ?? `https://www.pexels.com/video/${opts.id}/`,
    user: { name: opts.user ?? "Jane Photographer" },
    video_files: [
      {
        link: opts.link ?? `https://cdn.pexels.com/v/${opts.id}.mp4`,
        quality: "hd",
        width: 1920,
        height: 1080,
        file_type: "video/mp4",
      },
    ],
  };
}

const ENV_BACKUP: Record<string, string | undefined> = {};

beforeEach(() => {
  ENV_BACKUP.PEXELS_API_KEY = process.env.PEXELS_API_KEY;
  ENV_BACKUP.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  process.env.PEXELS_API_KEY = "test-pexels";
  process.env.OPENAI_API_KEY = "test-openai";
});

afterEach(() => {
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("suggest_broll", () => {
  it("errors when PEXELS_API_KEY is unset", async () => {
    delete process.env.PEXELS_API_KEY;
    // Make sure the stored-key fallback returns nothing either.
    vi.doMock("../core/auth/api-keys.js", async (orig) => {
      const mod = await orig<typeof import("../core/auth/api-keys.js")>();
      return {
        ...mod,
        getStoredApiKey: () => undefined,
        resolveApiKey: (envVar: string) =>
          envVar === "OPENAI_API_KEY" ? process.env.OPENAI_API_KEY : undefined,
      };
    });
    // Re-import after the mock so the tool resolves the stubbed module.
    const { createSuggestBrollTool: freshCreate } = await import("./suggest-broll.js");
    const { dir } = makeTranscriptFile(TX);
    const tool = freshCreate(dir);
    const r = (await tool.execute({ transcript: "transcript.json" }, ctx)) as string;
    expect(r).toMatch(/^error: PEXELS_API_KEY not set/);
    vi.doUnmock("../core/auth/api-keys.js");
  });

  it("errors when transcript file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-sbr-"));
    const tool = createSuggestBrollTool(dir);
    const r = (await tool.execute({ transcript: "nope.json" }, ctx)) as string;
    expect(r).toMatch(/^error: cannot read transcript/);
  });

  it("errors when transcript is malformed JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-sbr-"));
    writeFileSync(join(dir, "t.json"), "{not json", "utf8");
    const tool = createSuggestBrollTool(dir);
    const r = (await tool.execute({ transcript: "t.json" }, ctx)) as string;
    expect(r).toMatch(/^error: transcript is not valid JSON/);
  });

  it("returns formatted items when LLM + Pexels both succeed (download=false)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        llmResponse([
          { atSec: 2, query: "morning coffee shop", why: "speaker mentions coffee" },
          { atSec: 7, query: "highway sunrise driving", why: "speaker drives at sunrise" },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ videos: [pexelsVideo({ id: 1001 })] }))
      .mockResolvedValueOnce(jsonResponse({ videos: [pexelsVideo({ id: 1002 })] }));
    vi.stubGlobal("fetch", fetchMock);

    const { dir } = makeTranscriptFile(TX);
    const tool = createSuggestBrollTool(dir);
    const r = (await tool.execute(
      { transcript: "transcript.json", download: false },
      ctx,
    )) as string;

    expect(r).not.toMatch(/^error/);
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(2);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].query).toBe("morning coffee shop");
    expect(parsed.items[0].sourceUrl).toContain("pexels.com");
    expect(parsed.items[0].pexelsId).toBe(1001);
    // download=false → no mediaPath
    expect(parsed.items[0].mediaPath).toBeUndefined();
    expect(parsed.items[1].pexelsId).toBe(1002);

    // First call hits OpenAI, next two hit Pexels (no download fetches).
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toContain("api.openai.com");
    expect(urls[1]).toContain("api.pexels.com/videos/search");
    expect(urls[2]).toContain("api.pexels.com/videos/search");
  });

  it("returns user-friendly error on Pexels 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        llmResponse([{ atSec: 1, query: "morning coffee", why: "x" }]),
      )
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const { dir } = makeTranscriptFile(TX);
    const tool = createSuggestBrollTool(dir);
    const r = (await tool.execute(
      { transcript: "transcript.json", download: false },
      ctx,
    )) as string;

    expect(r).toMatch(/^error: Pexels 401 unauthorized/);
    expect(r).toContain("verify PEXELS_API_KEY");
  });

  it("collects per-query failures into skipped[] and still returns successes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        llmResponse([
          { atSec: 2, query: "coffee shop morning", why: "a" },
          { atSec: 7, query: "obscure abstract concept", why: "b" },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ videos: [pexelsVideo({ id: 2001 })] }))
      .mockResolvedValueOnce(jsonResponse({ videos: [] })); // empty → skipped
    vi.stubGlobal("fetch", fetchMock);

    const { dir } = makeTranscriptFile(TX);
    const tool = createSuggestBrollTool(dir);
    const r = (await tool.execute(
      { transcript: "transcript.json", download: false },
      ctx,
    )) as string;

    expect(r).not.toMatch(/^error/);
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(1);
    expect(parsed.items[0].pexelsId).toBe(2001);
    expect(parsed.skipped).toHaveLength(1);
    expect(parsed.skipped[0].query).toBe("obscure abstract concept");
    expect(parsed.skipped[0].reason).toMatch(/no Pexels match/);
  });

  it("downloads to outDir when download=true and writes the file", async () => {
    const downloadDir = mkdtempSync(join(tmpdir(), "gg-sbr-out-"));
    const fakeBytes = Buffer.from("FAKE_VIDEO_BYTES");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        llmResponse([{ atSec: 2, query: "coffee shop morning", why: "x" }]),
      )
      .mockResolvedValueOnce(jsonResponse({ videos: [pexelsVideo({ id: 3001 })] }))
      .mockResolvedValueOnce(
        new Response(fakeBytes, { status: 200, headers: { "Content-Type": "video/mp4" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { dir } = makeTranscriptFile(TX);
    const tool = createSuggestBrollTool(dir);
    const r = (await tool.execute(
      {
        transcript: "transcript.json",
        download: true,
        outDir: downloadDir,
      },
      ctx,
    )) as string;

    expect(r).not.toMatch(/^error/);
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(1);
    expect(parsed.items[0].mediaPath).toBe(join(downloadDir, "pexels-3001.mp4"));
    expect(existsSync(parsed.items[0].mediaPath)).toBe(true);

    // Files in the dir = exactly one mp4.
    const files = readdirSync(downloadDir);
    expect(files).toContain("pexels-3001.mp4");
  });

  it("output is valid JSON with {count, items} shape", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        llmResponse([{ atSec: 1, query: "city skyline", why: "x" }]),
      )
      .mockResolvedValueOnce(jsonResponse({ videos: [pexelsVideo({ id: 9 })] }));
    vi.stubGlobal("fetch", fetchMock);

    const { dir } = makeTranscriptFile(TX);
    const tool = createSuggestBrollTool(dir);
    const r = (await tool.execute(
      { transcript: "transcript.json", download: false },
      ctx,
    )) as string;
    const parsed = JSON.parse(r);
    expect(parsed).toHaveProperty("count");
    expect(parsed).toHaveProperty("items");
    expect(Array.isArray(parsed.items)).toBe(true);
  });
});
