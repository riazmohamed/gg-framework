#!/usr/bin/env bash
# install.sh <impl> [--as <name>]
# Installs deps for <impl>, copies impl/<impl>.sh into .gg/eyes/<name>.sh (default "visual").
# Multi-impl projects install once per impl with distinct --as names,
# e.g. visual-ios / visual-android.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../shared/_lib.sh"

IMPL="${1:-}"
[ -z "$IMPL" ] && eyes_die "usage: install.sh <impl> [--as <name>]"
shift

NAME="visual"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --as) NAME="$2"; shift 2;;
    *) eyes_die "unknown arg: $1";;
  esac
done

IMPL_FILE="$HERE/impl/$IMPL.sh"
if [ ! -f "$IMPL_FILE" ]; then
  echo "no impl '$IMPL'. available:" >&2
  ls "$HERE/impl/" | sed 's/\.sh$//' | sed 's/^/  - /' >&2
  exit 1
fi

# Per-impl dep install
case "$IMPL" in
  playwright)
    eyes_require npx
    eyes_require node
    # Browser install is the big/slow part. 5min budget.
    echo "installing chromium for playwright..." >&2
    eyes_timeout 300 npx --yes -p playwright@latest playwright install chromium --with-deps 2>&1 \
      | tail -20 >&2 \
      || eyes_die "playwright install failed"
    ;;
  adb)
    eyes_require adb
    adb devices | tail -n +2 | grep -q device \
      || echo "warning: no android device/emulator currently connected (adb devices is empty). probe will fail until one is." >&2
    ;;
  simctl)
    [ "$(eyes_os)" = "darwin" ] || eyes_die "simctl only works on macOS (iOS simulator requires Xcode)"
    eyes_require xcrun
    xcrun simctl list devices booted 2>/dev/null | grep -q Booted \
      || echo "warning: no iOS simulator currently booted. probe will fail until one is." >&2
    ;;
  window)
    case "$(eyes_os)" in
      darwin) eyes_require screencapture;;
      linux)
        if ! command -v grim >/dev/null 2>&1 \
           && ! command -v scrot >/dev/null 2>&1 \
           && ! command -v import >/dev/null 2>&1; then
          eyes_die "need one of: grim (wayland), scrot (x11), or import (imagemagick)"
        fi
        ;;
      *) eyes_die "window capture not supported on $(eyes_os)";;
    esac
    ;;
  godot)
    command -v godot >/dev/null 2>&1 \
      || echo "warning: godot not on PATH. install Godot and ensure 'godot' is callable." >&2
    ;;
  unity|unreal)
    echo "note: $IMPL headless capture requires an editor CLI. probe is best-effort; see script comments." >&2
    ;;
  generic)
    : ;;
  *)
    eyes_die "unknown impl: $IMPL"
    ;;
esac

DEST="$(eyes_root)/$NAME.sh"
mkdir -p "$(dirname "$DEST")"
cp "$IMPL_FILE" "$DEST"
chmod +x "$DEST"
cp "$HERE/../../shared/_lib.sh" "$(eyes_root)/_lib.sh"
cp "$HERE/../../shared/_redact.sh" "$(eyes_root)/_redact.sh"
chmod +x "$(eyes_root)/_redact.sh"

echo "EYES_INSTALLED=$DEST"
echo "installed: $DEST (impl=$IMPL)" >&2
