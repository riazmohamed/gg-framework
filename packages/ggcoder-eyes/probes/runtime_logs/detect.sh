#!/usr/bin/env bash
# Emits: {"candidates":["tail","adb-logcat","simctl","docker"], "primary":"..."}
# tail works anywhere (you give it a log path); per-platform impls layer on top.
set -euo pipefail
ROOT="${EYES_PROJECT_ROOT:-$PWD}"
CANDIDATES=()
add() { case " ${CANDIDATES[*]:-} " in *" $1 "*) return;; esac; CANDIDATES+=("$1"); }

# Android
if [ -d "$ROOT/android" ] \
   || [ -f "$ROOT/AndroidManifest.xml" ] \
   || find "$ROOT" -maxdepth 3 -name "AndroidManifest.xml" 2>/dev/null | head -1 | grep -q .; then
  add adb-logcat
fi
# iOS
if [ -d "$ROOT/ios" ] \
   || find "$ROOT" -maxdepth 2 -name "*.xcodeproj" 2>/dev/null | head -1 | grep -q . \
   || [ -f "$ROOT/Podfile" ]; then
  add simctl
fi
# Docker / compose
if [ -f "$ROOT/docker-compose.yml" ] \
   || [ -f "$ROOT/docker-compose.yaml" ] \
   || [ -f "$ROOT/compose.yml" ] \
   || [ -f "$ROOT/Dockerfile" ]; then
  add docker
fi
# Everything can use tail; include it as the catch-all last so it's not primary.
add tail

printf '{"candidates":['
first=1
for c in "${CANDIDATES[@]}"; do
  [ $first -eq 0 ] && printf ','
  printf '"%s"' "$c"
  first=0
done
printf '],"primary":"%s"}\n' "${CANDIDATES[0]}"
