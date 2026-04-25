#!/usr/bin/env bash
# http/test.sh
# Spin up a minimal local server, hit it with the probe, verify JSON output
# describes the response.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../shared/_lib.sh"

PROBE="$(eyes_root)/http.sh"
[ -x "$PROBE" ] || eyes_die "probe not installed: $PROBE"

eyes_require python3
PORT="$(eyes_free_port)"
python3 -c "
import http.server, socketserver, json, threading
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('content-type','application/json'); self.end_headers()
        self.wfile.write(b'{\"ok\":true,\"token\":\"sk-proj-test-secret-xyz-1234567890\"}')
    def log_message(self, *a): pass
s = socketserver.TCPServer(('127.0.0.1', $PORT), H); threading.Thread(target=s.serve_forever, daemon=True).start()
import time; time.sleep(30)
" &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null || true' EXIT

for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break
  sleep 0.3
done

OUT_JSON="$("$PROBE" "http://127.0.0.1:$PORT/health")"
echo "$OUT_JSON" | grep -q '"status":200' || eyes_die "expected status 200, got: $OUT_JSON"

# Validate redactor ran on body
BODY_PATH="$(echo "$OUT_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["body"])')"
grep -q 'REDACTED_OPENAI' "$BODY_PATH" || eyes_die "redactor did not scrub the fake sk- token in body: $BODY_PATH"

echo "ok: $OUT_JSON"
