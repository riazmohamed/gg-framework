#!/usr/bin/env bash
# capture_email/install.sh [impl]
# Installs Mailpit — a local SMTP sink + HTTP UI that any app can point at
# (Node/Python/Ruby/Go/Java/PHP/.NET — anything speaking SMTP works).
#
# After install you must configure your app's SMTP settings:
#   host=127.0.0.1  port=<smtp_port>  user=""  pass=""  tls=off
# Ports are written to .gg/eyes/state/mailpit.smtp_port and .gg/eyes/state/mailpit.http_port.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../shared/_lib.sh"

IMPL="${1:-mailpit}"
[ "$IMPL" = "mailpit" ] || eyes_die "only 'mailpit' impl is provided"

# Resolve or install binary into .gg/eyes/bin/mailpit
BIN="$(eyes_bin_dir)/mailpit"
if [ ! -x "$BIN" ]; then
  if command -v mailpit >/dev/null 2>&1; then
    ln -sf "$(command -v mailpit)" "$BIN"
  elif [ "$(eyes_os)" = "darwin" ] && command -v brew >/dev/null 2>&1; then
    brew install mailpit >&2 || eyes_die "brew install mailpit failed"
    ln -sf "$(command -v mailpit)" "$BIN"
  else
    # Download a release binary from github
    OS="$(eyes_os)"; ARCH="$(eyes_arch)"
    case "$OS-$ARCH" in
      darwin-amd64|darwin-arm64|linux-amd64|linux-arm64) : ;;
      *) eyes_die "no prebuilt mailpit for $OS-$ARCH; install manually and re-run";;
    esac
    URL="https://github.com/axllent/mailpit/releases/latest/download/mailpit-${OS}-${ARCH}.tar.gz"
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
    echo "downloading mailpit ($OS-$ARCH)..." >&2
    eyes_timeout 60 curl -sSL -o "$TMP/mp.tgz" "$URL" || eyes_die "download failed: $URL"
    tar -xzf "$TMP/mp.tgz" -C "$TMP" || eyes_die "extract failed"
    cp "$TMP/mailpit" "$BIN"
    chmod +x "$BIN"
  fi
fi

# Allocate ports if not already allocated, then (re)start
SMTP_PORT="$(eyes_state_get mailpit.smtp_port)"
HTTP_PORT="$(eyes_state_get mailpit.http_port)"
[ -n "$SMTP_PORT" ] || SMTP_PORT="$(eyes_free_port)"
[ -n "$HTTP_PORT" ] || HTTP_PORT="$(eyes_free_port)"
eyes_state_set mailpit.smtp_port "$SMTP_PORT"
eyes_state_set mailpit.http_port "$HTTP_PORT"

# Stop any prior instance
OLD_PID="$(eyes_state_get mailpit.pid)"
if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
  kill -TERM "$OLD_PID" 2>/dev/null || true
  sleep 0.3
fi

LOG="$(eyes_out_dir)/mailpit.log"
nohup "$BIN" --smtp "127.0.0.1:$SMTP_PORT" --listen "127.0.0.1:$HTTP_PORT" --quiet >"$LOG" 2>&1 &
NEW_PID=$!
eyes_state_set mailpit.pid "$NEW_PID"

# Wait for HTTP port
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -sf "http://127.0.0.1:$HTTP_PORT/api/v1/info" >/dev/null 2>&1 && break
  sleep 0.3
done
curl -sf "http://127.0.0.1:$HTTP_PORT/api/v1/info" >/dev/null 2>&1 \
  || eyes_die "mailpit did not come up; see $LOG"

# Install the probe script
DEST="$(eyes_root)/mail.sh"
cp "$HERE/impl/mailpit.sh" "$DEST"
chmod +x "$DEST"
cp "$HERE/../../shared/_lib.sh" "$(eyes_root)/_lib.sh"
cp "$HERE/../../shared/_redact.sh" "$(eyes_root)/_redact.sh"
chmod +x "$(eyes_root)/_redact.sh"

echo "EYES_INSTALLED=$DEST"

cat >&2 <<EOF
mailpit running:
  SMTP: 127.0.0.1:$SMTP_PORT    (point your app here)
  HTTP: http://127.0.0.1:$HTTP_PORT
  PID:  $NEW_PID
  probe: $DEST  (subcommands: list, count, latest, read <id>, clear)
EOF
