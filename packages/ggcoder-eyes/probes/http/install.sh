#!/usr/bin/env bash
# http/install.sh [impl]
# Only one impl (curl). Copies it into .gg/eyes/http.sh.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../shared/_lib.sh"

IMPL="${1:-curl}"
[ "$IMPL" = "curl" ] || eyes_die "only 'curl' impl exists for http"
eyes_require curl

DEST="$(eyes_root)/http.sh"
cp "$HERE/impl/curl.sh" "$DEST"
chmod +x "$DEST"
cp "$HERE/../../shared/_lib.sh" "$(eyes_root)/_lib.sh"
cp "$HERE/../../shared/_redact.sh" "$(eyes_root)/_redact.sh"
chmod +x "$(eyes_root)/_redact.sh"

echo "EYES_INSTALLED=$DEST"
echo "installed: $DEST (impl=curl)" >&2
