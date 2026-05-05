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


def _ensure_color_page():
    """Best-effort switch to the Color page when the current page isn't already
    color. Returns True if we issued an OpenPage call, False otherwise. Used by
    SetCDL / CopyGrades retry logic — those API calls silently no-op on the
    wrong page even though the values land in the data model.
    """
    try:
        r = get_resolve()
        cur = r.GetCurrentPage() if hasattr(r, "GetCurrentPage") else None
        if cur == "color":
            return False
        r.OpenPage("color")
        return True
    except Exception:
        return False


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
        # Common cause: agent set CDL while user was on another page. Auto-
        # switch to Color and retry once. If it fails again, the user/clip is
        # genuinely the problem — surface the original message.
        if _ensure_color_page():
            ok = item.SetCDL(cdl)
    if not ok:
        raise RuntimeError(
            f"SetCDL returned False for node {node_index}. "
            f"fix: ensure the clip exists and the project's color page is reachable."
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
        if _ensure_color_page():
            ok = src.CopyGrades(targets)
    if not ok:
        raise RuntimeError(
            "CopyGrades returned False. fix: ensure source + targets are valid timeline items."
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

    # mediaKind selects video (1) or audio (2) timeline track. AppendToTimeline
    # uses this to know which track family to operate on — critical for
    # SFX/foley insertion onto Fairlight tracks (audio_only=2).
    media_kind = str(params.get("mediaKind", "video")).lower()
    media_type = 2 if media_kind == "audio" else 1
    clip_info = {
        "mediaPoolItem": item,
        "mediaType": media_type,
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

    # Anchor the SRT at the timeline's start. AppendToTimeline(items) without
    # a clip-info dict appends to the END of existing content on the chosen
    # track — so if the subtitle track already has clips, OR Resolve picks the
    # video track's tail, the SRT's 0s cue lands at frame N>0 and every cue
    # past (timelineLength - N) seconds falls past the end of the video and
    # never renders. Forcing recordFrame=GetStartFrame() pins the SRT to the
    # start so its internal timecodes line up with the video.
    start_frame = int(t.GetStartFrame())
    clip_info = {
        "mediaPoolItem": items[0],
        "recordFrame": start_frame,
    }
    appended = media_pool.AppendToTimeline([clip_info]) or []
    if not appended:
        # Fallback to the legacy raw-items form. Some Resolve builds reject the
        # dict form for subtitle media — if so, the user gets the same
        # end-append behaviour as before but at least the SRT lands somewhere.
        appended = media_pool.AppendToTimeline(items) or []
        if not appended:
            return {
                "imported": True,
                "attached": False,
                "note": "SRT imported to media pool but auto-attach failed; drag onto subtitle track manually.",
            }
        return {
            "imported": True,
            "attached": True,
            "note": "SRT attached at end of timeline (Resolve rejected recordFrame=0). Move the subtitle clip back to frame 0 manually if cues appear past the video end.",
        }
    return {"imported": True, "attached": True}


# ── Fusion ──────────────────────────────────────────────────
#
# Fusion compositions live either at the timeline-clip level (every
# TimelineItem can carry one or more 'Fusion comps') OR at the project level
# via the standalone Fusion page. The agent operates on whichever the user
# is currently focused on — we resolve the comp once per call:
#
#   - clipId given:    item.GetFusionCompByIndex(1) on that timeline item.
#   - no clipId:       fusion.GetCurrentComp() on the active Fusion page.
#
# We deliberately keep the surface narrow (8 actions, the Fusion-page tools
# every short-form workflow needs) instead of mirroring the entire Fusion
# Python API. Power users have m_execute_code for the rest.


def _resolve_fusion_comp(clip_id):
    if clip_id:
        item = _find_timeline_item(clip_id)
        if not hasattr(item, "GetFusionCompCount") or not hasattr(item, "GetFusionCompByIndex"):
            raise RuntimeError("this Resolve version's TimelineItem has no Fusion comp accessors")
        count = int(item.GetFusionCompCount() or 0)
        if count < 1:
            # Try to add one. Modern Resolve exposes AddFusionComp; older
            # builds need the user to do it manually on the Fusion page.
            if hasattr(item, "AddFusionComp"):
                comp = item.AddFusionComp()
                if comp is None:
                    raise RuntimeError(f"AddFusionComp returned None for clip {clip_id}")
                return comp
            raise RuntimeError(
                f"clip {clip_id} has no Fusion comp; create one in Resolve (right-click → New Fusion Composition) first."
            )
        comp = item.GetFusionCompByIndex(1)
        if comp is None:
            raise RuntimeError(f"GetFusionCompByIndex(1) returned None for clip {clip_id}")
        return comp
    # No clip — use the active Fusion page comp.
    r = get_resolve()
    try:
        fusion = r.Fusion()
    except Exception as e:
        raise RuntimeError(f"Resolve.Fusion() unavailable: {e}")
    if fusion is None:
        raise RuntimeError("Fusion is not available in this Resolve build")
    comp = fusion.GetCurrentComp() if hasattr(fusion, "GetCurrentComp") else None
    if comp is None:
        raise RuntimeError(
            "No active Fusion comp. fix: switch to the Fusion page (open_page('fusion')) on a clip with a comp, or pass clipId."
        )
    return comp


def _fusion_node_summary(node):
    # Best-effort, never throws — the caller is reading a list of nodes.
    try:
        name = node.GetAttrs("TOOLS_Name") if hasattr(node, "GetAttrs") else None
    except Exception:
        name = None
    try:
        toolid = node.GetAttrs("TOOLS_RegID") if hasattr(node, "GetAttrs") else None
    except Exception:
        toolid = None
    if not name and hasattr(node, "Name"):
        try:
            name = node.Name
        except Exception:
            pass
    if not toolid and hasattr(node, "ID"):
        try:
            toolid = node.ID
        except Exception:
            pass
    return {"name": name, "toolId": toolid}


def m_fusion_comp(params):
    action = str(params.get("action") or "")
    if not action:
        raise RuntimeError("fusion_comp requires an 'action' field")
    clip_id = params.get("clipId")
    comp = _resolve_fusion_comp(str(clip_id) if clip_id else None)

    if action == "list_nodes":
        nodes = []
        try:
            tool_list = comp.GetToolList(False) or {}
        except Exception as e:
            raise RuntimeError(f"GetToolList failed: {e}")
        # GetToolList returns a 1-indexed dict on some builds; iterate values.
        try:
            iterator = tool_list.values() if hasattr(tool_list, "values") else list(tool_list)
        except Exception:
            iterator = []
        for node in iterator:
            nodes.append(_fusion_node_summary(node))
        return {"nodes": nodes, "count": len(nodes)}

    if action == "add_node":
        tool_id = str(params.get("toolId") or "")
        if not tool_id:
            raise RuntimeError("add_node requires 'toolId' (e.g. 'TextPlus', 'Background', 'Merge')")
        if not hasattr(comp, "AddTool"):
            raise RuntimeError("this Resolve build's Comp has no AddTool")
        node = comp.AddTool(tool_id)
        if node is None:
            raise RuntimeError(f"AddTool('{tool_id}') returned None; verify the tool ID exists")
        wanted_name = params.get("name")
        if wanted_name and hasattr(node, "SetAttrs"):
            try:
                node.SetAttrs({"TOOLS_Name": str(wanted_name)})
            except Exception:
                pass
        return _fusion_node_summary(node)

    if action == "delete_node":
        name = str(params.get("name") or "")
        if not name:
            raise RuntimeError("delete_node requires 'name'")
        node = comp.FindTool(name) if hasattr(comp, "FindTool") else None
        if node is None:
            raise RuntimeError(f"node not found: {name}")
        if not hasattr(node, "Delete"):
            raise RuntimeError("this Resolve build's Tool has no Delete")
        node.Delete()
        return {"deleted": name}

    if action == "connect":
        from_name = str(params.get("fromNode") or "")
        to_name = str(params.get("toNode") or "")
        from_output = str(params.get("fromOutput") or "Output")
        to_input = str(params.get("toInput") or "Input")
        if not from_name or not to_name:
            raise RuntimeError("connect requires 'fromNode' and 'toNode'")
        a = comp.FindTool(from_name)
        b = comp.FindTool(to_name)
        if a is None or b is None:
            raise RuntimeError(f"node not found (from={from_name}, to={to_name})")
        try:
            out = a.FindMainOutput(1) if from_output == "Output" else getattr(a, from_output, None)
        except Exception:
            out = None
        if out is None:
            raise RuntimeError(f"output '{from_output}' not found on {from_name}")
        try:
            inp = getattr(b, to_input, None)
            if inp is None and hasattr(b, "FindMainInput"):
                inp = b.FindMainInput(1)
        except Exception:
            inp = None
        if inp is None:
            raise RuntimeError(f"input '{to_input}' not found on {to_name}")
        try:
            inp.ConnectTo(out)
        except Exception as e:
            raise RuntimeError(f"ConnectTo failed: {e}")
        return {"from": from_name, "to": to_name}

    if action == "set_input":
        name = str(params.get("node") or "")
        input_name = str(params.get("input") or "")
        if not name or not input_name:
            raise RuntimeError("set_input requires 'node' and 'input'")
        if "value" not in params:
            raise RuntimeError("set_input requires 'value'")
        node = comp.FindTool(name)
        if node is None:
            raise RuntimeError(f"node not found: {name}")
        try:
            attr = getattr(node, input_name)
        except Exception:
            raise RuntimeError(f"input '{input_name}' not found on {name}")
        try:
            # Fusion inputs accept assignment directly: node.Input = value.
            setattr(node, input_name, params["value"])
        except Exception as e:
            raise RuntimeError(f"set_input failed: {e}")
        return {"node": name, "input": input_name}

    if action == "get_input":
        name = str(params.get("node") or "")
        input_name = str(params.get("input") or "")
        if not name or not input_name:
            raise RuntimeError("get_input requires 'node' and 'input'")
        node = comp.FindTool(name)
        if node is None:
            raise RuntimeError(f"node not found: {name}")
        try:
            attr = getattr(node, input_name)
        except Exception:
            raise RuntimeError(f"input '{input_name}' not found on {name}")
        value = None
        try:
            # Fusion inputs are callable for current-value access on some builds.
            value = attr() if callable(attr) else attr
        except Exception:
            value = attr
        try:
            json.dumps(value)
        except Exception:
            value = repr(value)
        return {"node": name, "input": input_name, "value": value}

    if action == "set_keyframe":
        name = str(params.get("node") or "")
        input_name = str(params.get("input") or "")
        frame = params.get("frame")
        if frame is None or not name or not input_name or "value" not in params:
            raise RuntimeError("set_keyframe requires 'node', 'input', 'frame', 'value'")
        node = comp.FindTool(name)
        if node is None:
            raise RuntimeError(f"node not found: {name}")
        try:
            attr = getattr(node, input_name)
        except Exception:
            raise RuntimeError(f"input '{input_name}' not found on {name}")
        try:
            # Comp.SetKeyFrames is the canonical path; older builds use
            # input.SetKeyFrames or .SetExpression. Try the modern one first.
            ok = comp.SetKeyFrames({attr: {int(frame): params["value"]}})
        except Exception:
            ok = False
        if not ok and hasattr(attr, "SetKeyFrames"):
            try:
                attr.SetKeyFrames({int(frame): params["value"]})
                ok = True
            except Exception:
                ok = False
        if not ok:
            raise RuntimeError("could not set keyframe via Comp.SetKeyFrames or Input.SetKeyFrames")
        return {"node": name, "input": input_name, "frame": int(frame)}

    if action == "set_render_range":
        start = params.get("start")
        end = params.get("end")
        if start is None or end is None:
            raise RuntimeError("set_render_range requires 'start' and 'end'")
        try:
            comp.SetAttrs({"COMPN_RenderStart": int(start), "COMPN_RenderEnd": int(end)})
        except Exception as e:
            raise RuntimeError(f"SetAttrs failed: {e}")
        return {"start": int(start), "end": int(end)}

    raise RuntimeError(
        f"unknown fusion_comp action: {action}; valid: list_nodes, add_node, delete_node, connect, set_input, get_input, set_keyframe, set_render_range"
    )


def m_execute_code(params):
    """Escape hatch: run arbitrary user code with the Resolve API pre-bound.

    Pre-bound globals available to the snippet:
      resolve, project, projectManager, mediaPool, mediaStorage, timeline,
      fusion (lazy — None if Fusion comp is unavailable), dvr (the
      DaVinciResolveScript module itself).

    Result delivery (in priority order):
      1. Call set_result(value) — explicit, supports any JSON-serialisable value.
      2. Assign to a top-level 'result' variable.
      3. Otherwise: stdout text only.

    stdout is captured and returned regardless. The snippet runs in the same
    process as every other bridge call, so a crash here CAN take the bridge
    down. We trap exceptions but a segfault in fusionscript.so cannot be caught.
    """
    code = params.get("code")
    if not isinstance(code, str) or not code.strip():
        raise RuntimeError("execute_code requires a non-empty 'code' string.")

    import io
    import contextlib

    resolve = get_resolve()
    project_manager = resolve.GetProjectManager()
    project = project_manager.GetCurrentProject() if project_manager else None
    media_pool = project.GetMediaPool() if project else None
    media_storage = resolve.GetMediaStorage()
    try:
        timeline = project.GetCurrentTimeline() if project else None
    except Exception:
        timeline = None
    try:
        fusion = resolve.Fusion()
    except Exception:
        fusion = None

    # JSON-serialisability check that won't crash on Resolve API objects (which
    # are PyRemoteObject and not JSON-able). Anything non-serialisable is
    # coerced to its repr so the agent at least sees what came back.
    def _safe(value):
        try:
            json.dumps(value)
            return value
        except Exception:
            return repr(value)

    holder = {"result": None, "set": False}

    def set_result(value):
        holder["result"] = _safe(value)
        holder["set"] = True

    g = {
        "__builtins__": __builtins__,
        "resolve": resolve,
        "project": project,
        "projectManager": project_manager,
        "mediaPool": media_pool,
        "mediaStorage": media_storage,
        "timeline": timeline,
        "fusion": fusion,
        "dvr": dvr,
        "set_result": set_result,
        "json": json,
    }
    l = {}

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            exec(code, g, l)
        except Exception as ex:
            # Re-raise with the captured stdout attached so the agent gets both
            # the print() output that ran before the crash AND the error.
            stdout = buf.getvalue()
            tail = ("\nstdout: " + stdout[-1500:]) if stdout else ""
            raise RuntimeError(f"{ex.__class__.__name__}: {ex}{tail}") from ex

    stdout = buf.getvalue()

    # Result resolution: explicit set_result wins; else top-level 'result'.
    if holder["set"]:
        result_value = holder["result"]
    elif "result" in l:
        result_value = _safe(l["result"])
    else:
        result_value = None

    out = {"result": result_value}
    if stdout:
        # Cap stdout to keep tool output token-economical.
        if len(stdout) > 4000:
            stdout = stdout[:2000] + "\n…[truncated]…\n" + stdout[-1500:]
        out["stdout"] = stdout
    return out


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
    "fusion_comp": m_fusion_comp,
    "execute_code": m_execute_code,
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
