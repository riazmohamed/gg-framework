# @kenkaiiii/gg-editor-premiere-panel

<p align="center">
  <strong>The CEP panel that lets <a href="../gg-editor/README.md">gg-editor</a> drive Adobe Premiere Pro on Windows (and optionally on macOS).</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kenkaiiii/gg-editor-premiere-panel"><img src="https://img.shields.io/npm/v/@kenkaiiii/gg-editor-premiere-panel?style=for-the-badge" alt="npm version"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

A small Adobe CEP extension. Hosts a localhost-only HTTP server (default port 7437) that the gg-editor agent uses to talk to Premiere via ExtendScript.

---

## Why this exists

On macOS, gg-editor can drive Premiere through `osascript` → AppleEvents → ExtendScript. On Windows there's no equivalent transport — the only reliable way to script a running Premiere is from inside the host itself.

This package is that "inside the host" piece. Install the panel once, leave it running in Premiere, and the gg-editor CLI reaches it over HTTP.

The panel works on macOS too, and it's faster than osascript (~10-30ms per call vs ~200-500ms). gg-editor probes for the panel first; if it's running, it uses it. Otherwise on macOS it falls back to osascript.

---

## Install

```bash
npm i -g @kenkaiiii/gg-editor-premiere-panel
gg-editor-premiere-panel install
```

That command:
1. Copies the panel files to your CEP extensions directory
2. Sets `PlayerDebugMode=1` for CSXS versions 9-12 (required for unsigned panels)

Then **restart Premiere Pro**, open `Window → Extensions → GG Editor`. The panel should show "listening" and a port number.

---

## Use

```bash
ggeditor --host premiere    # the gg-editor CLI now talks to your panel
```

That's it. No further config. The panel auto-loads when Premiere starts, the bridge auto-detects it.

---

## CLI commands

```bash
gg-editor-premiere-panel install      # install + enable debug mode
gg-editor-premiere-panel uninstall    # remove the panel
gg-editor-premiere-panel status       # show install state
gg-editor-premiere-panel debug-on     # enable PlayerDebugMode (without re-installing)
gg-editor-premiere-panel debug-off    # disable PlayerDebugMode
```

---

## Where it lives

| Platform | Install dir |
|---|---|
| macOS | `~/Library/Application Support/Adobe/CEP/extensions/com.kenkaiiii.gg-editor-premiere-panel/` |
| Windows | `%APPDATA%\Adobe\CEP\extensions\com.kenkaiiii.gg-editor-premiere-panel\` |

`PlayerDebugMode` is set in:
- macOS: `~/Library/Preferences/com.adobe.CSXS.<N>.plist`
- Windows: `HKCU\Software\Adobe\CSXS.<N>` (registry)

For CSXS versions 9 through 12 (covers Premiere 2019 to 2025+).

---

## Wire protocol

The panel runs a localhost HTTP server. The gg-editor adapter speaks two endpoints:

```http
GET /health
→ { "ok": true, "product": "gg-editor-premiere-panel", "port": 7437 }

POST /rpc
Body: { "method": "get_timeline", "params": {} }
→ { "ok": true, "result": {...} }
→ { "ok": false, "error": "..." }
```

Methods (mirror the macOS osascript bridge):
- `ping` — health + Premiere version
- `get_timeline` — clips, markers, fps, duration
- `add_marker` — drop a marker with note + color
- `append_clip` — import + add to active sequence
- `import_timeline` — bulk import EDL/FCPXML/AAF

Unsupported via live API (use `write_edl + import_timeline` on the gg-editor side):
- `cut_at`, `ripple_delete` — QE DOM razor is undocumented and unstable
- `render` — needs Adobe Media Encoder integration; deferred

---

## Security

- The HTTP server binds to `127.0.0.1` only. **Never** exposed beyond localhost.
- `PlayerDebugMode=1` lets unsigned CEP panels load. This is the standard development flag — Adobe documents it. To restrict to only signed panels, run `gg-editor-premiere-panel debug-off` and we'd need to ship a ZXP signing certificate (deferred).

---

## Troubleshooting

**Panel doesn't show up in Window → Extensions:**
1. Run `gg-editor-premiere-panel status` — confirm install dir exists
2. Run `gg-editor-premiere-panel debug-on` — sometimes Premiere updates wipe this
3. Fully quit Premiere (not just close the project) and relaunch
4. Check Window → Workspaces — the Extensions submenu only appears for some workspaces

**Panel shows "bind failed":**
- Port 7437 is in use. Set `GG_EDITOR_PREMIERE_PORT=8000` (or any free port) in the env Premiere launches with.

**`ggeditor --host premiere` says "panel not reachable":**
- Make sure Premiere is open AND the panel window is open (Window → Extensions → GG Editor)
- The panel only starts the HTTP server while its window is visible

**"JSX evalScript error":**
- Open Chrome DevTools at http://localhost:8088 (per the `.debug` file) to inspect the panel — JSX errors print to the console there

---

## License

MIT
