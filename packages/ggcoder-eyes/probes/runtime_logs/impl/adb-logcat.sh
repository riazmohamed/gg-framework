#!/usr/bin/env bash
# impl: adb-logcat
# Android runtime logs. Works for native, RN, Flutter, Capacitor.
#
# Usage:
#   logs-android.sh [--device <serial>] [--tag <tag>] [--lines N] [--grep <pattern>] [--level V|D|I|W|E|F]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

eyes_require adb

DEVICE=""
TAG=""
LINES=200
PATTERN=""
LEVEL="V"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --device) DEVICE="$2"; shift 2;;
    --tag) TAG="$2"; shift 2;;
    --lines) LINES="$2"; shift 2;;
    --grep) PATTERN="$2"; shift 2;;
    --level) LEVEL="$2"; shift 2;;
    *) eyes_die "unknown arg: $1";;
  esac
done

DEV_ARGS=()
[ -n "$DEVICE" ] && DEV_ARGS+=(-s "$DEVICE")

adb "${DEV_ARGS[@]}" get-state >/dev/null 2>&1 || eyes_die "no android device/emulator connected"

FILTER=""
if [ -n "$TAG" ]; then
  FILTER="$TAG:$LEVEL *:S"
fi

# -d = dump and exit, -t N = last N lines
OUT="$(eyes_timeout 10 adb "${DEV_ARGS[@]}" logcat -d -t "$LINES" $FILTER 2>/dev/null || true)"
if [ -n "$PATTERN" ]; then
  echo "$OUT" | grep -E "$PATTERN" | eyes_redact || true
else
  echo "$OUT" | eyes_redact
fi
