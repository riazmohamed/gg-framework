import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuditRetentionStructureTool } from "./audit-retention-structure.js";

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<
  ReturnType<typeof createAuditRetentionStructureTool>["execute"]
>[1];

function writeTranscript(dir: string, payload: unknown): string {
  const p = join(dir, "t.json");
  writeFileSync(p, JSON.stringify(payload), "utf8");
  return p;
}

describe("audit_retention_structure tool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("description names MrBeast + checkpoints + the algorithm-primer pairing", () => {
    const tool = createAuditRetentionStructureTool("/tmp");
    expect(tool.description).toMatch(/MrBeast|3-min|checkpoint/);
    expect(tool.description).toMatch(/youtube-algorithm-primer/);
    expect(tool.description).toMatch(/weakestCheckpoint|b-roll|punch-in/);
  });

  it("errors when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const tool = createAuditRetentionStructureTool("/tmp");
    const r = await tool.execute({ transcript: "x.json" }, ctx);
    expect(r as string).toMatch(/^error:.*OPENAI_API_KEY/);
  });

  it("errors on missing transcript file", async () => {
    process.env.OPENAI_API_KEY = "k";
    const tool = createAuditRetentionStructureTool("/tmp");
    const r = await tool.execute({ transcript: "no/such.json" }, ctx);
    expect(r as string).toMatch(/^error:.*cannot read/);
  });

  it("errors on transcript with no segments", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-ars-"));
    writeTranscript(dir, { language: "en", durationSec: 600, segments: [] });
    const tool = createAuditRetentionStructureTool(dir);
    const r = await tool.execute({ transcript: "t.json" }, ctx);
    expect(r as string).toMatch(/no segments/);
  });

  it("returns parseable JSON with default checkpoints", async () => {
    process.env.OPENAI_API_KEY = "k";
    const dir = mkdtempSync(join(tmpdir(), "gg-ars-"));
    writeTranscript(dir, {
      language: "en",
      durationSec: 600,
      segments: Array.from({ length: 30 }, (_, i) => ({
        start: i * 20,
        end: (i + 1) * 20,
        text: `segment ${i}`,
      })),
    });
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        captured = JSON.parse(init?.body ?? "{}");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    checkpoints: [
                      { atSec: 180, score: 0.3, summary: "flat", suggestion: "add b-roll" },
                      { atSec: 360, score: 0.8, summary: "twist", suggestion: "" },
                    ],
                    escalationScore: 0.6,
                    overallSummary: "decent build",
                  }),
                },
              },
            ],
          }),
          text: async () => "",
        } as unknown as Response;
      }),
    );
    const tool = createAuditRetentionStructureTool(dir);
    const r = await tool.execute({ transcript: "t.json" }, ctx);
    const parsed = JSON.parse(r as string);
    expect(parsed.checkpoints).toHaveLength(2);
    expect(parsed.weakestCheckpoint).toBe(180);
    expect(parsed.escalationScore).toBeCloseTo(0.6);
    expect(captured?.response_format).toEqual({ type: "json_object" });
    expect(captured?.temperature).toBe(0);
  });
});
