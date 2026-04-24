#!/usr/bin/env bash
# test.sh — send a real message via SMTP to the running mailpit, then verify
# the probe can list/read it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../shared/_lib.sh"

PROBE="$(eyes_root)/mail.sh"
[ -x "$PROBE" ] || eyes_die "probe not installed"

SMTP_PORT="$(eyes_state_get mailpit.smtp_port)"
HTTP_PORT="$(eyes_state_get mailpit.http_port)"
[ -n "$SMTP_PORT" ] && [ -n "$HTTP_PORT" ] || eyes_die "mailpit state missing; re-run install"

curl -sf "http://127.0.0.1:$HTTP_PORT/api/v1/info" >/dev/null \
  || eyes_die "mailpit not responding; run install.sh"

# Clear any prior messages
"$PROBE" clear >/dev/null

# Send via python smtplib (universal, no extra deps)
eyes_require python3
python3 - <<PY
import smtplib
from email.message import EmailMessage
m = EmailMessage()
m["Subject"] = "eyes-test"
m["From"] = "probe@eyes.test"
m["To"] = "user@eyes.test"
m.set_content("hello from the eyes probe self-test. reset link: https://example.com/reset?token=sk-proj-secretxxxxxxxxxxxxx")
with smtplib.SMTP("127.0.0.1", $SMTP_PORT, timeout=5) as s:
    s.send_message(m)
PY

# Verify probe sees it
COUNT="$("$PROBE" count)"
[ "$COUNT" -ge 1 ] || eyes_die "expected >=1 message, got $COUNT"

LATEST="$("$PROBE" latest)"
echo "$LATEST" | grep -q 'eyes-test' || eyes_die "latest did not include our subject: $LATEST"
echo "$LATEST" | grep -q 'REDACTED_OPENAI' || eyes_die "redactor did not scrub the fake token in the email body"

echo "ok"
