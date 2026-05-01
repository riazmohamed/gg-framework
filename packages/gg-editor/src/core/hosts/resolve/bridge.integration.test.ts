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
class _FusionInput:
    def __init__(self, name, value=None):
        self._name = name
        self._value = value
        self._keys = {}
        self._connected_to = None
    def __call__(self): return self._value
    def SetKeyFrames(self, m):
        self._keys.update(m)
        return True
    def ConnectTo(self, output):
        self._connected_to = output
        return True

class _FusionOutput:
    def __init__(self, owner): self._owner = owner

class _FusionTool:
    def __init__(self, tool_id, name=None):
        self._tool_id = tool_id
        self._name = name or tool_id + "1"
        self._inputs = {}
        self._connections = []
    def GetAttrs(self, key=None):
        attrs = {"TOOLS_RegID": self._tool_id, "TOOLS_Name": self._name}
        return attrs.get(key) if key else attrs
    def SetAttrs(self, m):
        if "TOOLS_Name" in m:
            self._name = m["TOOLS_Name"]
        return True
    def __getattr__(self, name):
        # Auto-create input handles on access (Fusion behaviour: any input
        # name resolves to an input object). Underscore-prefixed names are
        # reserved for internal state — raise AttributeError so the
        # getattr(obj, _x, default) idiom returns the default.
        if name.startswith("_"):
            raise AttributeError(name)
        d = self.__dict__.setdefault("_inputs", {})
        if name not in d:
            d[name] = _FusionInput(name)
        return d[name]
    def __setattr__(self, name, value):
        if name.startswith("_"):
            super().__setattr__(name, value)
            return
        d = self.__dict__.setdefault("_inputs", {})
        inp = d.setdefault(name, _FusionInput(name))
        inp._value = value
    def FindMainOutput(self, idx): return _FusionOutput(self)
    def FindMainInput(self, idx):
        d = self.__dict__.setdefault("_inputs", {})
        if "Input" not in d:
            d["Input"] = _FusionInput("Input")
        return d["Input"]
    def Delete(self):
        # Mark deleted; the parent comp tracks the live list by identity.
        self._deleted = True

class _Comp:
    def __init__(self):
        self._tools = {}
        self._attrs = {}
        self._keyframes = []
    def AddTool(self, tool_id):
        t = _FusionTool(tool_id)
        suffix = sum(1 for x in self._tools.values() if x._tool_id == tool_id) + 1
        t._name = f"{tool_id}{suffix}"
        # Use object identity as the key so renames via SetAttrs don't strand
        # the entry; FindTool walks values to look up by current _name.
        self._tools[id(t)] = t
        return t
    def FindTool(self, name):
        for t in self._tools.values():
            if not getattr(t, "_deleted", False) and t._name == name:
                return t
        return None
    def GetToolList(self, selected=False):
        return {k: v for k, v in self._tools.items() if not getattr(v, "_deleted", False)}
    def SetKeyFrames(self, m):
        self._keyframes.append(m)
        return True
    def SetAttrs(self, m):
        self._attrs.update(m)
        return True

_FUSION_COMP = _Comp()

class _Fusion:
    def GetCurrentComp(self): return _FUSION_COMP

_FUSION_INSTANCE = _Fusion()

class _Item:
    def __init__(self, name, start, end):
        self._name, self._start, self._end = name, start, end
        self.lut = None
        self.cdl = None
        self.copied_to = None
        self.props = {}
        self._fusion_comps = []
    def GetUniqueId(self): return f"id-{self._name}"
    def GetName(self): return self._name
    def GetStart(self): return self._start
    def GetEnd(self): return self._end
    def SetLUT(self, idx, path):
        self.lut = (idx, path)
        return True
    def SetCDL(self, cdl):
        # Real Resolve silently no-ops SetCDL when the user isn't on the
        # color page. Mirror that here so the bridge's auto-retry logic
        # (which OpenPage(color)s and retries) is exercised end-to-end.
        if _Resolve._opened_page != "color":
            return False
        self.cdl = dict(cdl)
        return True
    def CopyGrades(self, targets):
        if _Resolve._opened_page != "color":
            return False
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
    def GetFusionCompCount(self): return len(self._fusion_comps)
    def GetFusionCompByIndex(self, i): return self._fusion_comps[i - 1]
    def AddFusionComp(self):
        c = _Comp()
        self._fusion_comps.append(c)
        return c

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
    def GetCurrentPage(self): return _Resolve._opened_page
    def OpenPage(self, name):
        _Resolve._opened_page = name
        return True
    def Fusion(self): return _FUSION_INSTANCE

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

  it("set_primary_correction auto-opens the Color page when SetCDL fails", async () => {
    // The fake SetCDL returns False unless _Resolve._opened_page == 'color'.
    // We deliberately steer the page to 'edit' first, then call CDL — the
    // bridge should silently OpenPage('color') and retry, succeeding.
    const b = new ResolveBridge();
    try {
      await b.call("open_page", { name: "edit" });
      const r = await b.call<{ clipId: string }>("set_primary_correction", {
        clipId: "id-clip-a",
        saturation: 1.0,
      });
      expect(r.clipId).toBe("id-clip-a");
      // Verify the bridge actually flipped the page on our behalf.
      const probe = await b.call<{ result: string }>("execute_code", {
        code: "set_result(resolve.GetCurrentPage())",
      });
      expect(probe.result).toBe("color");
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

  describe("execute_code (escape hatch)", () => {
    it("returns a value via set_result", async () => {
      const b = new ResolveBridge();
      try {
        const r = await b.call<{ result: unknown }>("execute_code", {
          code: "set_result(project.GetCurrentTimeline().GetName())",
        });
        expect(r.result).toBe("Fake Timeline");
      } finally {
        b.kill();
      }
    });

    it("returns a value via top-level `result =`", async () => {
      const b = new ResolveBridge();
      try {
        const r = await b.call<{ result: unknown }>("execute_code", {
          code: "result = resolve.GetProductName()",
        });
        expect(r.result).toBe("FakeResolve");
      } finally {
        b.kill();
      }
    });

    it("captures stdout", async () => {
      const b = new ResolveBridge();
      try {
        const r = await b.call<{ result: unknown; stdout?: string }>("execute_code", {
          code: "print('hello'); print('world'); set_result(42)",
        });
        expect(r.result).toBe(42);
        expect(r.stdout).toContain("hello");
        expect(r.stdout).toContain("world");
      } finally {
        b.kill();
      }
    });

    it("surfaces python exceptions with stdout tail", async () => {
      const b = new ResolveBridge();
      try {
        await expect(
          b.call("execute_code", {
            code: "print('before crash'); raise ValueError('boom')",
          }),
        ).rejects.toThrow(/ValueError: boom[\s\S]*before crash/);
      } finally {
        b.kill();
      }
    });

    it("rejects empty code", async () => {
      const b = new ResolveBridge();
      try {
        await expect(b.call("execute_code", { code: "" })).rejects.toThrow(
          /non-empty 'code' string/,
        );
      } finally {
        b.kill();
      }
    });

    it("coerces non-JSON-serialisable results to repr", async () => {
      const b = new ResolveBridge();
      try {
        // The fake _Resolve object has no JSON encoder; should come back as repr.
        const r = await b.call<{ result: unknown }>("execute_code", {
          code: "set_result(resolve)",
        });
        expect(typeof r.result).toBe("string");
        expect(r.result as string).toMatch(/_Resolve/);
      } finally {
        b.kill();
      }
    });
  });

  describe("fusion_comp", () => {
    it("adds a TextPlus node and reads it back via list_nodes", async () => {
      const b = new ResolveBridge();
      try {
        const added = await b.call<{ name: string; toolId: string }>("fusion_comp", {
          action: "add_node",
          toolId: "TextPlus",
          name: "LowerThirdText",
        });
        expect(added.toolId).toBe("TextPlus");
        expect(added.name).toBe("LowerThirdText");

        const listed = await b.call<{ count: number; nodes: Array<{ name: string }> }>(
          "fusion_comp",
          { action: "list_nodes" },
        );
        expect(listed.count).toBeGreaterThan(0);
        expect(listed.nodes.some((n) => n.name === "LowerThirdText")).toBe(true);
      } finally {
        b.kill();
      }
    });

    it("set_input + get_input round-trip", async () => {
      const b = new ResolveBridge();
      try {
        await b.call("fusion_comp", {
          action: "add_node",
          toolId: "TextPlus",
          name: "Title",
        });
        await b.call("fusion_comp", {
          action: "set_input",
          node: "Title",
          input: "StyledText",
          value: "Hello",
        });
        const got = await b.call<{ value: unknown }>("fusion_comp", {
          action: "get_input",
          node: "Title",
          input: "StyledText",
        });
        expect(got.value).toBe("Hello");
      } finally {
        b.kill();
      }
    });

    it("connect wires two nodes", async () => {
      const b = new ResolveBridge();
      try {
        await b.call("fusion_comp", { action: "add_node", toolId: "Background", name: "BG" });
        await b.call("fusion_comp", { action: "add_node", toolId: "TextPlus", name: "TXT" });
        await b.call("fusion_comp", { action: "add_node", toolId: "Merge", name: "COMP" });
        const r = await b.call<{ from: string; to: string }>("fusion_comp", {
          action: "connect",
          fromNode: "BG",
          toNode: "COMP",
          toInput: "Background",
        });
        expect(r.from).toBe("BG");
        expect(r.to).toBe("COMP");
      } finally {
        b.kill();
      }
    });

    it("set_keyframe and set_render_range succeed", async () => {
      const b = new ResolveBridge();
      try {
        await b.call("fusion_comp", {
          action: "add_node",
          toolId: "Transform",
          name: "XF",
        });
        const k = await b.call<{ frame: number }>("fusion_comp", {
          action: "set_keyframe",
          node: "XF",
          input: "Center",
          frame: 24,
          value: [0.5, 0.5],
        });
        expect(k.frame).toBe(24);
        const rr = await b.call<{ start: number; end: number }>("fusion_comp", {
          action: "set_render_range",
          start: 0,
          end: 120,
        });
        expect(rr.start).toBe(0);
        expect(rr.end).toBe(120);
      } finally {
        b.kill();
      }
    });

    it("delete_node removes a node", async () => {
      const b = new ResolveBridge();
      try {
        await b.call("fusion_comp", { action: "add_node", toolId: "Glow", name: "GLOW1" });
        const r = await b.call<{ deleted: string }>("fusion_comp", {
          action: "delete_node",
          name: "GLOW1",
        });
        expect(r.deleted).toBe("GLOW1");
      } finally {
        b.kill();
      }
    });

    it("unknown action errors with action list", async () => {
      const b = new ResolveBridge();
      try {
        await expect(b.call("fusion_comp", { action: "teleport" })).rejects.toThrow(
          /unknown fusion_comp action/,
        );
      } finally {
        b.kill();
      }
    });
  });

  describe("auto-respawn after death", () => {
    it("respawns the bridge on the next call after kill()", async () => {
      const b = new ResolveBridge();
      try {
        const a = await b.call<{ pong: boolean }>("ping");
        expect(a.pong).toBe(true);
        // Simulate Resolve quitting / Python crashing.
        b.kill();
        // Next call must succeed: ensureStarted() should detect the dead
        // flag and respawn from scratch instead of returning the stale
        // (resolved) readyPromise tied to a killed child.
        const c = await b.call<{ pong: boolean }>("ping");
        expect(c.pong).toBe(true);
      } finally {
        b.kill();
      }
    });
  });
});
