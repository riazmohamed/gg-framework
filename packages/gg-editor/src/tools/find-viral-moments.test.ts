import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFindViralMomentsTool } from "./find-viral-moments.js";

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createFindViralMomentsTool>["execute"]>[1];

function writeTranscript(dir: string, payload: unknown): string {
  const p = join(dir, "t.json");
  writeFileSync(p, JSON.stringify(payload), "utf8");
  return p;
}

describe("find_viral_moments tool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("description names the orchestrator role + downstream tools", () => {
    const tool = createFindViralMomentsTool("/tmp");
    expect(tool.description).toMatch(/score_clip|render_multi_format|cut_at/);
  });

  it("errors when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const tool = createFindViralMomentsTool("/tmp");
    const r = await tool.execute({ transcript: "x.json" }, ctx);
    expect(r as string).toMatch(/^error:.*OPENAI_API_KEY/);
  });

  it("errors on empty transcript", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-fvm-"));
    writeTranscript(dir, { language: "en", durationSec: 60, segments: [] });
    const tool = createFindViralMomentsTool(dir);
    const r = await tool.execute({ transcript: "t.json" }, ctx);
    expect(r as string).toMatch(/no segments/);
  });

  it("errors on durationRange[1] <= durationRange[0]", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-fvm-"));
    writeTranscript(dir, {
      language: "en",
      durationSec: 60,
      segments: [{ start: 0, end: 60, text: "hello" }],
    });
    const tool = createFindViralMomentsTool(dir);
    const r = await tool.execute(
      { transcript: "t.json", durationRange: [60, 20] },
      ctx,
    );
    expect(r as string).toMatch(/^error:.*durationRange/);
  });

  it("returns ranked candidates after proposal+score+dedup", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-fvm-"));
    writeTranscript(dir, {
      language: "en",
      durationSec: 200,
      segments: Array.from({ length: 10 }, (_, i) => ({
        start: i * 20,
        end: (i + 1) * 20,
        text: `segment ${i} content here`,
      })),
    });

    let call = 0;
    const proposalContent = JSON.stringify({
      candidates: [
        {
          startSec: 0,
          endSec: 40,
          hookLine: "open strong",
          suggestedTitle: "Hot take",
          suggestedCaption: "watch",
          why: "punchy",
        },
      ],
    });
    const scoreContent = JSON.stringify({
      hook: 0.9,
      flow: 0.7,
      engagement: 0.8,
      trend: 0.6,
      why: "good",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        call++;
        const body = JSON.parse(init?.body ?? "{}") as {
          messages: Array<{ content: string }>;
        };
        const sys = body.messages[0]?.content ?? "";
        const isProposal = sys.includes("short-form-video selector");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: isProposal ? proposalContent : scoreContent } }],
          }),
          text: async () => "",
        } as unknown as Response;
      }),
    );

    const tool = createFindViralMomentsTool(dir);
    const r = await tool.execute(
      { transcript: "t.json", maxClips: 3, durationRange: [20, 60], scoreThreshold: 30 },
      ctx,
    );
    const parsed = JSON.parse(r as string);
    expect(parsed.candidates.length).toBeGreaterThan(0);
    expect(parsed.candidates[0].score).toBeGreaterThan(0);
    expect(parsed.candidates[0].suggestedTitle).toBe("Hot take");
    expect(call).toBeGreaterThan(1); // at least one proposal + one score
  });

  it("threshold drops low-scoring candidates", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-fvm-"));
    writeTranscript(dir, {
      language: "en",
      durationSec: 100,
      segments: [{ start: 0, end: 100, text: "a long discussion about taxes and forms" }],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? "{}") as {
          messages: Array<{ content: string }>;
        };
        const sys = body.messages[0]?.content ?? "";
        const isProposal = sys.includes("short-form-video selector");
        const content = isProposal
          ? JSON.stringify({
              candidates: [
                {
                  startSec: 0,
                  endSec: 30,
                  hookLine: "x",
                  suggestedTitle: "y",
                  suggestedCaption: "z",
                  why: "w",
                },
              ],
            })
          : JSON.stringify({ hook: 0.1, flow: 0.1, engagement: 0.1, trend: 0.1, why: "weak" });
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content } }] }),
          text: async () => "",
        } as unknown as Response;
      }),
    );

    const tool = createFindViralMomentsTool(dir);
    const r = await tool.execute(
      { transcript: "t.json", scoreThreshold: 90 },
      ctx,
    );
    const parsed = JSON.parse(r as string);
    expect(parsed.candidates).toEqual([]);
    expect(parsed.totalScored).toBeGreaterThan(0);
  });
});
