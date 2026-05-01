import type {
  ClipInfo,
  Frame,
  FrameRange,
  HostCapabilities,
  MarkerInfo,
  TimelineState,
} from "../../../types.js";
import { HostUnreachableError, HostUnsupportedError, type VideoHost } from "../types.js";

/**
 * Bypass adapter — no NLE attached.
 *
 * In this mode the agent does NOT manipulate a live host. Instead, it works
 * entirely against media files on disk via ffmpeg and emits an EDL/FCPXML
 * the user can import into any NLE later.
 *
 * All host ops throw HostUnsupportedError. The agent should rely on the
 * stand-alone tools (extract_audio, transcribe, write_edl, render_ffmpeg).
 */
export class NoneAdapter implements VideoHost {
  readonly name = "none" as const;
  readonly displayName = "No NLE (file-only mode)";

  async capabilities(): Promise<HostCapabilities> {
    return {
      canMoveClips: false,
      canScriptColor: false,
      canScriptAudio: false,
      canTriggerAI: false,
      preferredImportFormat: "edl",
      isAvailable: true,
      unavailableReason: undefined,
    };
  }

  async getTimeline(): Promise<TimelineState> {
    throw new HostUnsupportedError("none", "getTimeline");
  }
  async addMarker(_marker: MarkerInfo): Promise<void> {
    throw new HostUnsupportedError("none", "addMarker");
  }
  async cutAt(_track: number, _frame: Frame): Promise<void> {
    throw new HostUnsupportedError("none", "cutAt");
  }
  async rippleDelete(_track: number, _range: FrameRange): Promise<void> {
    throw new HostUnsupportedError("none", "rippleDelete");
  }
  async appendClip(_track: number, _mediaPath: string): Promise<ClipInfo> {
    throw new HostUnsupportedError("none", "appendClip");
  }
  async importTimeline(_filePath: string): Promise<void> {
    throw new HostUnsupportedError("none", "importTimeline");
  }
  async render(_opts: { preset: string; output: string }): Promise<void> {
    throw new HostUnsupportedError("none", "render");
  }
  async getMarkers(): Promise<MarkerInfo[]> {
    throw new HostUnreachableError("none", "No NLE attached — cannot read markers.");
  }
  async createTimeline(_opts: {
    name: string;
    fps: number;
    width?: number;
    height?: number;
  }): Promise<void> {
    throw new HostUnreachableError("none", "No NLE attached — cannot create timeline.");
  }
  async importToMediaPool(_paths: string[], _bin?: string): Promise<void> {
    throw new HostUnreachableError("none", "No NLE attached — nothing to import into.");
  }
  async setClipSpeed(_clipId: string, _speed: number): Promise<void> {
    throw new HostUnreachableError("none", "No NLE attached — cannot retime.");
  }
  async applyLut(_clipId: string, _lutPath: string, _nodeIndex?: number): Promise<void> {
    throw new HostUnreachableError("none", "No NLE attached — cannot apply LUT.");
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
    throw new HostUnreachableError("none", "No NLE attached — cannot grade.");
  }
  async copyGrade(_sourceClipId: string, _targetClipIds: string[]): Promise<void> {
    throw new HostUnreachableError("none", "No NLE attached — cannot copy grade.");
  }
  async listRenderPresets(): Promise<string[]> {
    return [];
  }
  async replaceClip(_clipId: string, _mediaPath: string): Promise<void> {
    throw new HostUnreachableError("none", "No NLE attached — cannot replace clip.");
  }
  async cloneTimeline(_newName: string): Promise<{ name: string }> {
    throw new HostUnreachableError("none", "No NLE attached — cannot clone timeline.");
  }
  async saveProject(): Promise<void> {
    throw new HostUnreachableError("none", "No NLE attached — nothing to save.");
  }
  async addTrack(_kind: "video" | "audio" | "subtitle"): Promise<{ track: number }> {
    throw new HostUnreachableError("none", "No NLE attached — cannot add track.");
  }
  async setClipVolume(_clipId: string, _volumeDb: number): Promise<void> {
    throw new HostUnreachableError("none", "No NLE attached — cannot set clip volume.");
  }
  async insertClipOnTrack(_opts: {
    mediaPath: string;
    track: number;
    recordFrame: number;
    sourceInFrame?: number;
    sourceOutFrame?: number;
  }): Promise<ClipInfo> {
    throw new HostUnreachableError("none", "No NLE attached — cannot insert clip.");
  }
  async smartReframe(
    _clipId: string,
    _opts: {
      aspect: "9:16" | "1:1" | "4:5" | "16:9" | "4:3";
      frameInterest?: "all" | "keyframes" | "reference-frame";
      referenceFrame?: number;
    },
  ): Promise<void> {
    throw new HostUnreachableError("none", "No NLE attached — cannot Smart Reframe.");
  }
  async importSubtitles(
    _srtPath: string,
  ): Promise<{ imported: boolean; attached: boolean; note?: string }> {
    throw new HostUnreachableError("none", "No NLE attached — cannot import subtitles.");
  }
  async openPage(
    _name: "media" | "cut" | "edit" | "fusion" | "color" | "fairlight" | "deliver",
  ): Promise<void> {
    throw new HostUnreachableError("none", "No NLE attached — no page concept.");
  }
}
