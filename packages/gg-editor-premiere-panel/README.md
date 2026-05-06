# @kenkaiiii/gg-editor-premiere-panel

<p align="center">
  <strong>Adobe Premiere Pro extensions that let <a href="../gg-editor/README.md">gg-editor</a> drive Premiere.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kenkaiiii/gg-editor-premiere-panel"><img src="https://img.shields.io/npm/v/@kenkaiiii/gg-editor-premiere-panel?style=for-the-badge" alt="npm version"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

This package ships **two** panels that both speak the same wire protocol to gg-editor:

| Panel | Best for | Lifespan |
|---|---|---|
| **UXP plugin** (recommended) | Premiere Pro **25.6+** | The only path that survives Adobe's September 2026 ExtendScript sunset |
| **CEP panel** (legacy) | Premiere Pro 22 → 25.x | Works through **September 2026**, then removed by Adobe |

Both panels can be installed at once — they have different bundle ids and don't conflict. gg-editor picks whichever responds first.

---

## Why two panels?

On macOS, gg-editor can drive Premiere through `osascript` → AppleEvents → ExtendScript as a fallback. On Windows there's no equivalent transport — the only way to script a running Premiere is from inside the host itself. That's where these extensions come in.

Beyond Windows support, the CEP panel is also faster than osascript on macOS (~10–30 ms per call vs ~200–500 ms), and the UXP plugin is the only one that will keep working past Adobe's September 2026 sunset of CEP/ExtendScript.

---

## Install (UXP — recommended)

```bash
npm i -g @kenkaiiii/gg-editor-premiere-panel
gg-editor-premiere-panel install            # defaults to --uxp
```

That command copies the plugin to:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Adobe/UXP/Plugins/External/com.kenkaiiii.gg-editor-premiere-panel.uxp/` |
| Windows | `%APPDATA%\Adobe\UXP\Plugins\External\com.kenkaiiii.gg-editor-premiere-panel.uxp\` |

Then **once**, in Premiere Pro:

1. Quit and restart Premiere
2. Open Premiere **Settings → Plugins** and tick **"Enable Developer Mode"**
3. Restart Premiere again (developer mode needs a restart)
4. Open **Window → UXP Plugins → GG Editor**
5. Click **Connect**

That's it. Now run `ggeditor --host premiere` from another terminal.

> **Why ggeditor hosts the WebSocket server (and the panel connects to it)**: UXP plugins can't open listening TCP sockets. So the gg-editor CLI binds a localhost WebSocket server on port 7437, and the UXP plugin dials out to it. (The CEP panel is the other way round — the panel is the HTTP server, ggeditor is the client.)

---

## Install (CEP — legacy)

```bash
gg-editor-premiere-panel install --cep
```

That command:
1. Copies the panel files to your CEP extensions directory
2. Sets `PlayerDebugMode=1` for CSXS versions 9–12 (required for unsigned panels)

Then **restart Premiere Pro**, open `Window → Extensions → GG Editor`. The panel should show "listening" and a port number.

---

## Use

```bash
ggeditor --host premiere    # gg-editor CLI talks to whichever panel is open
```

That's it. No further config.

---

## CLI commands

```bash
gg-editor-premiere-panel install              # install UXP plugin (default)
gg-editor-premiere-panel install --cep        # install legacy CEP panel
gg-editor-premiere-panel uninstall            # remove UXP plugin
gg-editor-premiere-panel uninstall --cep      # remove CEP panel
gg-editor-premiere-panel status               # show install state for both
gg-editor-premiere-panel debug-on             # enable PlayerDebugMode (CEP only)
gg-editor-premiere-panel debug-off            # disable PlayerDebugMode (CEP only)
```

---

## Where things live

| What | macOS | Windows |
|---|---|---|
| UXP plugin | `~/Library/Application Support/Adobe/UXP/Plugins/External/com.kenkaiiii.gg-editor-premiere-panel.uxp/` | `%APPDATA%\Adobe\UXP\Plugins\External\com.kenkaiiii.gg-editor-premiere-panel.uxp\` |
| CEP panel | `~/Library/Application Support/Adobe/CEP/extensions/com.kenkaiiii.gg-editor-premiere-panel/` | `%APPDATA%\Adobe\CEP\extensions\com.kenkaiiii.gg-editor-premiere-panel\` |
| `PlayerDebugMode` (CEP only) | `~/Library/Preferences/com.adobe.CSXS.<N>.plist` | `HKCU\Software\Adobe\CSXS.<N>` (registry) |

CEP debug mode is set for CSXS versions 9 through 12 (covers Premiere 2019 to 2025+). UXP doesn't use PlayerDebugMode; instead it requires the **Settings → Plugins → Enable Developer Mode** toggle inside Premiere itself.

---

## Wire protocol

### UXP (WebSocket, gg-editor is the server)

The plugin connects out to `ws://127.0.0.1:7437` (or 7438..7443 if the default is busy). On connect it sends a hello frame:

```json
{ "kind": "hello", "product": "gg-editor-premiere-panel", "panelKind": "uxp", "version": "0.2.0" }
```

Then RPC requests flow ggeditor → plugin, with replies on the same socket:

```json
→ { "id": "1", "method": "get_timeline", "params": {} }
← { "id": "1", "ok": true, "result": { ... } }
← { "id": "1", "ok": false, "error": "..." }
```

### CEP (HTTP, panel is the server)

```http
GET /health
→ { "ok": true, "product": "gg-editor-premiere-panel", "port": 7437, "kind": "cep" }

POST /rpc
Body: { "method": "get_timeline", "params": {} }
→ { "ok": true, "result": {...} }
→ { "ok": false, "error": "..." }
```

### Methods

Both panels expose the same set:

- `ping` — health + Premiere version
- `get_timeline` — clips, markers, fps, duration
- `get_markers` — list of markers on the active sequence
- `add_marker` — drop a marker with note + color + duration
- `append_clip` — import + add at end of active sequence
- `replace_clip` — swap a clip's media without disturbing range
- `clone_timeline` — duplicate the active sequence
- `save_project` — File → Save
- `import_to_media_pool` — bulk import into a bin
- `import_subtitles` — import an SRT into the project
- `import_timeline` — bulk import EDL/FCPXML/AAF
- `insert_clip_on_track` — surgical insert at a record-frame

Unsupported via either panel (use `write_edl + import_timeline` from gg-editor):

- `cut_at`, `ripple_delete` — no scriptable razor on either runtime
- `render` — needs Adobe Media Encoder integration; deferred
- `set_clip_speed`, Lumetri color ops — not exposed on either runtime today

---

## Security

- The UXP plugin only ever connects to `ws://127.0.0.1` (declared via `requiredPermissions.network.domains` in its manifest). The WS server bgg-editor binds is `127.0.0.1`-only.
- The CEP panel's HTTP server binds to `127.0.0.1` only. Never exposed beyond localhost.
- `PlayerDebugMode=1` lets unsigned CEP panels load. This is the standard development flag — Adobe documents it.

---

## Troubleshooting

**(UXP) Plugin doesn't show up in Window → UXP Plugins:**
1. Confirm developer mode: Premiere → Settings → Plugins → "Enable Developer Mode" must be ticked
2. Run `gg-editor-premiere-panel status` — confirm the install path exists
3. Fully quit Premiere and relaunch

**(UXP) Panel says "disconnected":**
- Make sure `ggeditor` is running before you click Connect, OR enable "Connect on launch" so the panel keeps retrying
- Check the port matches in both places (default 7437; the panel field is editable)

**(CEP) Panel doesn't show up in Window → Extensions:**
1. Run `gg-editor-premiere-panel status` — confirm install dir exists
2. Run `gg-editor-premiere-panel debug-on` — sometimes Premiere updates wipe this
3. Fully quit Premiere (not just close the project) and relaunch
4. Check Window → Workspaces — the Extensions submenu only appears for some workspaces

**(CEP) Panel shows "bind failed":**
- Port 7437 is in use. Set `GG_EDITOR_PREMIERE_PORT=8000` (or any free port) in the env Premiere launches with.

**`ggeditor --host premiere` says "panel not reachable":**
- For UXP: panel must be open AND clicked **Connect**
- For CEP: panel must be open (it only starts the HTTP server while the window is visible)

---

## License

MIT
