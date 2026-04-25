#!/usr/bin/env bash
# impl: simctl
# iOS Simulator screenshot — works for native iOS, React Native, Flutter,
# Capacitor, any project that lands on an iOS simulator.
#
# Usage:
#   visual-ios.sh [device-udid]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

eyes_require xcrun

DEVICE="${1:-booted}"

# Verify the target exists and is booted
if [ "$DEVICE" = "booted" ]; then
  xcrun simctl list devices booted 2>/dev/null | grep -q Booted \
    || eyes_die "no iOS simulator booted. boot one: 'xcrun simctl boot <udid>' or open Simulator.app"
else
  xcrun simctl list devices 2>/dev/null | grep -q "$DEVICE" \
    || eyes_die "simulator not found: $DEVICE"
fi

OUT="$(eyes_out_dir)/screenshot-ios-$(eyes_timestamp).png"
eyes_timeout 15 xcrun simctl io "$DEVICE" screenshot "$OUT" >&2 \
  || eyes_die "simctl screenshot failed"
[ -s "$OUT" ] || eyes_die "screenshot empty"
echo "$OUT"
