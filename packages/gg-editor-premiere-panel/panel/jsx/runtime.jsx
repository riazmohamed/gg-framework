/**
 * JSX runtime for the gg-editor Premiere panel.
 *
 * Exposes `gg_<method>(jsonString)` global functions. The Node-side panel
 * server calls these via CSInterface.evalScript and parses the JSON result.
 *
 * Each method:
 *   - Receives a JSON-encoded params string
 *   - Wraps work in try/catch
 *   - Returns a JSON string of {ok: true, result: ...} or {ok: false, error: "..."}
 *
 * Modern Premiere (2018+) ships ECMAScript 5 with full JSON.
 *
 * Methods mirror the macOS bridge:
 *   ping, get_timeline, add_marker, append_clip, import_timeline
 *
 * Unsupported via live API (use write_edl + import_timeline on the gg-editor side):
 *   cut_at, ripple_delete, render
 */

function _ok(v) { return JSON.stringify({ ok: true, result: v === undefined ? null : v }); }
function _fail(e) {
  return JSON.stringify({ ok: false, error: (e && e.message) ? String(e.message) : String(e) });
}

function _seq() {
  if (!app.project) throw new Error("No project open in Premiere.");
  var s = app.project.activeSequence;
  if (!s) throw new Error("No active sequence in Premiere.");
  return s;
}

function _fps(seq) {
  var fd = seq.getSettings().videoFrameRate.seconds;
  return fd > 0 ? 1 / fd : 30;
}

function _frames(time, seq) {
  var tb = parseInt(seq.timebase, 10);
  if (!tb || isNaN(tb)) tb = 1;
  return Math.round(parseInt(time.ticks, 10) / tb);
}

function _markerColor(name) {
  var m = { green:0, red:1, purple:2, orange:3, yellow:4, white:5, blue:6, cyan:7 };
  var k = (name || "blue").toLowerCase();
  return m[k] !== undefined ? m[k] : 6;
}

function _findClipBin(name) {
  var stack = [app.project.rootItem];
  while (stack.length) {
    var item = stack.pop();
    for (var i = 0; i < item.children.numItems; i++) {
      var child = item.children[i];
      if (child.name === name) return child;
      if (child.type === 2) stack.push(child); // BIN
    }
  }
  return null;
}

// ── Method implementations ──────────────────────────────────

function gg_ping(_jsonParams) {
  try {
    return _ok({ product: "Premiere Pro", version: app.version || "?" });
  } catch (e) { return _fail(e); }
}

function gg_get_timeline(_jsonParams) {
  try {
    var seq = _seq();
    var fps = _fps(seq);
    var clips = [];
    function collect(tracks, kind) {
      for (var ti = 0; ti < tracks.numTracks; ti++) {
        var tr = tracks[ti];
        for (var ci = 0; ci < tr.clips.numItems; ci++) {
          var c = tr.clips[ci];
          try {
            clips.push({
              id: String(c.nodeId || c.name + ":" + ci),
              track: ti + 1,
              trackKind: kind,
              startFrame: _frames(c.start, seq),
              endFrame: _frames(c.end, seq),
              name: c.name
            });
          } catch (_) { /* skip uninspectable */ }
        }
      }
    }
    collect(seq.videoTracks, "video");
    collect(seq.audioTracks, "audio");

    var markers = [];
    var mc = seq.markers;
    var m = mc.getFirstMarker();
    while (m) {
      markers.push({
        frame: _frames(m.start, seq),
        note: (m.comments || m.name || ""),
        color: m.colorIndex,
        durationFrames: _frames(m.end, seq) - _frames(m.start, seq)
      });
      m = mc.getNextMarker(m);
    }

    var dur = (seq.end ? _frames({ ticks: seq.end }, seq) : 0);
    return _ok({ name: seq.name, frameRate: fps, durationFrames: dur, clips: clips, markers: markers });
  } catch (e) { return _fail(e); }
}

function gg_add_marker(jsonParams) {
  try {
    var P = JSON.parse(jsonParams || "{}");
    var seq = _seq();
    var fps = _fps(seq);
    var m = seq.markers.createMarker(P.frame / fps);
    m.name = (P.note || "").substring(0, 60);
    m.comments = P.note || "";
    if (P.durationFrames && P.durationFrames > 1) {
      m.end = m.start + (P.durationFrames / fps);
    }
    try { m.setColorByIndex(_markerColor(P.color)); } catch (_) {}
    return _ok(null);
  } catch (e) { return _fail(e); }
}

function gg_append_clip(jsonParams) {
  try {
    var P = JSON.parse(jsonParams || "{}");
    var seq = _seq();
    var ok = app.project.importFiles([P.mediaPath], true, app.project.rootItem, false);
    if (!ok) throw new Error("importFiles returned false for " + P.mediaPath);
    var base = String(P.mediaPath).replace(/\\/g, "/").split("/").pop();
    var pi = _findClipBin(base);
    if (!pi) throw new Error("Imported item not found in project bin: " + base);
    var track = seq.videoTracks[(P.track || 1) - 1];
    if (!track) throw new Error("Track " + P.track + " does not exist on active sequence.");
    var endSec = seq.end ? (parseInt(seq.end, 10) / 254016000000) : 0;
    track.insertClip(pi, endSec);
    var inserted = track.clips[track.clips.numItems - 1];
    return _ok({
      id: String(inserted.nodeId || inserted.name),
      track: P.track || 1,
      trackKind: "video",
      startFrame: _frames(inserted.start, seq),
      endFrame: _frames(inserted.end, seq),
      name: inserted.name
    });
  } catch (e) { return _fail(e); }
}

function gg_import_timeline(jsonParams) {
  try {
    var P = JSON.parse(jsonParams || "{}");
    var ok = app.project.importFiles([P.filePath], true, app.project.rootItem, false);
    if (!ok) throw new Error("importFiles returned false for " + P.filePath);
    return _ok(null);
  } catch (e) { return _fail(e); }
}
