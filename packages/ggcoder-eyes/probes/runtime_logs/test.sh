#!/usr/bin/env bash
# test.sh [name]
# Tail-based e2e: write a known line to a temp file, tail --since-start, confirm we see it.
# For adb-logcat / simctl / docker we just verify the tool responds (no target to guarantee).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../shared/_lib.sh"

NAME="${1:-logs}"
PROBE="$(eyes_root)/$NAME.sh"
[ -x "$PROBE" ] || eyes_die "probe not installed: $PROBE"

IMPL_HINT="$(grep -m1 '^# impl:' "$PROBE" | awk '{print $3}' || true)"

case "$IMPL_HINT" in
  tail)
    TMP="$(mktemp)"
    trap 'rm -f "$TMP"' EXIT
    printf 'line1\nline2 sk-proj-should-redact-xxxxxxxxx\nline3\n' > "$TMP"
    OUT="$("$PROBE" --file "$TMP" --lines 3)"
    echo "$OUT" | grep -q 'line3' || eyes_die "tail probe did not return tail of file"
    echo "$OUT" | grep -q 'REDACTED_OPENAI' || eyes_die "tail probe did not redact"
    echo "ok"
    ;;
  adb-logcat)
    adb get-state >/dev/null 2>&1 || eyes_die "no android device; cannot verify"
    "$PROBE" --lines 5 >/dev/null
    echo "ok"
    ;;
  simctl)
    xcrun simctl list devices booted 2>/dev/null | grep -q Booted || eyes_die "no iOS simulator booted"
    "$PROBE" --lines 5 >/dev/null
    echo "ok"
    ;;
  docker)
    docker ps >/dev/null 2>&1 || eyes_die "docker not running; cannot verify"
    # Find any running container to tail
    C="$(docker ps --format '{{.Names}}' | head -1 || true)"
    [ -n "$C" ] || { echo "ok (no containers to tail, but docker works)"; exit 0; }
    "$PROBE" "$C" --lines 3 >/dev/null
    echo "ok"
    ;;
  *) eyes_die "unknown impl hint: $IMPL_HINT";;
esac
