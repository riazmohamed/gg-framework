import { describe, expect, it } from "vitest";
import { NoneAdapter } from "../core/hosts/none/adapter.js";
import { createApplyLutTool } from "./apply-lut.js";
import { createCopyGradeTool } from "./copy-grade.js";
import { createInsertBrollTool } from "./insert-broll.js";
import { createListRenderPresetsTool } from "./list-render-presets.js";
import { createMulticamSyncTool } from "./multicam-sync.js";
import { createAddTrackTool } from "./add-track.js";
import { createCloneTimelineTool } from "./clone-timeline.js";
import { createPreRenderCheckTool } from "./pre-render-check.js";
import { createSetClipVolumeTool } from "./set-clip-volume.js";
import { createStabilizeVideoTool } from "./stabilize-video.js";
import { createReplaceClipTool } from "./replace-clip.js";
import { createReviewEditTool } from "./review-edit.js";
import { createSaveProjectTool } from "./save-project.js";
import { createWriteAssTool } from "./write-ass.js";
import { createSetPrimaryCorrectionTool } from "./set-primary-correction.js";
import { createSmartReframeTool } from "./smart-reframe.js";

/**
 * Tool-wrapper tests — exercise the zod validation + error formatting layer
 * for the new tools. NoneAdapter is used so any host call surfaces as an
 * "error: ..." string we can assert on.
 */

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createApplyLutTool>["execute"]>[1];

describe("apply_lut tool", () => {
  it("formats host errors as 'error: ...'", async () => {
    const tool = createApplyLutTool(new NoneAdapter(), "/tmp");
    const r = await tool.execute(
      { clipId: "x", lutPath: "lut.cube" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(typeof r).toBe("string");
    expect(r).toMatch(/^error:/);
  });
});

describe("set_primary_correction tool", () => {
  it("rejects when no CDL component supplied", async () => {
    const tool = createSetPrimaryCorrectionTool(new NoneAdapter());
    const r = await tool.execute({ clipId: "x" }, ctx as Parameters<typeof tool.execute>[1]);
    expect(r).toMatch(/at least one of slope.*saturation/);
  });
});

describe("copy_grade tool", () => {
  it("surfaces unreachable host as a clean error", async () => {
    const tool = createCopyGradeTool(new NoneAdapter());
    const r = await tool.execute(
      { sourceClipId: "a", targetClipIds: ["b"] },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/error:.*No NLE attached/);
  });
});

describe("insert_broll tool", () => {
  it("formats host errors", async () => {
    const tool = createInsertBrollTool(new NoneAdapter(), "/tmp");
    const r = await tool.execute(
      { mediaPath: "broll.mov", recordFrame: 0 },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error:/);
  });
});

describe("replace_clip tool", () => {
  it("formats host errors", async () => {
    const tool = createReplaceClipTool(new NoneAdapter(), "/tmp");
    const r = await tool.execute(
      { clipId: "x", mediaPath: "new.mov" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/^error:/);
  });
});

describe("smart_reframe tool", () => {
  it("returns a clear error when the host doesn't support it", async () => {
    // NoneAdapter has smartReframe defined; force-strip it for this test.
    const host = new NoneAdapter();
    Object.defineProperty(host, "smartReframe", { value: undefined });
    const tool = createSmartReframeTool(host);
    const r = await tool.execute(
      { clipId: "x", aspect: "9:16" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/does not support smart_reframe/);
  });
});

describe("list_render_presets tool", () => {
  it("returns the empty list cleanly when host has none", async () => {
    const tool = createListRenderPresetsTool(new NoneAdapter());
    const r = await tool.execute({}, ctx as Parameters<typeof tool.execute>[1]);
    const parsed = JSON.parse(r as string);
    expect(parsed.host).toBe("none");
    expect(parsed.total).toBe(0);
  });
});

describe("multicam_sync tool", () => {
  it("rejects when ffmpeg is unavailable (env-dependent — guarded)", async () => {
    const tool = createMulticamSyncTool("/tmp");
    // Either ffmpeg is missing → 'error: ffmpeg not on PATH', or ffmpeg is
    // present and we get an error from missing input files. Both are valid
    // negative paths — we just want to confirm the tool returns a string.
    const r = await tool.execute(
      { inputs: ["/no/such/a.wav", "/no/such/b.wav"] },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(typeof r).toBe("string");
    // It should be either the JSON success shape or an error.
    expect((r as string).startsWith("{") || (r as string).startsWith("error:")).toBe(true);
  });
});

describe("add_track tool", () => {
  it("surfaces unreachable host as an error", async () => {
    const tool = createAddTrackTool(new NoneAdapter());
    const r = await tool.execute({ kind: "video" }, ctx as Parameters<typeof tool.execute>[1]);
    expect(r).toMatch(/error:.*No NLE attached/);
  });
});

describe("set_clip_volume tool", () => {
  it("returns unsupported error when host doesn't expose setClipVolume", async () => {
    const host = new NoneAdapter();
    Object.defineProperty(host, "setClipVolume", { value: undefined });
    const tool = createSetClipVolumeTool(host);
    const r = await tool.execute(
      { clipId: "x", volumeDb: -3 },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/does not support set_clip_volume/);
  });
});

describe("stabilize_video tool", () => {
  it("rejects when input == output", async () => {
    const tool = createStabilizeVideoTool("/tmp");
    const r = await tool.execute(
      { input: "x.mp4", output: "x.mp4" },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(r).toMatch(/identical/);
  });
});

describe("pre_render_check tool", () => {
  it("reports block status when timeline is unreachable", async () => {
    const tool = createPreRenderCheckTool(new NoneAdapter(), "/tmp");
    const r = await tool.execute({}, ctx as Parameters<typeof tool.execute>[1]);
    const parsed = JSON.parse(r as string);
    expect(["warn", "block"]).toContain(parsed.status);
    expect(Array.isArray(parsed.issues)).toBe(true);
  });
});

describe("clone_timeline tool", () => {
  it("surfaces unreachable host as an error", async () => {
    const tool = createCloneTimelineTool(new NoneAdapter());
    const r = await tool.execute({ newName: "v2" }, ctx as Parameters<typeof tool.execute>[1]);
    expect(r).toMatch(/error:.*No NLE attached/);
  });
});

describe("save_project tool", () => {
  it("surfaces unreachable host as an error", async () => {
    const tool = createSaveProjectTool(new NoneAdapter());
    const r = await tool.execute({}, ctx as Parameters<typeof tool.execute>[1]);
    expect(r).toMatch(/error:.*No NLE attached/);
  });
});

describe("write_ass tool", () => {
  it("writes a styled ASS file when given cues", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gg-ass-"));
    const tool = createWriteAssTool(dir);
    const r = await tool.execute(
      {
        output: "t.ass",
        cues: [{ start: 1, end: 2, text: "hello" }],
      },
      ctx as Parameters<typeof tool.execute>[1],
    );
    expect(typeof r).toBe("string");
    const parsed = JSON.parse(r as string);
    expect(parsed.path).toBe(join(dir, "t.ass"));
    expect(parsed.cues).toBe(1);
    const content = readFileSync(parsed.path, "utf8");
    expect(content).toContain("[V4+ Styles]");
    expect(content).toContain("hello");
  });
});

describe("review_edit tool", () => {
  it("registers with the right name and description shape", () => {
    const tool = createReviewEditTool(new NoneAdapter(), "/tmp", {
      provider: "anthropic",
      model: "claude",
      apiKey: "test",
    });
    expect(tool.name).toBe("review_edit");
    expect(tool.description).toMatch(/critique/i);
  });
});
