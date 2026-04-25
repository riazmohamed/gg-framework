#!/usr/bin/env bash
# impl: adb
# Android screenshot — works for native Android, React Native, Flutter, Capacitor,
# any project that lands on an Android device/emulator.
#
# Usage:
#   visual-android.sh [device-serial]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

eyes_require adb

DEVICE="${1:-}"
ARGS=()
[ -n "$DEVICE" ] && ARGS+=(-s "$DEVICE")

# Fail clearly if no device
if ! adb "${ARGS[@]}" get-state >/dev/null 2>&1; then
  eyes_die "no android device/emulator available. run 'adb devices' to list; start an emulator or connect a device."
fi

OUT="$(eyes_out_dir)/screenshot-android-$(eyes_timestamp).png"
# exec-out pipes binary PNG cleanly (no CRLF translation on Windows)
eyes_timeout 15 adb "${ARGS[@]}" exec-out screencap -p > "$OUT" \
  || eyes_die "adb screencap failed"
[ -s "$OUT" ] || eyes_die "screenshot empty"
echo "$OUT"
