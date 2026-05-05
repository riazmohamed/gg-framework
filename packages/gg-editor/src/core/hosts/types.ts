import type {
  ClipInfo,
  Frame,
  FrameRange,
  HostCapabilities,
  HostName,
  MarkerInfo,
  TimelineState,
} from "../../types.js";

/**
 * Discriminated union of every fusion_comp action the bridge supports. Kept
 * in lockstep with `m_fusion_comp` in bridge-source.ts.
 */
export type FusionCompArgs =
  | { action: "list_nodes"; clipId?: string }
  | { action: "add_node"; toolId: string; name?: string; clipId?: string }
  | { action: "delete_node"; name: string; clipId?: string }
  | {
      action: "connect";
      fromNode: string;
      toNode: string;
      fromOutput?: string;
      toInput?: string;
      clipId?: string;
    }
  | { action: "set_input"; node: string; input: string; value: unknown; clipId?: string }
  | { action: "get_input"; node: string; input: string; clipId?: string }
  | {
      action: "set_keyframe";
      node: string;
      input: string;
      frame: number;
      value: unknown;
      clipId?: string;
    }
  | { action: "set_render_range"; start: number; end: number; clipId?: string };

/**
 * VideoHost — the NLE-agnostic interface every adapter implements.
 *
 * The agent only ever sees these methods. The adapter is responsible for
 * picking the fastest tier (API → hotkey → GUI fallback) for each op,
 * and surfacing capability differences via `capabilities`.
 */
export interface VideoHost {
  readonly name: HostName;
  readonly displayName: string;

  /** Read host capabilities. Cached after first call. */
  capabilities(): Promise<HostCapabilities>;

  /** Read the current timeline state (clips, markers, framerate). */
  getTimeline(): Promise<TimelineState>;

  /** Add a marker on the timeline at a specific frame. */
  addMarker(marker: MarkerInfo): Promise<void>;

  /** Cut (razor) at the given frame on the given track. */
  cutAt(track: number, frame: Frame): Promise<void>;

  /** Ripple-delete a frame range (closes the gap). */
  rippleDelete(track: number, range: FrameRange): Promise<void>;

  /** Append a media clip to the end of a track. Returns the new clip info. */
  appendClip(track: number, mediaPath: string): Promise<ClipInfo>;

  /**
   * Import an EDL/FCPXML/AAF file. Use this when bulk timeline mutation is
   * faster than per-op calls (e.g. rebuilding from a 200-cut decision list).
   */
  importTimeline(filePath: string): Promise<void>;

  /** Render the current timeline. `preset` is a host-specific preset name. */
  render(opts: { preset: string; output: string }): Promise<void>;

  /** List available render presets the host knows about. */
  listRenderPresets(): Promise<string[]>;

  /**
   * Replace a clip's underlying media reference. Used to swap a draft asset
   * for an updated render (lower-thirds, animations, B-roll renders) without
   * destroying the in/out timing or any grade applied to the clip.
   */
  replaceClip(clipId: string, mediaPath: string): Promise<void>;

  /**
   * Duplicate the active timeline / sequence under a new name. Used as a
   * safety net BEFORE destructive ops (import_edl, render). On success the
   * cloned timeline becomes the active one (Resolve) or is opened alongside
   * (Premiere best-effort).
   */
  cloneTimeline(newName: string): Promise<{ name: string }>;

  /** Save the current project. Resolve uses ProjectManager.SaveProject(); Premiere uses app.project.save(). */
  saveProject(): Promise<void>;

  /**
   * Add a new empty track to the active timeline. `kind` is the track type;
   * adapters that don't support a kind throw HostUnsupportedError.
   */
  addTrack(kind: "video" | "audio" | "subtitle"): Promise<{ track: number }>;

  /**
   * Set a clip's audio gain in dB. 0 = unchanged, -6 = quieter, +3 = louder.
   * Resolve only — Premiere requires Lumetri-adjacent rigging that's not exposed
   * to ExtendScript reliably.
   */
  setClipVolume?(clipId: string, volumeDb: number): Promise<void>;

  /**
   * Insert a clip onto a specific track at a specific timeline frame range.
   * Used for B-roll over A-roll — the agent places cutaways above the main
   * video on a higher track without disturbing it.
   *
   * Resolve: uses MediaPool.AppendToTimeline with a clipInfo dict including
   *   recordFrame + trackIndex.
   * Premiere: uses videoTracks[i].insertClip(item, recordSec).
   */
  insertClipOnTrack(opts: {
    mediaPath: string;
    track: number;
    recordFrame: number;
    sourceInFrame?: number;
    sourceOutFrame?: number;
    /**
     * Default "video" for back-compat. Pass "audio" to place a clip on an
     * audio track instead — used by `add_sfx_to_timeline` to drop SFX wavs
     * directly onto a free Fairlight/audio track without rendering.
     */
    mediaKind?: "video" | "audio";
  }): Promise<ClipInfo>;

  /**
   * Trigger Resolve Studio's Smart Reframe AI on a clip. Resolve only.
   * Aspect: "9:16" / "1:1" / "4:5" / "16:9" / "4:3".
   * Frame interest: "all" (every keyframe), "keyframes" (existing keyframes),
   * or "reference-frame" (a specified frame).
   */
  smartReframe?(
    clipId: string,
    opts: {
      aspect: "9:16" | "1:1" | "4:5" | "16:9" | "4:3";
      frameInterest?: "all" | "keyframes" | "reference-frame";
      referenceFrame?: number;
    },
  ): Promise<void>;

  /** Read existing markers from the active timeline. */
  getMarkers(): Promise<MarkerInfo[]>;

  /**
   * Create a new (empty) timeline / sequence on the host.
   * Resolve: media_pool.CreateEmptyTimeline + frame-rate / resolution settings.
   * Premiere: app.project.createNewSequence using a preset (best-effort).
   */
  createTimeline(opts: {
    name: string;
    fps: number;
    width?: number;
    height?: number;
  }): Promise<void>;

  /** Import media files into the project's media pool / project bins (no append). */
  importToMediaPool(paths: string[], bin?: string): Promise<void>;

  /** Retime a clip on the active timeline. `speed` is a multiplier (1 = 100%, 0.5 = slow-mo, 2 = fast). */
  setClipSpeed(clipId: string, speed: number): Promise<void>;

  /**
   * Apply a LUT to a clip's grading node. Resolve only — Premiere's Lumetri
   * presets are not scriptable. nodeIndex is 1-based; node 1 always exists.
   */
  applyLut(clipId: string, lutPath: string, nodeIndex?: number): Promise<void>;

  /**
   * Apply a primary CDL correction (slope/offset/power/saturation) to a clip.
   * Resolve only. Cannot create nodes, touch wheels, curves, or qualifiers —
   * what we expose is what's actually scriptable.
   */
  setPrimaryCorrection(
    clipId: string,
    cdl: {
      slope?: [number, number, number];
      offset?: [number, number, number];
      power?: [number, number, number];
      saturation?: number;
      nodeIndex?: number;
    },
  ): Promise<void>;

  /**
   * Copy the current grade from a source clip to one or more target clips.
   * Resolve only. The Color page may need to be open for the copy to take
   * effect — call openPage('color') first if it errors.
   */
  copyGrade(sourceClipId: string, targetClipIds: string[]): Promise<void>;

  /**
   * Import an SRT subtitle file and attach it to the active timeline.
   * Returns a result describing whether the host auto-attached the SRT to a
   * subtitle/captions track, plus an optional human-readable note for the
   * agent to surface (e.g. Premiere requires manual drag-onto-track).
   */
  importSubtitles(srtPath: string): Promise<{
    imported: boolean;
    attached: boolean;
    note?: string;
  }>;

  /**
   * Switch the host UI to a workspace page. Resolve only — Premiere does not
   * have a page concept. Adapters that don't support it should omit this method.
   */
  openPage?(
    name: "media" | "cut" | "edit" | "fusion" | "color" | "fairlight" | "deliver",
  ): Promise<void>;

  /**
   * Drive a Fusion composition (motion-graphics graph) inside Resolve.
   * Optional; Resolve-only — adapters without a Fusion equivalent omit it.
   *
   * `clipId` (optional): scope the call to that clip's first Fusion comp
   * (or auto-create one). When omitted, operates on the active Fusion-page
   * comp.
   *
   * Actions are dispatched server-side; see `bridge-source.ts:m_fusion_comp`
   * for the canonical action set.
   */
  executeFusionComp?(args: FusionCompArgs): Promise<unknown>;

  /**
   * Escape hatch — run a snippet of host-native scripting code with the live
   * NLE objects pre-bound and return its result + captured stdout. Optional;
   * only adapters with a real scripting bridge implement it (Resolve = Python,
   * Premiere = ExtendScript). The `none` adapter omits it.
   *
   * Usage rule (enforced by the tool's system-prompt guidance, not the type):
   * this is for things no named tool covers. Don't use it to do work the
   * dedicated tools already do — those tools have validation, output shaping,
   * and capability fallbacks this raw path skips.
   *
   * Resolve pre-bound globals: resolve, project, projectManager, mediaPool,
   * mediaStorage, timeline, fusion, dvr; result via `set_result(value)` or
   * top-level `result =`.
   *
   * Premiere pre-bound globals: app, project, sequence, qe; result via
   * `setResult(value)` or top-level `result = `.
   */
  executeCode?(code: string): Promise<{ result: unknown; stdout?: string }>;
}

/**
 * Thrown by adapters when an op is not supported by the live host API.
 * The agent can catch this and fall back (e.g. emit an EDL instead).
 */
export class HostUnsupportedError extends Error {
  constructor(
    public readonly host: HostName,
    public readonly op: string,
    message?: string,
  ) {
    super(message ?? `Host '${host}' does not support op '${op}' via the live API.`);
    this.name = "HostUnsupportedError";
  }
}

/**
 * Thrown when the host is detected but its scripting bridge is unreachable
 * (e.g. Resolve free version, Premiere with no panel installed).
 */
export class HostUnreachableError extends Error {
  constructor(
    public readonly host: HostName,
    message: string,
  ) {
    super(message);
    this.name = "HostUnreachableError";
  }
}
