#!/usr/bin/env bash
# install.sh <impl> [--as <name>]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../../shared/_lib.sh"

IMPL="${1:-}"
[ -z "$IMPL" ] && eyes_die "usage: install.sh <impl> [--as <name>]"
shift
NAME="logs"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --as) NAME="$2"; shift 2;;
    *) eyes_die "unknown arg: $1";;
  esac
done

IMPL_FILE="$HERE/impl/$IMPL.sh"
[ -f "$IMPL_FILE" ] || eyes_die "no impl: $IMPL"

case "$IMPL" in
  adb-logcat) eyes_require adb;;
  simctl)     [ "$(eyes_os)" = "darwin" ] || eyes_die "simctl only on macOS"; eyes_require xcrun;;
  docker)     eyes_require docker;;
  tail)       : ;;
  *) eyes_die "unknown impl: $IMPL";;
esac

DEST="$(eyes_root)/$NAME.sh"
cp "$IMPL_FILE" "$DEST"
chmod +x "$DEST"
cp "$HERE/../../shared/_lib.sh" "$(eyes_root)/_lib.sh"
cp "$HERE/../../shared/_redact.sh" "$(eyes_root)/_redact.sh"
chmod +x "$(eyes_root)/_redact.sh"

echo "EYES_INSTALLED=$DEST"
echo "installed: $DEST (impl=$IMPL)" >&2
