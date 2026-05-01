import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import type {
  ClipInfo,
  Frame,
  FrameRange,
  HostCapabilities,
  HostRuntime,
  MarkerInfo,
  TimelineState,
} from "../../../types.js";
import { PREMIERE_COLOR_INDEX, RESOLVE_TO_PREMIERE_INDEX } from "../../marker-colors.js";
import { HostUnsupportedError, type VideoHost } from "../types.js";
import { PremiereBridge, type PremiereTransportKind } from "./bridge.js";

/**
 * Translate the bridge's internal transport kind to the runtime label exposed
 * via HostCapabilities. Pure function — exported via the static helper for
 * unit testing.
 */
function mapTransportToRuntime(t: PremiereTransportKind): HostRuntime {
  switch (t) {
    case "http-uxp":
      return "uxp";
    case "http-cep":
      return "cep";
    case "osascript-cep":
      return "osascript";
  }
}

/** Inverse of PREMIERE_COLOR_INDEX — numeric index back to color name. */
const PREMIERE_INDEX_TO_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(PREMIERE_COLOR_INDEX).map(([name, idx]) => [idx, name]),
);

/**
 * Adobe Premiere Pro adapter.
 *
 * Drives Premiere via ExtendScript through `osascript` on macOS (see
 * ./bridge.ts). Each call generates a self-contained JSX file and asks
 * Premiere to evalFile it; the JSX writes a JSON result to a temp file.
 *
 * Requirements:
 *   - macOS (Windows path requires a CEP panel — deferred)
 *   - Premiere Pro running with a project + active sequence
 *
 * Capability map (verified against current Premiere Pro APIs):
 *   - canMoveClips: true (Premiere has direct timeline mutation)
 *   - canScriptColor: false (Lumetri preset application is limited)
 *   - canScriptAudio: true (track levels, mute, gain via TrackItem)
 *   - canTriggerAI: false (Speech-to-Text + Auto Reframe not exposed)
 *   - preferredImportFormat: xml (FCPXML)
 *
 * Unsupported via live API (use write_edl + import_timeline):
 *   - cut_at — QE DOM razor is undocumented and version-fragile
 *   - ripple_delete — same reason
 *   - render — requires Adobe Media Encoder integration; deferred
 */
export class PremiereAdapter implements VideoHost {
  readonly name = "premiere" as const;
  readonly displayName = "Adobe Premiere Pro";

  private bridge = new PremiereBridge();

  // Capabilities are re-checked on every call so a closed-Premiere session is
  // visible immediately to host_info instead of being masked by a stale cache.
  async capabilities(): Promise<HostCapabilities> {
    const reachable = await this.checkReachable();
    // Map our internal transport kind to a public runtime label, and attach a
    // deprecation notice for anything on the CEP/ExtendScript sunset path.
    const transport = this.bridge.getTransportKind();
    const runtime = transport ? mapTransportToRuntime(transport) : undefined;
    const deprecationNotice =
      runtime === "cep" || runtime === "osascript"
        ? "Adobe is removing CEP/ExtendScript support in September 2026. " +
          "Install the UXP panel for Premiere 25.6+: " +
          "`npx @kenkaiiii/gg-editor-premiere-panel install --uxp`."
        : undefined;

    return {
      canMoveClips: true,
      canScriptColor: false,
      canScriptAudio: true,
      canTriggerAI: false,
      preferredImportFormat: "xml",
      isAvailable: reachable.ok,
      unavailableReason: reachable.ok ? undefined : reachable.reason,
      ...(runtime ? { runtime } : {}),
      ...(deprecationNotice ? { deprecationNotice } : {}),
    };
  }

  async getTimeline(): Promise<TimelineState> {
    return this.bridge.call<TimelineState>("get_timeline");
  }

  async addMarker(marker: MarkerInfo): Promise<void> {
    // Snap any agent-supplied color (incl. Resolve-only hues) to Premiere's
    // native 8-name palette BEFORE sending to JSX. JSX's _markerColor only
    // recognises 8 names — anything else fell back to blue. Now we send the
    // hue-snapped equivalent (e.g. pink → red, mint → green) consistent
    // with the snap table the rest of the codebase uses.
    const color = snapColorToPremiere(marker.color);
    await this.bridge.call("add_marker", {
      frame: marker.frame,
      note: marker.note,
      color,
      durationFrames: marker.durationFrames ?? 1,
    });
  }

  async cutAt(_track: number, _frame: Frame): Promise<void> {
    throw new HostUnsupportedError(
      "premiere",
      "cutAt",
      "QE DOM razor exists but is undocumented and version-fragile. " +
        "Use write_edl + import_timeline for reliable bulk cuts.",
    );
  }

  async rippleDelete(_track: number, _range: FrameRange): Promise<void> {
    throw new HostUnsupportedError(
      "premiere",
      "rippleDelete",
      "Use write_edl + import_timeline for reliable bulk operations.",
    );
  }

  async appendClip(track: number, mediaPath: string): Promise<ClipInfo> {
    return this.bridge.call<ClipInfo>("append_clip", { track, mediaPath });
  }

  async importTimeline(filePath: string): Promise<void> {
    await this.bridge.call("import_timeline", { filePath });
  }

  async render(_opts: { preset: string; output: string }): Promise<void> {
    throw new HostUnsupportedError(
      "premiere",
      "render",
      "Premiere render via ExtendScript requires Adobe Media Encoder integration. " +
        "Use Premiere's File > Export menu manually for now.",
    );
  }

  async getMarkers(): Promise<MarkerInfo[]> {
    return this.bridge.call<MarkerInfo[]>("get_markers");
  }

  async createTimeline(opts: {
    name: string;
    fps: number;
    width?: number;
    height?: number;
  }): Promise<void> {
    // Premiere's createNewSequence requires a .sqpreset file. We pass through
    // the requested name; the JSX side falls back to cloning the active
    // sequence if no preset path is provided. fps/width/height are advisory
    // unless a matching preset exists on disk.
    void opts.fps;
    void opts.width;
    void opts.height;
    await this.bridge.call("create_timeline", { name: opts.name });
  }

  async importToMediaPool(paths: string[], bin?: string): Promise<void> {
    await this.bridge.call("import_to_media_pool", { paths, bin });
  }

  async setClipSpeed(_clipId: string, _speed: number): Promise<void> {
    throw new HostUnsupportedError(
      "premiere",
      "setClipSpeed",
      "Premiere's TrackItem has no scriptable setSpeed (QE DOM is undocumented). " +
        "Use write_fcpxml with explicit timeMap rates per clip, then import_edl.",
    );
  }

  async applyLut(_clipId: string, _lutPath: string, _nodeIndex?: number): Promise<void> {
    throw new HostUnsupportedError(
      "premiere",
      "applyLut",
      "Lumetri preset application via ExtendScript is limited; use Resolve for color or apply manually. apply_lut via Lumetri preset XML is deferred.",
    );
  }

  async setPrimaryCorrection(
    _clipId: string,
    _cdl: {
      slope?: [number, number, number];
      offset?: [number, number, number];
      power?: [number, number, number];
      saturation?: number;
      nodeIndex?: number;
    },
  ): Promise<void> {
    throw new HostUnsupportedError(
      "premiere",
      "setPrimaryCorrection",
      "Lumetri primary CDL is not exposed to ExtendScript; use Resolve for color or grade manually.",
    );
  }

  async copyGrade(_sourceClipId: string, _targetClipIds: string[]): Promise<void> {
    throw new HostUnsupportedError(
      "premiere",
      "copyGrade",
      "Lumetri attribute copy is not scriptable; use Resolve for color or copy/paste attributes manually.",
    );
  }

  async listRenderPresets(): Promise<string[]> {
    // Premiere render presets live in Adobe Media Encoder; not exposed to
    // ExtendScript without launching AME. Return the empty list with no error
    // so the agent gracefully falls back to common preset names.
    return [];
  }

  async replaceClip(clipId: string, mediaPath: string): Promise<void> {
    await this.bridge.call("replace_clip", { clipId, mediaPath });
  }

  async cloneTimeline(newName: string): Promise<{ name: string }> {
    return this.bridge.call<{ name: string }>("clone_timeline", { newName });
  }

  async saveProject(): Promise<void> {
    await this.bridge.call("save_project");
  }

  async addTrack(_kind: "video" | "audio" | "subtitle"): Promise<{ track: number }> {
    throw new HostUnsupportedError(
      "premiere",
      "addTrack",
      "Premiere's TrackCollection.add is not exposed via ExtendScript on all versions. " +
        "Use Sequence → Add Tracks manually, or rebuild via FCPXML with the desired track count.",
    );
  }

  // setClipVolume intentionally NOT implemented — Lumetri Audio gain isn't
  // reliably scriptable. Use Resolve for clip-level volume.

  async insertClipOnTrack(opts: {
    mediaPath: string;
    track: number;
    recordFrame: number;
    sourceInFrame?: number;
    sourceOutFrame?: number;
  }): Promise<ClipInfo> {
    return this.bridge.call<ClipInfo>("insert_clip_on_track", opts);
  }

  // smartReframe is intentionally NOT implemented — Premiere uses Auto Reframe
  // via the effects panel, not scriptable via ExtendScript.

  async importSubtitles(
    srtPath: string,
  ): Promise<{ imported: boolean; attached: boolean; note?: string }> {
    return this.bridge.call("import_subtitles", { srtPath });
  }

  // openPage is intentionally NOT implemented — Premiere has no page concept.
  // The agent should consult host_info.caps before calling it.

  async executeCode(code: string): Promise<{ result: unknown; stdout?: string }> {
    return this.bridge.call<{ result: unknown; stdout?: string }>("execute_code", { code });
  }

  shutdown(): void {
    this.bridge.shutdown();
  }

  // Exposed for unit testing.
  static _snapColorToPremiereForTest(color: unknown): string {
    return snapColorToPremiere(color);
  }

  // Exposed for unit testing.
  static _mapTransportToRuntimeForTest(t: PremiereTransportKind): HostRuntime {
    return mapTransportToRuntime(t);
  }

  // ── Private ────────────────────────────────────────────────

  private async checkReachable(): Promise<
    { ok: true; transport: PremiereTransportKind } | { ok: false; reason: string }
  > {
    const platformOk = await PremiereBridge.checkReachable();
    if (!platformOk.ok) return platformOk;

    if (platform() === "darwin") {
      // Even if the panel is reachable, sanity-check Premiere is running.
      const r = spawnSync(
        "osascript",
        [
          "-e",
          'tell application "System Events" to (name of processes) contains "Adobe Premiere Pro"',
        ],
        { encoding: "utf8" },
      );
      if (r.status === 0 && r.stdout.trim() === "true") {
        return { ok: true, transport: platformOk.transport };
      }
      return { ok: false, reason: "Premiere Pro is not running." };
    }
    return { ok: true, transport: platformOk.transport };
  }
}

/**
 * Resolve any agent-supplied marker color (string name OR numeric Premiere
 * index) to one of Premiere's 8 native color names that JSX `_markerColor`
 * recognises. Resolve-only hues snap via `RESOLVE_TO_PREMIERE_INDEX`.
 * Unknown / undefined inputs default to "blue".
 */
function snapColorToPremiere(input: unknown): string {
  if (typeof input === "number") {
    return PREMIERE_INDEX_TO_NAME[input] ?? "blue";
  }
  if (typeof input !== "string" || !input.trim()) return "blue";
  const idx = RESOLVE_TO_PREMIERE_INDEX[input.toLowerCase()];
  if (idx === undefined) return "blue";
  return PREMIERE_INDEX_TO_NAME[idx] ?? "blue";
}
