import { describe, expect, it } from "vitest";
import { NoneAdapter } from "../core/hosts/none/adapter.js";
import { ResolveAdapter } from "../core/hosts/resolve/adapter.js";
import { createAddMarkerTool } from "./add-marker.js";
import { createAppendClipTool } from "./append-clip.js";
import { createCreateTimelineTool } from "./create-timeline.js";
import { createCutAtTool } from "./cut-at.js";
import { createGetMarkersTool } from "./get-markers.js";
import { createGetTimelineTool } from "./get-timeline.js";
import { createImportEdlTool } from "./import-edl.js";
import { createImportSubtitlesTool } from "./import-subtitles.js";
import { createImportToMediaPoolTool } from "./import-to-media-pool.js";
import { createOpenPageTool } from "./open-page.js";
import { createRippleDeleteTool } from "./ripple-delete.js";
import { createFusionCompTool } from "./fusion-comp.js";
import { createHostEvalTool } from "./host-eval.js";
import { createSetClipSpeedTool } from "./set-clip-speed.js";

/**
 * Smoke tests for the host-mutation tool wrappers. NoneAdapter rejects with
 * HostUnsupportedError or HostUnreachableError, which the tool wrappers must
 * format as `error: ...` strings (never let raw exceptions escape).
 */

const ctx = {
  signal: new AbortController().signal,
  toolCallId: "t1",
} as unknown as Parameters<ReturnType<typeof createAddMarkerTool>["execute"]>[1];

describe("host-mutation tool wrappers — error formatting against NoneAdapter", () => {
  it("add_marker returns 'error:' on unreachable host", async () => {
    const r = await createAddMarkerTool(new NoneAdapter()).execute({ frame: 0, note: "x" }, ctx);
    expect(typeof r).toBe("string");
    expect(r).toMatch(/^error:/);
  });

  it("cut_at returns 'error:' with EDL fallback hint", async () => {
    const r = await createCutAtTool(new NoneAdapter()).execute({ track: 1, frame: 30 }, ctx);
    expect(r).toMatch(/^error:/);
    expect(r).toMatch(/write_edl/);
  });

  it("ripple_delete validates endFrame > startFrame BEFORE calling host", async () => {
    const r = await createRippleDeleteTool(new NoneAdapter()).execute(
      { track: 1, startFrame: 100, endFrame: 50 },
      ctx,
    );
    expect(r).toMatch(/endFrame must be > startFrame/);
  });

  it("ripple_delete returns 'error:' with EDL hint on unsupported host", async () => {
    const r = await createRippleDeleteTool(new NoneAdapter()).execute(
      { track: 1, startFrame: 0, endFrame: 30 },
      ctx,
    );
    expect(r).toMatch(/^error:/);
    expect(r).toMatch(/write_edl/);
  });

  it("append_clip returns 'error:' on unreachable host", async () => {
    const r = await createAppendClipTool(new NoneAdapter(), "/tmp").execute(
      { track: 1, mediaPath: "x.mp4" },
      ctx,
    );
    expect(r).toMatch(/^error:/);
  });

  it("set_clip_speed returns 'error:' on unsupported host", async () => {
    const r = await createSetClipSpeedTool(new NoneAdapter()).execute(
      { clipId: "x", speed: 1.5 },
      ctx,
    );
    expect(r).toMatch(/^error:/);
  });

  it("get_timeline returns 'error:' on unreachable host", async () => {
    const r = await createGetTimelineTool(new NoneAdapter()).execute({}, ctx);
    expect(r).toMatch(/^error:/);
  });

  it("get_markers returns 'error:' on unreachable host", async () => {
    const r = await createGetMarkersTool(new NoneAdapter()).execute({}, ctx);
    expect(r).toMatch(/^error:/);
  });

  it("create_timeline returns 'error:' on unreachable host", async () => {
    const r = await createCreateTimelineTool(new NoneAdapter()).execute(
      { name: "Test", fps: 30 },
      ctx,
    );
    expect(r).toMatch(/^error:/);
  });

  it("import_to_media_pool returns 'error:' on unreachable host", async () => {
    const r = await createImportToMediaPoolTool(new NoneAdapter(), "/tmp").execute(
      { paths: ["a.mov"] },
      ctx,
    );
    expect(r).toMatch(/^error:/);
  });

  it("open_page returns 'error:' on hosts without page concept", async () => {
    const r = await createOpenPageTool(new NoneAdapter()).execute({ name: "edit" }, ctx);
    expect(typeof r).toBe("string");
    // NoneAdapter exposes openPage but it throws — the tool surfaces an error string.
    expect(r).toMatch(/^error:/);
  });

  it("import_subtitles returns 'error:' on unreachable host", async () => {
    const r = await createImportSubtitlesTool(new NoneAdapter(), "/tmp").execute(
      { srtPath: "x.srt" },
      ctx,
    );
    expect(r).toMatch(/^error:/);
  });

  it("import_edl returns 'error:' on unreachable host", async () => {
    const r = await createImportEdlTool(new NoneAdapter(), "/tmp").execute(
      { filePath: "x.edl" },
      ctx,
    );
    expect(r).toMatch(/^error:/);
  });

  it("fusion_comp returns 'error: not_supported' on hosts without Fusion", async () => {
    const r = await createFusionCompTool(new NoneAdapter()).execute({ action: "list_nodes" }, ctx);
    expect(typeof r).toBe("string");
    expect(r).toMatch(/^error: not_supported/);
  });

  it("host_eval returns 'error: not_supported' when host has no scripting bridge", async () => {
    // NoneAdapter has no executeCode method — the tool must fail closed
    // with a clear not_supported error rather than throw.
    const r = await createHostEvalTool(new NoneAdapter()).execute({ code: "set_result(1)" }, ctx);
    expect(typeof r).toBe("string");
    expect(r).toMatch(/^error: not_supported/);
    // Should hint at the fix.
    expect(r).toMatch(/Open Resolve or Premiere/);
  });
});

describe("capability cache invalidation", () => {
  it("ResolveAdapter.capabilities() does not return a cached object across calls", async () => {
    // The previous design cached `cachedCapabilities` once, so a closed-Resolve
    // session looked permanently available. We dropped the cache; now each call
    // produces a fresh object reflecting the latest reachability check.
    const adapter = new ResolveAdapter();
    const a = await adapter.capabilities();
    const b = await adapter.capabilities();
    expect(a).not.toBe(b); // distinct objects
    expect(a.canScriptColor).toBe(b.canScriptColor); // values still consistent
  });

  it("ResolveAdapter.capabilities() reflects post-shutdown reachability without restart", async () => {
    // shutdown() kills the bridge. The next capabilities() call must produce
    // an answer based on a fresh env-check, not on a cached snapshot taken
    // before shutdown.
    const adapter = new ResolveAdapter();
    const before = await adapter.capabilities();
    adapter.shutdown();
    const after = await adapter.capabilities();
    // Whatever the env says now, the second call must have re-evaluated it.
    expect(typeof after.isAvailable).toBe("boolean");
    // Same shape, fresh object.
    expect(after).not.toBe(before);
  });
});
