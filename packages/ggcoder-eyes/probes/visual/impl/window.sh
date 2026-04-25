#!/usr/bin/env bash
# impl: window
# Desktop window/screen capture — Tauri, Electron, native Qt/GTK, games running
# in a window. macOS uses screencapture; Linux dispatches to grim (Wayland),
# scrot (X11), or ImageMagick's import.
#
# Usage:
#   visual-window.sh [--app <bundle-or-name>]   (macOS only: captures the named app's frontmost window)
#   visual-window.sh                            (captures the frontmost window / full screen as fallback)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

APP=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --app) APP="$2"; shift 2;;
    *) eyes_die "unknown arg: $1";;
  esac
done

OUT="$(eyes_out_dir)/screenshot-window-$(eyes_timestamp).png"

case "$(eyes_os)" in
  darwin)
    eyes_require screencapture
    if [ -n "$APP" ]; then
      # Get windowid for the named app's frontmost window via AppleScript.
      WID="$(osascript -e "tell application \"System Events\" to tell (first process whose name is \"$APP\" or bundle identifier is \"$APP\") to id of front window" 2>/dev/null || true)"
      if [ -n "$WID" ]; then
        screencapture -o -x -l "$WID" "$OUT" >/dev/null 2>&1 || eyes_die "screencapture of window $WID failed"
      else
        eyes_die "could not find frontmost window of app: $APP"
      fi
    else
      # Frontmost window of whichever app is active.
      screencapture -o -x -w "$OUT" >/dev/null 2>&1 \
        || screencapture -o -x "$OUT" >/dev/null 2>&1 \
        || eyes_die "screencapture failed"
    fi
    ;;
  linux)
    if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v grim >/dev/null 2>&1; then
      grim "$OUT" || eyes_die "grim failed"
    elif command -v scrot >/dev/null 2>&1; then
      scrot -u "$OUT" 2>/dev/null || scrot "$OUT" || eyes_die "scrot failed"
    elif command -v import >/dev/null 2>&1; then
      import -window root "$OUT" || eyes_die "import failed"
    else
      eyes_die "no screen-capture tool found (tried: grim, scrot, import)"
    fi
    ;;
  *)
    eyes_die "window capture not implemented for $(eyes_os)"
    ;;
esac

[ -s "$OUT" ] || eyes_die "screenshot empty: $OUT"
echo "$OUT"
