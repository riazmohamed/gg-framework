/**
 * ExtendScript runtime for the Premiere bridge.
 *
 * Design: per-call self-contained JSX file. Each invocation generates a
 * complete script that:
 *   1. Defines small helpers (frame conversion, file writer)
 *   2. Reads command + params hard-coded into the file
 *   3. Writes result JSON to a known output path
 *   4. Always wraps work in try/catch so a Premiere-side exception still
 *      yields a parseable result file
 *
 * We keep JSX minimal — agent-facing logic lives in the TS adapter; JSX is
 * only the thin glue that walks app.project.* and writes JSON.
 *
 * Modern Premiere (2018+) ships with full ECMAScript 5 JSON support. We
 * don't polyfill; older versions get a clear error.
 */

const PREAMBLE = String.raw`
function _writeJson(path, obj) {
  var f = new File(path);
  f.encoding = "UTF-8";
  f.open("w");
  f.write(JSON.stringify(obj));
  f.close();
}

function _seq() {
  if (!app.project) throw new Error("No project open in Premiere.");
  var s = app.project.activeSequence;
  if (!s) throw new Error("No active sequence in Premiere.");
  return s;
}

function _fps(seq) {
  // videoFrameRate is a Time; .seconds = frame duration in seconds.
  var fd = seq.getSettings().videoFrameRate.seconds;
  return fd > 0 ? 1 / fd : 30;
}

function _frames(time, seq) {
  // seq.timebase: ticks per frame (TickValue). time.ticks: ticks since 0.
  var tb = parseInt(seq.timebase, 10);
  if (!tb || isNaN(tb)) tb = 1;
  return Math.round(parseInt(time.ticks, 10) / tb);
}

function _markerColor(name) {
  // Premiere marker colorIndex: 0..7 maps to Green, Red, Purple, Orange,
  // Yellow, White, Blue, Cyan (varies by version; this is the common map).
  var m = { green:0, red:1, purple:2, orange:3, yellow:4, white:5, blue:6, cyan:7 };
  var k = (name || "blue").toLowerCase();
  return m[k] !== undefined ? m[k] : 6;
}

function _findClipBin(name) {
  // Walk root bin recursively for a ProjectItem matching imported file name.
  var stack = [app.project.rootItem];
  while (stack.length) {
    var item = stack.pop();
    for (var i = 0; i < item.children.numItems; i++) {
      var child = item.children[i];
      if (child.name === name) return child;
      if (child.type === 2 /* BIN */) stack.push(child);
    }
  }
  return null;
}
`;

// ── Per-method bodies ───────────────────────────────────────

const METHODS: Record<string, string> = {
  ping: String.raw`
    return { product: "Premiere Pro", version: app.version || "?" };
  `,

  get_timeline: String.raw`
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
          } catch (e) { /* skip uninspectable */ }
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
    return {
      name: seq.name,
      frameRate: fps,
      durationFrames: dur,
      clips: clips,
      markers: markers
    };
  `,

  add_marker: String.raw`
    var seq = _seq();
    var fps = _fps(seq);
    var m = seq.markers.createMarker(P.frame / fps);
    m.name = (P.note || "").substring(0, 60);
    m.comments = P.note || "";
    if (P.durationFrames && P.durationFrames > 1) {
      m.end = m.start + (P.durationFrames / fps);
    }
    try { m.setColorByIndex(_markerColor(P.color)); } catch (e) {}
    return null;
  `,

  append_clip: String.raw`
    var seq = _seq();
    var ok = app.project.importFiles([P.mediaPath], true, app.project.rootItem, false);
    if (!ok) throw new Error("importFiles returned false for " + P.mediaPath);
    // Find the imported item by basename.
    var base = P.mediaPath.replace(/\\/g, "/").split("/").pop();
    var pi = _findClipBin(base);
    if (!pi) throw new Error("Imported item not found in project bin: " + base);
    var track = seq.videoTracks[(P.track || 1) - 1];
    if (!track) throw new Error("Track " + P.track + " does not exist on active sequence.");
    // Insert at sequence end.
    var endSec = seq.end ? (parseInt(seq.end, 10) / 254016000000) : 0;
    track.insertClip(pi, endSec);
    // Find the inserted clip — it's the last one on the track.
    var inserted = track.clips[track.clips.numItems - 1];
    return {
      id: String(inserted.nodeId || inserted.name),
      track: P.track || 1,
      trackKind: "video",
      startFrame: _frames(inserted.start, seq),
      endFrame: _frames(inserted.end, seq),
      name: inserted.name
    };
  `,

  import_timeline: String.raw`
    // Premiere's importFiles handles FCPXML/EDL — they create new sequences.
    var ok = app.project.importFiles([P.filePath], true, app.project.rootItem, false);
    if (!ok) throw new Error("importFiles returned false for " + P.filePath);
    return null;
  `,

  get_markers: String.raw`
    var seq = _seq();
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
    return markers;
  `,

  create_timeline: String.raw`
    if (!app.project) throw new Error("No project open in Premiere.");
    var name = String(P.name || "GG Sequence");
    var preset = P.presetPath || "";
    var newSeq = null;
    if (preset) {
      try { newSeq = app.project.createNewSequence(name, preset); } catch (e) { newSeq = null; }
    }
    if (!newSeq) {
      // Fallback: clone the active sequence so we get a usable preset.
      var src = app.project.activeSequence;
      if (!src) {
        throw new Error("create_timeline needs either a sqpreset path (P.presetPath) or an active sequence to clone.");
      }
      try {
        newSeq = src.clone();
        if (newSeq && newSeq.name !== undefined) newSeq.name = name;
      } catch (e2) {
        throw new Error("create_timeline fallback failed: " + (e2 && e2.message ? e2.message : e2));
      }
    }
    return { name: newSeq.name || name };
  `,

  import_to_media_pool: String.raw`
    if (!app.project) throw new Error("No project open in Premiere.");
    var paths = P.paths || [];
    if (!paths.length) throw new Error("import_to_media_pool: paths array is empty.");
    var parent = app.project.rootItem;
    if (P.bin) {
      var existing = null;
      for (var i = 0; i < parent.children.numItems; i++) {
        var child = parent.children[i];
        if (child.name === P.bin && child.type === 2 /* BIN */) { existing = child; break; }
      }
      parent = existing || parent.createBin(P.bin);
    }
    var ok = app.project.importFiles(paths, true, parent, false);
    if (!ok) throw new Error("importFiles returned false.");
    return { imported: paths.length };
  `,

  clone_timeline: String.raw`
    var src = _seq();
    var newName = String(P.newName || (src.name + " copy"));
    var cloned = null;
    try { cloned = src.clone(); } catch (e) { cloned = null; }
    if (!cloned) throw new Error("sequence clone failed (older Premiere versions don't expose Sequence.clone)");
    if (cloned.name !== undefined) {
      try { cloned.name = newName; } catch (e2) {}
    }
    return { name: cloned.name || newName };
  `,

  save_project: String.raw`
    if (!app.project) throw new Error("No project open in Premiere.");
    if (typeof app.project.save !== "function") throw new Error("app.project.save is not callable in this Premiere version");
    app.project.save();
    return null;
  `,

  insert_clip_on_track: String.raw`
    var seq = _seq();
    var fps = _fps(seq);
    // Import media first.
    var ok = app.project.importFiles([P.mediaPath], true, app.project.rootItem, false);
    if (!ok) throw new Error("importFiles returned false for " + P.mediaPath);
    var base = P.mediaPath.replace(/\\/g, "/").split("/").pop();
    var pi = _findClipBin(base);
    if (!pi) throw new Error("imported item not found: " + base);
    var trackIdx = (P.track || 2) - 1;
    // mediaKind selects audio vs video track family. Default video for back-compat.
    var kind = String(P.mediaKind || "video").toLowerCase();
    var trackList = (kind === "audio") ? seq.audioTracks : seq.videoTracks;
    var track = trackList[trackIdx];
    if (!track) throw new Error(kind + " track " + P.track + " does not exist on active sequence.");
    var recordSec = P.recordFrame / fps;
    track.insertClip(pi, recordSec);
    var inserted = null;
    for (var i = 0; i < track.clips.numItems; i++) {
      var c = track.clips[i];
      if (Math.abs(_frames(c.start, seq) - P.recordFrame) < 2) { inserted = c; break; }
    }
    if (!inserted) inserted = track.clips[track.clips.numItems - 1];
    return {
      id: String(inserted.nodeId || inserted.name),
      track: P.track || 2,
      trackKind: kind,
      startFrame: _frames(inserted.start, seq),
      endFrame: _frames(inserted.end, seq),
      name: inserted.name
    };
  `,

  replace_clip: String.raw`
    var seq = _seq();
    var target = null;
    function scan(tracks) {
      for (var ti = 0; ti < tracks.numTracks; ti++) {
        var tr = tracks[ti];
        for (var ci = 0; ci < tr.clips.numItems; ci++) {
          var c = tr.clips[ci];
          var iid = String(c.nodeId || c.name + ":" + ci);
          if (iid === P.clipId) { target = c; return; }
        }
      }
    }
    scan(seq.videoTracks);
    if (!target) scan(seq.audioTracks);
    if (!target) throw new Error("clip not found on active sequence: " + P.clipId);
    // Import the new media if not already in the project.
    var ok = app.project.importFiles([P.mediaPath], true, app.project.rootItem, false);
    if (!ok) throw new Error("importFiles returned false for " + P.mediaPath);
    var base = P.mediaPath.replace(/\\/g, "/").split("/").pop();
    var pi = _findClipBin(base);
    if (!pi) throw new Error("imported item not found: " + base);
    // Premiere's TrackItem exposes changeMediaPath in some versions.
    if (typeof target.changeMediaPath === "function") {
      target.changeMediaPath(P.mediaPath);
      return { clipId: P.clipId, mediaPath: P.mediaPath };
    }
    throw new Error("replace_clip not supported by this Premiere version. fix: rebuild via FCPXML with the new media reference.");
  `,

  import_subtitles: String.raw`
    if (!app.project) throw new Error("No project open in Premiere.");
    var ok = app.project.importFiles([P.srtPath], true, app.project.rootItem, false);
    if (!ok) throw new Error("importFiles returned false for " + P.srtPath);
    return { imported: true, attached: false, note: "SRT imported to project; drag onto a captions track on the active sequence." };
  `,

  // Escape hatch: eval arbitrary ExtendScript with the Premiere DOM in scope.
  // Pre-bound: app, project, sequence (active sequence or null), qe (Quality
  // Engineering DOM, undocumented but available after enableQE()).
  // Result resolution: caller may either assign to `result` or call setResult(value).
  // print(...) is captured to a buffer and returned as `stdout`.
  execute_code: String.raw`
    if (typeof P.code !== "string" || !P.code.length) {
      throw new Error("execute_code requires a non-empty 'code' string.");
    }
    var project = app.project || null;
    var sequence = (project && project.activeSequence) ? project.activeSequence : null;
    try { if (typeof app.enableQE === "function") app.enableQE(); } catch (eqe) {}
    var qe = (typeof window !== "undefined" && window.qe) ? window.qe : (typeof $.global.qe !== "undefined" ? $.global.qe : null);
    var __stdout = [];
    var print = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        try { parts.push(typeof arguments[i] === "string" ? arguments[i] : JSON.stringify(arguments[i])); }
        catch (e) { parts.push(String(arguments[i])); }
      }
      __stdout.push(parts.join(" "));
    };
    var __holder = { value: null, set: false };
    var setResult = function (v) { __holder.value = v; __holder.set = true; };
    var result = null;
    try {
      // ExtendScript eval inherits the current scope, so app/project/sequence/
      // qe/print/setResult/result are all visible inside the snippet.
      eval(P.code);
    } catch (eEval) {
      var stdout = __stdout.join("\n");
      var tail = stdout ? ("\nstdout: " + stdout.substring(Math.max(0, stdout.length - 1500))) : "";
      throw new Error((eEval && eEval.message ? eEval.message : String(eEval)) + tail);
    }
    var safe = function (v) {
      try { JSON.stringify(v); return v; } catch (e) { return String(v); }
    };
    var out = { result: __holder.set ? safe(__holder.value) : (typeof result === "undefined" ? null : safe(result)) };
    if (__stdout.length) {
      var s = __stdout.join("\n");
      if (s.length > 4000) s = s.substring(0, 2000) + "\n…[truncated]…\n" + s.substring(s.length - 1500);
      out.stdout = s;
    }
    return out;
  `,
};

/**
 * Generate a self-contained JSX script for one method invocation.
 * @param method   Method name (must match METHODS)
 * @param params   JSON-encoded params (will be JSON.parsed in JSX as `P`)
 * @param outPath  Absolute path where the result JSON is written
 */
export function buildJsxScript(
  method: string,
  params: Record<string, unknown>,
  outPath: string,
): string {
  const body = METHODS[method];
  if (!body) throw new Error(`unknown premiere method: ${method}`);
  // Escape outPath for safe JSX string literal.
  const safeOut = outPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const safeParams = JSON.stringify(params).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `${PREAMBLE}
var P = JSON.parse("${safeParams}");
var __out = "${safeOut}";
try {
  var __result = (function () { ${body} })();
  _writeJson(__out, { ok: true, result: __result === undefined ? null : __result });
} catch (__e) {
  _writeJson(__out, { ok: false, error: (__e && __e.message) ? __e.message : String(__e) });
}
`;
}

export const PREMIERE_METHODS = Object.keys(METHODS);
