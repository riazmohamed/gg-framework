import { describe, expect, it } from "vitest";
import { createVerifyThumbnailPromiseTool, sampleTimes } from "./verify-thumbnail-promise.js";

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<
  ReturnType<typeof createVerifyThumbnailPromiseTool>["execute"]
>[1];

describe("sampleTimes", () => {
  it("returns single sample at 0 when n=1", () => {
    expect(sampleTimes(60, 1)).toEqual([0]);
  });

  it("returns endpoints when n=2", () => {
    expect(sampleTimes(60, 2)).toEqual([0, 60]);
  });

  it("returns 0/mid/end when n=3", () => {
    expect(sampleTimes(60, 3)).toEqual([0, 30, 60]);
  });

  it("evenly distributes for n=5", () => {
    const t = sampleTimes(40, 5);
    expect(t).toHaveLength(5);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(40);
  });
});

describe("verify_thumbnail_promise tool", () => {
  it("description names front-load + matches + always-run + algorithm pairing", () => {
    const tool = createVerifyThumbnailPromiseTool("/tmp");
    expect(tool.description).toMatch(/front-load|MrBeast/);
    expect(tool.description).toMatch(/ALWAYS|matches/);
    expect(tool.description).toMatch(/audit_first_frame|analyze_hook/);
  });

  it("errors when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const tool = createVerifyThumbnailPromiseTool("/tmp");
    const r = await tool.execute(
      { thumbnail: "t.jpg", video: "v.mp4" },
      ctx,
    );
    expect(r as string).toMatch(/error/);
  });
});
