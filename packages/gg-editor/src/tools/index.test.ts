import { describe, expect, it } from "vitest";
import { NoneAdapter } from "../core/hosts/none/adapter.js";
import { createEditorTools } from "./index.js";

/**
 * Smoke test for the tool registry. Catches accidental dropouts when adding
 * or renaming tools — every tool must appear in the registry exactly once.
 */

const EXPECTED_TOOLS = [
  // Host introspection
  "host_info",
  // Timeline state
  "get_timeline",
  "get_markers",
  // Per-clip mutation
  "cut_at",
  "ripple_delete",
  "add_marker",
  "append_clip",
  "set_clip_speed",
  "set_clip_volume",
  "replace_clip",
  "insert_broll",
  // Project / timeline / media-pool setup
  "create_timeline",
  "clone_timeline",
  "save_project",
  "add_track",
  "import_to_media_pool",
  "open_page",
  // Bulk timeline
  "write_edl",
  "write_fcpxml",
  "import_edl",
  "reformat_timeline",
  "render",
  "list_render_presets",
  "smart_reframe",
  "pre_render_check",
  "reorder_timeline",
  "compose_layered",
  // Captions / subtitles
  "write_srt",
  "write_ass",
  "import_subtitles",
  // Color
  "apply_lut",
  "set_primary_correction",
  "copy_grade",
  "color_match",
  "grade_skin_tones",
  "match_clip_color",
  // Audio cleanup + loudness
  "measure_loudness",
  "normalize_loudness",
  "clean_audio",
  "duck_audio",
  "mix_audio",
  // Frame extraction
  "extract_frame",
  // Stabilization
  "stabilize_video",
  // Post-production / delivery
  "burn_subtitles",
  "concat_videos",
  "add_fades",
  "crossfade_videos",
  "transition_videos",
  "generate_gif",
  "overlay_watermark",
  "compose_thumbnail",
  "speed_ramp",
  "ken_burns",
  "write_lower_third",
  "write_title_card",
  // Host-independent media
  "probe_media",
  "extract_audio",
  "detect_silence",
  "transcribe",
  "read_transcript",
  "cluster_takes",
  "score_shot",
  "pick_best_takes",
  "multicam_sync",
  "detect_speaker_changes",
  // Retention-tuning ops (the YouTube / TikTok / Reels pipeline)
  "cut_filler_words",
  "punch_in",
  "analyze_hook",
  "write_keyword_captions",
  "add_sfx_at_cuts",
  // Skills
  "read_skill",
];

describe("createEditorTools", () => {
  it("registers every expected tool exactly once", () => {
    const host = new NoneAdapter();
    const tools = createEditorTools({ host, cwd: process.cwd() });
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    expect(names.length).toBe(new Set(names).size);
  });

  it("registers review_edit only when reviewConfig is supplied", () => {
    const host = new NoneAdapter();
    const without = createEditorTools({ host, cwd: process.cwd() });
    expect(without.find((t) => t.name === "review_edit")).toBeUndefined();
    const withCfg = createEditorTools({
      host,
      cwd: process.cwd(),
      reviewConfig: {
        provider: "anthropic",
        model: "claude",
        apiKey: "test",
      },
    });
    expect(withCfg.find((t) => t.name === "review_edit")).toBeDefined();
  });

  it("read_skill knows about the bundled skills", async () => {
    const host = new NoneAdapter();
    const tools = createEditorTools({ host, cwd: process.cwd() });
    const readSkill = tools.find((t) => t.name === "read_skill")!;
    const ctx = { signal: new AbortController().signal, toolCallId: "t1" };
    const r = await readSkill.execute(
      { name: "long-form-content-edit" },
      ctx as unknown as Parameters<typeof readSkill.execute>[1],
    );
    expect(typeof r).toBe("string");
    expect((r as string).startsWith("# long-form-content-edit")).toBe(true);
  });
});
