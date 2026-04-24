#!/usr/bin/env bash
# impl: simctl
# iOS simulator log stream (last N lines).
#
# Usage:
#   logs-ios.sh [--device <udid>] [--lines N] [--grep <pattern>] [--bundle <id>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

eyes_require xcrun

DEVICE="booted"
LINES=200
PATTERN=""
BUNDLE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --device) DEVICE="$2"; shift 2;;
    --lines) LINES="$2"; shift 2;;
    --grep) PATTERN="$2"; shift 2;;
    --bundle) BUNDLE="$2"; shift 2;;
    *) eyes_die "unknown arg: $1";;
  esac
done

if [ "$DEVICE" = "booted" ]; then
  xcrun simctl list devices booted 2>/dev/null | grep -q Booted \
    || eyes_die "no iOS simulator booted"
fi

PREDICATE=""
[ -n "$BUNDLE" ] && PREDICATE="--predicate 'subsystem == \"$BUNDLE\"'"

# `log show` gives historical logs; simpler and bounded than `log stream`.
OUT="$(eyes_timeout 15 xcrun simctl spawn "$DEVICE" log show --last 3m --style compact $PREDICATE 2>/dev/null | tail -n "$LINES" || true)"
if [ -n "$PATTERN" ]; then
  echo "$OUT" | grep -E "$PATTERN" | eyes_redact || true
else
  echo "$OUT" | eyes_redact
fi
