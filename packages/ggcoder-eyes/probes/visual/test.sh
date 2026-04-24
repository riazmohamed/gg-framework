#!/usr/bin/env bash
# test.sh [name]
# End-to-end self-test: invoke the installed probe against a real target, verify
# the artifact is a non-empty PNG. For impls with no always-available target
# (adb, simctl), degrade to "can the tool talk to a device?" — still real, just
# less coverage.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../shared/_lib.sh"

NAME="${1:-visual}"
PROBE="$(eyes_root)/$NAME.sh"
[ -x "$PROBE" ] || eyes_die "probe not installed: $PROBE"

# Infer impl from the first-line comment or script contents
IMPL_HINT="$(grep -m1 '^# impl:' "$PROBE" | awk '{print $3}' || true)"
[ -z "$IMPL_HINT" ] && IMPL_HINT="$(basename "$PROBE" .sh)"

case "$IMPL_HINT" in
  playwright|visual)
    # Spin up a temp static server on a free port, screenshot it.
    PORT="$(eyes_free_port)"
    TMPDIR="$(mktemp -d)"
    trap 'rm -rf "$TMPDIR"; [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true' EXIT
    cat > "$TMPDIR/index.html" <<'HTML'
<!doctype html><html><head><title>eyes-test</title></head>
<body style="background:#222;color:#0f0;font:48px monospace;padding:2em">
  EYES PROBE OK
</body></html>
HTML
    ( cd "$TMPDIR" && python3 -m http.server "$PORT" >/dev/null 2>&1 ) & SRV_PID=$!
    # Wait for server
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break
      sleep 0.3
    done
    OUT="$("$PROBE" "http://127.0.0.1:$PORT/")"
    [ -f "$OUT" ] && [ -s "$OUT" ] || eyes_die "probe produced no artifact: $OUT"
    echo "ok: $OUT"
    ;;
  adb)
    adb devices | tail -n +2 | grep -q device || eyes_die "no android device connected; skipping e2e — install succeeded but cannot verify"
    OUT="$("$PROBE")"
    [ -s "$OUT" ] || eyes_die "adb probe produced empty artifact"
    echo "ok: $OUT"
    ;;
  simctl)
    xcrun simctl list devices booted 2>/dev/null | grep -q Booted || eyes_die "no iOS simulator booted; cannot verify"
    OUT="$("$PROBE")"
    [ -s "$OUT" ] || eyes_die "simctl probe produced empty artifact"
    echo "ok: $OUT"
    ;;
  window|godot|unity|unreal|generic)
    # Best-effort: just run the probe; 'generic' exits non-zero by design.
    set +e
    OUT="$("$PROBE" 2>&1)"; rc=$?
    set -e
    if [ "$IMPL_HINT" = "generic" ]; then
      [ "$rc" -ne 0 ] || eyes_die "generic probe should exit non-zero"
      echo "ok (generic: no-op)"
    else
      [ "$rc" -eq 0 ] || eyes_die "probe failed: $OUT"
      echo "ok: $OUT"
    fi
    ;;
  *)
    eyes_die "unknown impl hint: $IMPL_HINT"
    ;;
esac
