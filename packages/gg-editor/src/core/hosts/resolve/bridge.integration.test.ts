import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findPython, ResolveBridge } from "./bridge.js";

/**
 * End-to-end test of the bridge wire protocol.
 *
 * We don't have DaVinci Resolve installed in CI, so we stub the
 * `DaVinciResolveScript` Python module with a fake that returns a minimal
 * mock Resolve object. Every JSON-RPC method should still work (ping,
 * get_timeline, add_marker, append_clip, import_timeline, render).
 *
 * Skipped when Python 3 is not available.
 */

const py = findPython();
const skipReason = py ? null : "Python 3 not on PATH; skipping integration test.";

describe.skipIf(skipReason)("ResolveBridge (integration with fake Resolve)", () => {
  let fakeModulesDir: string;
  let originalApiPath: string | undefined;
  let originalLibPath: string | undefined;
  let originalPyPath: string | undefined;

  beforeAll(() => {
    // Create a fake DaVinciResolveScript module that mimics just enough of
    // the real API for the bridge methods to succeed.
    fakeModulesDir = mkdtempSync(join(tmpdir(), "gg-editor-fakeres-"));
    writeFileSync(
      join(fakeModulesDir, "DaVinciResolveScript.py"),
      String.raw`
class _Item:
    def __init__(self, name, start, end):
        self._name, self._start, self._end = name, start, end
        self.lut = None
        self.cdl = None
        self.copied_to = None
        self.props = {}
    def GetUniqueId(self): return f"id-{self._name}"
    def GetName(self): return self._name
    def GetStart(self): return self._start
    def GetEnd(self): return self._end
    def SetLUT(self, idx, path):
        self.lut = (idx, path)
        return True
    def SetCDL(self, cdl):
        self.cdl = dict(cdl)
        return True
    def CopyGrades(self, targets):
        self.copied_to = list(targets)
        return True
    def SetClipProperty(self, k, v):
        self.props[k] = v
        return True
    def ReplaceClip(self, path):
        self._replaced = path
        return True
    def SmartReframe(self, *args):
        self._reframed = args
        return True

_TIMELINE_ITEMS = [_Item("clip-a", 0, 600), _Item("clip-b", 600, 1200)]

class _Timeline:
    def __init__(self):
        self._markers = {}
        self._sub_tracks = 0
    _name = "Fake Timeline"
    def GetName(self): return self._name
    def GetSetting(self, k): return "30" if k == "timelineFrameRate" else ""
    def SetSetting(self, k, v): return True
    def GetStartFrame(self): return 0
    def GetEndFrame(self): return 1800
    def GetTrackCount(self, kind):
        if kind == "subtitle": return self._sub_tracks
        return 1
    def AddTrack(self, kind):
        if kind == "subtitle":
            self._sub_tracks += 1
        return True
    def GetItemListInTrack(self, kind, ti):
        if kind != "video":
            return []
        return _TIMELINE_ITEMS
    def GetMarkers(self):
        return self._markers
    def AddMarker(self, frame, color, name, note, dur, custom):
        self._markers[frame] = {"color": color, "name": name, "note": note, "duration": dur}
        return True
    def DuplicateTimeline(self, name):
        new_tl = _Timeline()
        new_tl._name = name
        return new_tl
    def AddTrack(self, kind):
        if kind == "subtitle":
            self._sub_tracks += 1
        return True

_TIMELINE = _Timeline()

class _Folder:
    def __init__(self, name):
        self._name = name
        self._subs = []
    def GetName(self): return self._name
    def GetSubFolderList(self): return self._subs

class _MediaPool:
    def __init__(self):
        self._root = _Folder("Master")
        self._current = self._root
    def GetRootFolder(self): return self._root
    def AddSubFolder(self, parent, name):
        f = _Folder(name)
        parent._subs.append(f)
        return f
    def SetCurrentFolder(self, f):
        self._current = f
        return True
    def AppendToTimeline(self, items):
        # Echo back as a single timeline item. Items can be either media-pool
        # items (append) or clipInfo dicts (track-targeted insert).
        first = items[0]
        if isinstance(first, dict):
            name = first.get("mediaPoolItem")._name if hasattr(first.get("mediaPoolItem"), "_name") else "inserted"
            track = first.get("trackIndex", 1)
            rec = first.get("recordFrame", 0)
            return [_Item(name, rec, rec + 300)]
        name = getattr(first, "_name", "appended")
        return [_Item(name, 1200, 1500)]
    def ImportTimelineFromFile(self, path, opts):
        return _TIMELINE
    def CreateEmptyTimeline(self, name):
        return _TIMELINE
    def ImportMedia(self, paths):
        class _MPI:
            def __init__(self, p): self._name = p.split("/")[-1]
        return [_MPI(p) for p in paths]

class _MediaStorage:
    def AddItemListToMediaPool(self, paths):
        # Pretend each path becomes a media pool item.
        class _MPI:
            def __init__(self, p): self._name = p.split("/")[-1]
        return [_MPI(p) for p in paths]

class _Project:
    def GetCurrentTimeline(self): return _TIMELINE
    def SetCurrentTimeline(self, tl): return True
    def GetMediaPool(self): return _MediaPool()
    def LoadRenderPreset(self, name): return name == "valid-preset"
    def GetRenderPresetList(self): return ["valid-preset", "another"]
    def SetRenderSettings(self, s): return True
    def SetSetting(self, k, v): return True
    def AddRenderJob(self): return "job-1"
    def StartRendering(self, jobs, interactive): return True
    def IsRenderingInProgress(self): return False

class _PM:
    saved = False
    def GetCurrentProject(self): return _Project()
    def SaveProject(self):
        _PM.saved = True
        return True

class _Resolve:
    _opened_page = None
    def GetProjectManager(self): return _PM()
    def GetMediaStorage(self): return _MediaStorage()
    def GetProductName(self): return "FakeResolve"
    def GetVersionString(self): return "0.0-test"
    def OpenPage(self, name):
        _Resolve._opened_page = name
        return True

def scriptapp(name): return _Resolve()
`,
    );

    // Steer the bridge at our fake module instead of the real one.
    originalApiPath = process.env.RESOLVE_SCRIPT_API;
    originalLibPath = process.env.RESOLVE_SCRIPT_LIB;
    originalPyPath = process.env.PYTHONPATH;
    // The bridge only checks RESOLVE_SCRIPT_API to derive a Modules path on
    // PYTHONPATH. We set PYTHONPATH directly so it picks up our fake.
    process.env.PYTHONPATH = fakeModulesDir + (originalPyPath ? ":" + originalPyPath : "");
    // Set an API path so resolveEnv() doesn't override our PYTHONPATH; we
    // point it at our fake dir's parent so the env-var sanity check upstream
    // of bridge isn't triggered (the bridge itself doesn't validate it).
    process.env.RESOLVE_SCRIPT_API = fakeModulesDir;
    delete process.env.RESOLVE_SCRIPT_LIB;
  });

  afterAll(() => {
    if (originalApiPath === undefined) delete process.env.RESOLVE_SCRIPT_API;
    else process.env.RESOLVE_SCRIPT_API = originalApiPath;
    if (originalLibPath === undefined) delete process.env.RESOLVE_SCRIPT_LIB;
    else process.env.RESOLVE_SCRIPT_LIB = originalLibPath;
    if (originalPyPath === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = originalPyPath;
  });

  it("starts, handshakes, and round-trips a ping", async () => {
    const b = new ResolveBridge();
    try {
      const result = await b.call<{ pong: boolean; product: string }>("ping");
      expect(result.pong).toBe(true);
      expect(result.product).toBe("FakeResolve");
    } finally {
      b.kill();
    }
  });

  it("reads a timeline (clips + markers)", async () => {
    const b = new ResolveBridge();
    try {
      const t = await b.call<{
        name: string;
        frameRate: number;
        durationFrames: number;
        clips: unknown[];
        markers: unknown[];
      }>("get_timeline");
      expect(t.name).toBe("Fake Timeline");
      expect(t.frameRate).toBe(30);
      expect(t.durationFrames).toBe(1800);
      // Fake returns 2 clips on the video track; audio track returns empty.
      expect(t.clips.length).toBe(2);
      expect(
        t.clips.filter((c) => (c as { trackKind: string }).trackKind === "video"),
      ).toHaveLength(2);
    } finally {
      b.kill();
    }
  });

  it("adds a marker", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call("add_marker", {
        frame: 120,
        note: "kept — strongest take",
        color: "Green",
      });
      expect(r).toBeNull();
    } finally {
      b.kill();
    }
  });

  it("reads markers via get_markers", async () => {
    const b = new ResolveBridge();
    try {
      await b.call("add_marker", { frame: 60, note: "x", color: "Red" });
      const markers = await b.call<unknown[]>("get_markers");
      expect(Array.isArray(markers)).toBe(true);
      expect(markers.length).toBeGreaterThan(0);
    } finally {
      b.kill();
    }
  });

  it("creates a timeline", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ name: string }>("create_timeline", {
        name: "new-tl",
        fps: 30,
      });
      expect(r.name).toBe("Fake Timeline");
    } finally {
      b.kill();
    }
  });

  it("imports to media pool with a bin", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ imported: number }>("import_to_media_pool", {
        paths: ["/tmp/a.mov", "/tmp/b.mov"],
        bin: "GG",
      });
      expect(r.imported).toBe(2);
    } finally {
      b.kill();
    }
  });

  it("opens a page", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call("open_page", { name: "color" });
      expect(r).toBeNull();
    } finally {
      b.kill();
    }
  });

  it("sets clip speed (success path)", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ clipId: string; speed: number }>("set_clip_speed", {
        clipId: "id-clip-a",
        speed: 1.5,
      });
      expect(r.clipId).toBe("id-clip-a");
      expect(r.speed).toBe(1.5);
    } finally {
      b.kill();
    }
  });

  it("imports subtitles", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ imported: boolean; attached: boolean }>("import_subtitles", {
        srtPath: "/tmp/foo.srt",
      });
      expect(r.imported).toBe(true);
    } finally {
      b.kill();
    }
  });

  it("applies a LUT", async () => {
    const lutDir = mkdtempSync(join(tmpdir(), "gg-lut-"));
    const lutPath = join(lutDir, "x.cube");
    writeFileSync(lutPath, "# LUT\n");
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ clipId: string; lutPath: string; nodeIndex: number }>("apply_lut", {
        clipId: "id-clip-a",
        lutPath,
        nodeIndex: 1,
      });
      expect(r.clipId).toBe("id-clip-a");
      expect(r.nodeIndex).toBe(1);
    } finally {
      b.kill();
    }
  });

  it("sets a primary correction", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ clipId: string; nodeIndex: number }>("set_primary_correction", {
        clipId: "id-clip-a",
        slope: [1.1, 1.0, 0.95],
        offset: [0, 0, 0.02],
        power: [1, 1, 1],
        saturation: 1.05,
        nodeIndex: 1,
      });
      expect(r.clipId).toBe("id-clip-a");
      expect(r.nodeIndex).toBe(1);
    } finally {
      b.kill();
    }
  });

  it("lists render presets", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<string[]>("list_render_presets");
      expect(Array.isArray(r)).toBe(true);
      expect(r).toContain("valid-preset");
    } finally {
      b.kill();
    }
  });

  it("replaces a clip", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ clipId: string; mediaPath: string }>("replace_clip", {
        clipId: "id-clip-a",
        mediaPath: "/tmp/new.mov",
      });
      expect(r.clipId).toBe("id-clip-a");
      expect(r.mediaPath).toBe("/tmp/new.mov");
    } finally {
      b.kill();
    }
  });

  it("triggers smart reframe", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ clipId: string; aspect: string }>("smart_reframe", {
        clipId: "id-clip-a",
        aspect: "9:16",
      });
      expect(r.clipId).toBe("id-clip-a");
      expect(r.aspect).toBe("9:16");
    } finally {
      b.kill();
    }
  });

  it("inserts a clip on a specific track + record frame", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ track: number; startFrame: number; name: string }>(
        "insert_clip_on_track",
        { mediaPath: "/tmp/broll.mov", track: 2, recordFrame: 600 },
      );
      expect(r.track).toBe(2);
      expect(r.startFrame).toBe(600);
    } finally {
      b.kill();
    }
  });

  it("clones the active timeline", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ name: string }>("clone_timeline", { newName: "v2" });
      expect(r.name).toBe("v2");
    } finally {
      b.kill();
    }
  });

  it("saves the project", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call("save_project");
      expect(r).toBeNull();
    } finally {
      b.kill();
    }
  });

  it("adds a subtitle track", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ kind: string; track: number }>("add_track", {
        kind: "subtitle",
      });
      expect(r.kind).toBe("subtitle");
      expect(r.track).toBeGreaterThan(0);
    } finally {
      b.kill();
    }
  });

  it("sets clip volume", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ clipId: string; volumeDb: number }>("set_clip_volume", {
        clipId: "id-clip-a",
        volumeDb: -3,
      });
      expect(r.clipId).toBe("id-clip-a");
      expect(r.volumeDb).toBe(-3);
    } finally {
      b.kill();
    }
  });

  it("copies grade across clips", async () => {
    const b = new ResolveBridge();
    try {
      const r = await b.call<{ sourceClipId: string; copied: number }>("copy_grade", {
        sourceClipId: "id-clip-a",
        targetClipIds: ["id-clip-b"],
      });
      expect(r.sourceClipId).toBe("id-clip-a");
      expect(r.copied).toBe(1);
    } finally {
      b.kill();
    }
  });

  it("surfaces python-side errors as rejections", async () => {
    const b = new ResolveBridge();
    try {
      await expect(
        b.call("render", { preset: "no-such-preset", output: "/tmp/x.mov" }),
      ).rejects.toThrow(/Render preset not found/);
    } finally {
      b.kill();
    }
  });
});
