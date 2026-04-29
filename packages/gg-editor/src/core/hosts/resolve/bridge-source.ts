/**
 * Embedded Python source for the Resolve bridge. Written to a temp file at
 * first launch and spawned with python3.
 *
 * Protocol: one JSON object per stdin line (request), one JSON object per
 * stdout line (response). All Resolve API access is wrapped in try/except so
 * a single failed call cannot kill the bridge.
 *
 *   Request:  {"id": "1", "method": "get_timeline", "params": {}}
 *   Response: {"id": "1", "ok": true,  "result": {...}}
 *             {"id": "1", "ok": false, "error": "..."}
 *
 * The bridge keeps the resolve / project / timeline references fresh by
 * re-fetching them per call (cheap, and handles the user switching projects).
 */
export const BRIDGE_PY = String.raw`#!/usr/bin/env python3
import json
import os
import sys
import traceback

# Resolve loads its scripting module from a non-standard path. The TS wrapper
# guarantees PYTHONPATH already contains the right Modules dir, but we double-
# check here so the error is clear if not.
try:
    import DaVinciResolveScript as dvr  # type: ignore
except ModuleNotFoundError as e:
    sys.stdout.write(json.dumps({
        "id": "_bootstrap",
        "ok": False,
        "error": "DaVinciResolveScript not importable. Set RESOLVE_SCRIPT_API and PYTHONPATH. " + str(e),
    }) + "\n")
    sys.stdout.flush()
    sys.exit(2)


def get_resolve():
    r = dvr.scriptapp("Resolve")
    if r is None:
        raise RuntimeError("Could not connect to Resolve. Is the app running and is external scripting enabled in Preferences?")
    return r


def get_project():
    r = get_resolve()
    pm = r.GetProjectManager()
    p = pm.GetCurrentProject()
    if p is None:
        raise RuntimeError("No project open in Resolve.")
    return p


def get_timeline_obj():
    p = get_project()
    t = p.GetCurrentTimeline()
    if t is None:
        raise RuntimeError("No timeline open in Resolve.")
    return t


# ── Helpers ─────────────────────────────────────────────────


def _find_timeline_item(clip_id):
    t = get_timeline_obj()
    cid = str(clip_id)
    for kind in ("video", "audio"):
        try:
            count = int(t.GetTrackCount(kind))
        except Exception:
            count = 0
        for ti in range(1, count + 1):
            for item in (t.GetItemListInTrack(kind, ti) or []):
                try:
                    iid = str(item.GetUniqueId()) if hasattr(item, "GetUniqueId") else item.GetName()
                except Exception:
                    iid = None
                if iid == cid:
                    return item
    raise RuntimeError(f"clip not found on timeline: {clip_id}")


# ── Method implementations ──────────────────────────────────

def m_ping(_params):
    r = get_resolve()
    return {"pong": True, "product": r.GetProductName(), "version": r.GetVersionString()}


def m_get_timeline(_params):
    t = get_timeline_obj()
    fr = float(t.GetSetting("timelineFrameRate") or 24.0)
    start_frame = int(t.GetStartFrame())
    end_frame = int(t.GetEndFrame())

    clips = []
    for kind in ("video", "audio"):
        try:
            count = int(t.GetTrackCount(kind))
        except Exception:
            count = 0
        for ti in range(1, count + 1):
            items = t.GetItemListInTrack(kind, ti) or []
            for item in items:
                try:
                    clips.append({
                        "id": str(item.GetUniqueId()) if hasattr(item, "GetUniqueId") else item.GetName(),
                        "track": ti,
                        "trackKind": kind,
                        "startFrame": int(item.GetStart()) - start_frame,
                        "endFrame": int(item.GetEnd()) - start_frame,
                        "name": item.GetName(),
                    })
                except Exception:
                    # Skip clips we can't introspect (compound/timeline items)
                    pass

    markers_dict = t.GetMarkers() or {}
    markers = []
    for frame_id, info in markers_dict.items():
        markers.append({
            "frame": int(frame_id),
            "note": info.get("note", "") or info.get("name", ""),
            "color": info.get("color"),
            "durationFrames": int(info.get("duration", 1)),
        })

    return {
        "name": t.GetName(),
        "frameRate": fr,
        "durationFrames": end_frame - start_frame,
        "clips": clips,
        "markers": markers,
    }


def m_add_marker(params):
    t = get_timeline_obj()
    frame = int(params["frame"])
    note = str(params.get("note", ""))
    color = str(params.get("color", "Blue")).capitalize()
    duration = int(params.get("durationFrames", 1) or 1)
    # Resolve marker color names: Blue, Cyan, Green, Yellow, Red, Pink, Purple,
    # Fuchsia, Rose, Lavender, Sky, Mint, Lemon, Sand, Cocoa, Cream
    ok = t.AddMarker(frame, color, note[:60], note, duration, "")
    if not ok:
        raise RuntimeError("AddMarker returned False (frame may already have a marker, or be out of range).")
    return None


def m_append_clip(params):
    project = get_project()
    media_pool = project.GetMediaPool()
    media_path = params["mediaPath"]
    track = int(params.get("track", 1))

    # Import the file into the media pool first.
    media_storage = get_resolve().GetMediaStorage()
    items = media_storage.AddItemListToMediaPool([media_path]) or []
    if not items:
        raise RuntimeError(f"Failed to import {media_path} into the media pool.")

    # AppendToTimeline appends to the end of whatever the current timeline is.
    # Track index is honoured for audio-only / video-only items; for AV items
    # the audio component goes to A1 by default.
    appended = media_pool.AppendToTimeline(items) or []
    if not appended:
        raise RuntimeError("AppendToTimeline returned no items.")

    item = appended[0]
    t = get_timeline_obj()
    start_frame = int(t.GetStartFrame())
    return {
        "id": str(item.GetUniqueId()) if hasattr(item, "GetUniqueId") else item.GetName(),
        "track": track,
        "trackKind": "video",
        "startFrame": int(item.GetStart()) - start_frame,
        "endFrame": int(item.GetEnd()) - start_frame,
        "name": item.GetName(),
    }


def m_import_timeline(params):
    project = get_project()
    media_pool = project.GetMediaPool()
    file_path = params["filePath"]
    timeline = media_pool.ImportTimelineFromFile(file_path, {})
    if timeline is None:
        raise RuntimeError(f"ImportTimelineFromFile returned None for {file_path}.")
    return {"name": timeline.GetName()}


def m_render(params):
    project = get_project()
    preset = params["preset"]
    output_path = params["output"]

    if not project.LoadRenderPreset(preset):
        # Try as a built-in preset key. List available so the agent can recover.
        available = project.GetRenderPresetList() or []
        raise RuntimeError(f"Render preset not found: {preset}. Available: {available[:10]}")

    out_dir = os.path.dirname(output_path) or "."
    out_file = os.path.basename(output_path)
    project.SetRenderSettings({
        "TargetDir": out_dir,
        "CustomName": os.path.splitext(out_file)[0],
    })

    job_id = project.AddRenderJob()
    if not job_id:
        raise RuntimeError("AddRenderJob failed.")
    project.StartRendering([job_id], False)

    # Block until done.
    import time
    while project.IsRenderingInProgress():
        time.sleep(0.5)

    return {"jobId": job_id, "output": output_path}


def m_get_markers(_params):
    t = get_timeline_obj()
    markers_dict = t.GetMarkers() or {}
    out = []
    for frame_id, info in markers_dict.items():
        out.append({
            "frame": int(frame_id),
            "note": info.get("note", "") or info.get("name", ""),
            "color": info.get("color"),
            "durationFrames": int(info.get("duration", 1)),
        })
    return out


def m_create_timeline(params):
    project = get_project()
    media_pool = project.GetMediaPool()
    name = str(params["name"])
    fps = params.get("fps")
    width = params.get("width")
    height = params.get("height")

    # Project-level frame rate must be set BEFORE creating the timeline; once a
    # project has timelines, the frame rate becomes locked. We try, and if it
    # fails because timelines exist, the new timeline will inherit project fps.
    if fps is not None:
        try:
            project.SetSetting("timelineFrameRate", str(float(fps)))
        except Exception:
            pass

    timeline = media_pool.CreateEmptyTimeline(name)
    if timeline is None:
        raise RuntimeError("CreateEmptyTimeline returned None.")

    if width is not None:
        try:
            timeline.SetSetting("useCustomSettings", "1")
            timeline.SetSetting("timelineResolutionWidth", str(int(width)))
        except Exception:
            pass
    if height is not None:
        try:
            timeline.SetSetting("timelineResolutionHeight", str(int(height)))
        except Exception:
            pass

    return {"name": timeline.GetName()}


def m_import_to_media_pool(params):
    project = get_project()
    media_pool = project.GetMediaPool()
    paths = list(params.get("paths") or [])
    bin_name = params.get("bin")

    if bin_name:
        # Walk top-level bins for a name match; create if absent.
        root = media_pool.GetRootFolder()
        target = None
        for sub in root.GetSubFolderList() or []:
            if sub.GetName() == bin_name:
                target = sub
                break
        if target is None:
            target = media_pool.AddSubFolder(root, bin_name)
        if target is not None:
            media_pool.SetCurrentFolder(target)

    media_storage = get_resolve().GetMediaStorage()
    items = media_storage.AddItemListToMediaPool(paths) or []
    return {"imported": len(items)}


def m_open_page(params):
    r = get_resolve()
    name = str(params["name"]).lower()
    valid = {"media", "cut", "edit", "fusion", "color", "fairlight", "deliver"}
    if name not in valid:
        raise RuntimeError(f"unknown page: {name}; valid: {sorted(valid)}")
    ok = r.OpenPage(name)
    if not ok:
        raise RuntimeError(f"OpenPage('{name}') returned False.")
    return None


def m_set_clip_speed(params):
    clip_id = str(params["clipId"])
    speed = float(params["speed"])
    if speed <= 0:
        raise RuntimeError("speed must be > 0")
    found = _find_timeline_item(clip_id)

    last_err = None
    # Try several APIs; Resolve versions differ.
    for setter in (
        lambda i: i.SetClipProperty("Speed", str(speed * 100.0)),
        lambda i: i.SetProperty("Speed", speed),
        lambda i: i.SetClipProperty("Speed", speed),
    ):
        try:
            ok = setter(found)
            if ok:
                return {"clipId": clip_id, "speed": speed}
        except Exception as e:
            last_err = e
    raise RuntimeError(
        f"Resolve refused all clip-speed setters for this version. Last error: {last_err}. "
        f"fix: rebuild via FCPXML with explicit timeMap."
    )


def m_apply_lut(params):
    import os as _os
    clip_id = str(params["clipId"])
    lut_path = str(params["lutPath"])
    node_index = int(params.get("nodeIndex", 1) or 1)
    if not _os.path.exists(lut_path):
        raise RuntimeError(f"LUT file not found: {lut_path}")
    item = _find_timeline_item(clip_id)
    if not hasattr(item, "SetLUT"):
        raise RuntimeError("this Resolve version's TimelineItem has no SetLUT")
    ok = item.SetLUT(node_index, lut_path)
    if not ok:
        raise RuntimeError(
            f"SetLUT returned False (node {node_index}, lut {lut_path}). "
            f"fix: ensure node {node_index} exists; node 1 always does."
        )
    return {"clipId": clip_id, "lutPath": lut_path, "nodeIndex": node_index}


def _fmt3(triple):
    return "%g %g %g" % (float(triple[0]), float(triple[1]), float(triple[2]))


def m_set_primary_correction(params):
    clip_id = str(params["clipId"])
    node_index = int(params.get("nodeIndex", 1) or 1)
    item = _find_timeline_item(clip_id)
    if not hasattr(item, "SetCDL"):
        raise RuntimeError("this Resolve version's TimelineItem has no SetCDL")
    cdl = {"NodeIndex": node_index}
    if params.get("slope") is not None:
        cdl["Slope"] = _fmt3(params["slope"])
    if params.get("offset") is not None:
        cdl["Offset"] = _fmt3(params["offset"])
    if params.get("power") is not None:
        cdl["Power"] = _fmt3(params["power"])
    if params.get("saturation") is not None:
        cdl["Saturation"] = "%g" % float(params["saturation"])
    ok = item.SetCDL(cdl)
    if not ok:
        raise RuntimeError(
            f"SetCDL returned False for node {node_index}. "
            f"fix: open the Color page (open_page('color')) and retry."
        )
    return {"clipId": clip_id, "nodeIndex": node_index}


def m_copy_grade(params):
    source_id = str(params["sourceClipId"])
    target_ids = [str(x) for x in (params.get("targetClipIds") or [])]
    if not target_ids:
        raise RuntimeError("targetClipIds must be a non-empty list")
    src = _find_timeline_item(source_id)
    targets = [_find_timeline_item(tid) for tid in target_ids]
    if not hasattr(src, "CopyGrades"):
        raise RuntimeError("this Resolve version's TimelineItem has no CopyGrades")
    ok = src.CopyGrades(targets)
    if not ok:
        raise RuntimeError(
            "CopyGrades returned False. fix: open the Color page (open_page('color')) and retry."
        )
    return {"sourceClipId": source_id, "copied": len(targets)}


def m_list_render_presets(_params):
    project = get_project()
    presets = project.GetRenderPresetList() or []
    return list(presets)


def m_replace_clip(params):
    clip_id = str(params["clipId"])
    media_path = str(params["mediaPath"])
    item = _find_timeline_item(clip_id)
    # Newer Resolve API: TimelineItem.ReplaceClip(media_path) or .ReplaceMedia.
    last_err = None
    for setter in (
        lambda i: i.ReplaceClip(media_path) if hasattr(i, "ReplaceClip") else False,
        lambda i: i.ReplaceMedia(media_path) if hasattr(i, "ReplaceMedia") else False,
    ):
        try:
            ok = setter(item)
            if ok:
                return {"clipId": clip_id, "mediaPath": media_path}
        except Exception as e:
            last_err = e
    raise RuntimeError(
        f"replace_clip not supported by this Resolve version. Last error: {last_err}. "
        f"fix: rebuild the segment via FCPXML with the new media reference."
    )


def m_add_track(params):
    t = get_timeline_obj()
    kind = str(params.get("kind", "video"))
    if kind not in ("video", "audio", "subtitle"):
        raise RuntimeError(f"unknown track kind: {kind}")
    if not hasattr(t, "AddTrack"):
        raise RuntimeError("this Resolve version's Timeline has no AddTrack")
    ok = t.AddTrack(kind)
    if not ok:
        raise RuntimeError(f"AddTrack({kind}) returned False")
    try:
        new_count = int(t.GetTrackCount(kind))
    except Exception:
        new_count = 0
    return {"kind": kind, "track": new_count}


def m_set_clip_volume(params):
    clip_id = str(params["clipId"])
    volume_db = float(params["volumeDb"])
    item = _find_timeline_item(clip_id)
    # Resolve audio clips expose Volume as a clip property in dB. Some versions
    # accept dB directly; older versions need linear (10**(dB/20)). Try both.
    last_err = None
    for setter in (
        lambda i: i.SetClipProperty("Volume", str(volume_db)),
        lambda i: i.SetClipProperty("Volume", volume_db),
        lambda i: i.SetClipProperty("Volume", str(10 ** (volume_db / 20.0))),
    ):
        try:
            ok = setter(item)
            if ok:
                return {"clipId": clip_id, "volumeDb": volume_db}
        except Exception as e:
            last_err = e
    raise RuntimeError(
        f"Resolve refused all volume setters. Last error: {last_err}. "
        f"fix: adjust volume manually on the Fairlight page."
    )


def m_clone_timeline(params):
    project = get_project()
    pm = get_resolve().GetProjectManager()
    src = project.GetCurrentTimeline()
    if src is None:
        raise RuntimeError("No active timeline to clone.")
    new_name = str(params["newName"])
    # Resolve API: TimelineItem dup is via Timeline.DuplicateTimeline(name).
    if not hasattr(src, "DuplicateTimeline"):
        raise RuntimeError("this Resolve version's Timeline has no DuplicateTimeline")
    new_tl = src.DuplicateTimeline(new_name)
    if new_tl is None:
        raise RuntimeError("DuplicateTimeline returned None")
    project.SetCurrentTimeline(new_tl)
    pm.SaveProject()
    return {"name": new_tl.GetName()}


def m_save_project(_params):
    pm = get_resolve().GetProjectManager()
    ok = pm.SaveProject()
    if not ok:
        raise RuntimeError("SaveProject returned False")
    return None


def m_insert_clip_on_track(params):
    project = get_project()
    media_pool = project.GetMediaPool()
    media_path = str(params["mediaPath"])
    track = int(params.get("track", 2))
    record_frame = int(params["recordFrame"])

    # Import media into the pool first.
    media_storage = get_resolve().GetMediaStorage()
    items = media_storage.AddItemListToMediaPool([media_path]) or []
    if not items:
        raise RuntimeError(f"failed to import {media_path} into media pool")
    item = items[0]

    clip_info = {
        "mediaPoolItem": item,
        "mediaType": 1,  # video
        "trackIndex": track,
        "recordFrame": record_frame,
    }
    if params.get("sourceInFrame") is not None:
        clip_info["startFrame"] = int(params["sourceInFrame"])
    if params.get("sourceOutFrame") is not None:
        clip_info["endFrame"] = int(params["sourceOutFrame"])

    appended = media_pool.AppendToTimeline([clip_info]) or []
    if not appended:
        raise RuntimeError(
            "AppendToTimeline returned no items; verify track index exists and recordFrame is within the timeline."
        )
    inserted = appended[0]
    t = get_timeline_obj()
    start_offset = int(t.GetStartFrame())
    return {
        "id": str(inserted.GetUniqueId()) if hasattr(inserted, "GetUniqueId") else inserted.GetName(),
        "track": track,
        "trackKind": "video",
        "startFrame": int(inserted.GetStart()) - start_offset,
        "endFrame": int(inserted.GetEnd()) - start_offset,
        "name": inserted.GetName(),
    }


def m_smart_reframe(params):
    clip_id = str(params["clipId"])
    aspect = str(params["aspect"])
    frame_interest = str(params.get("frameInterest", "all"))
    reference_frame = params.get("referenceFrame")
    item = _find_timeline_item(clip_id)
    if not hasattr(item, "SmartReframe"):
        raise RuntimeError(
            "this Resolve version's TimelineItem has no SmartReframe (Studio-only feature)"
        )
    # SmartReframe signature varies; pass aspect always, then optional kwargs.
    try:
        if reference_frame is not None and frame_interest == "reference-frame":
            ok = item.SmartReframe(aspect, frame_interest, int(reference_frame))
        else:
            ok = item.SmartReframe(aspect, frame_interest)
    except TypeError:
        ok = item.SmartReframe(aspect)
    if not ok:
        raise RuntimeError(
            "SmartReframe returned False. fix: ensure Resolve Studio (free version lacks AI), and the clip is on the active timeline."
        )
    return {"clipId": clip_id, "aspect": aspect}


def m_import_subtitles(params):
    project = get_project()
    media_pool = project.GetMediaPool()
    srt_path = params["srtPath"]

    items = media_pool.ImportMedia([srt_path]) or []
    if not items:
        raise RuntimeError(
            f"ImportMedia returned no items for {srt_path}. fix: import the SRT manually via File > Import Subtitle."
        )

    t = get_timeline_obj()
    # Make sure at least one subtitle track exists.
    try:
        sub_count = int(t.GetTrackCount("subtitle"))
    except Exception:
        sub_count = 0
    if sub_count < 1:
        try:
            t.AddTrack("subtitle")
        except Exception:
            pass

    appended = media_pool.AppendToTimeline(items) or []
    if not appended:
        return {
            "imported": True,
            "attached": False,
            "note": "SRT imported to media pool but auto-attach failed; drag onto subtitle track manually.",
        }
    return {"imported": True, "attached": True}


METHODS = {
    "ping": m_ping,
    "get_timeline": m_get_timeline,
    "add_marker": m_add_marker,
    "append_clip": m_append_clip,
    "import_timeline": m_import_timeline,
    "render": m_render,
    "get_markers": m_get_markers,
    "create_timeline": m_create_timeline,
    "import_to_media_pool": m_import_to_media_pool,
    "open_page": m_open_page,
    "set_clip_speed": m_set_clip_speed,
    "apply_lut": m_apply_lut,
    "set_primary_correction": m_set_primary_correction,
    "copy_grade": m_copy_grade,
    "list_render_presets": m_list_render_presets,
    "replace_clip": m_replace_clip,
    "smart_reframe": m_smart_reframe,
    "insert_clip_on_track": m_insert_clip_on_track,
    "clone_timeline": m_clone_timeline,
    "save_project": m_save_project,
    "add_track": m_add_track,
    "set_clip_volume": m_set_clip_volume,
    "import_subtitles": m_import_subtitles,
}


def main():
    # Signal we're alive.
    sys.stdout.write(json.dumps({"id": "_ready", "ok": True, "result": {"ready": True}}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            sys.stdout.write(json.dumps({"id": "_parse", "ok": False, "error": f"bad json: {e}"}) + "\n")
            sys.stdout.flush()
            continue

        rid = req.get("id", "?")
        method = req.get("method", "")
        params = req.get("params", {}) or {}

        fn = METHODS.get(method)
        if fn is None:
            sys.stdout.write(json.dumps({"id": rid, "ok": False, "error": f"unknown method: {method}"}) + "\n")
            sys.stdout.flush()
            continue

        try:
            result = fn(params)
            sys.stdout.write(json.dumps({"id": rid, "ok": True, "result": result}) + "\n")
        except Exception as e:
            tb = traceback.format_exc(limit=2)
            sys.stdout.write(json.dumps({"id": rid, "ok": False, "error": f"{e.__class__.__name__}: {e}", "trace": tb}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
`;
