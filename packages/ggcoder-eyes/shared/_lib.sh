#!/usr/bin/env bash
# _lib.sh — shared helpers for all probes.
# Probes source this AFTER being copied into .gg/eyes/ as .gg/eyes/_lib.sh.
# Usage at top of probe:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/_lib.sh"

eyes_project_root() {
  if [ -n "${EYES_PROJECT_ROOT:-}" ]; then echo "$EYES_PROJECT_ROOT"; return; fi
  local d="$PWD"
  while [ "$d" != "/" ]; do
    if [ -d "$d/.gg" ]; then echo "$d"; return; fi
    d="$(dirname "$d")"
  done
  echo "$PWD"
}

eyes_root()      { echo "$(eyes_project_root)/.gg/eyes"; }
eyes_out_dir()   { local d; d="$(eyes_root)/out";   mkdir -p "$d"; echo "$d"; }
eyes_state_dir() { local d; d="$(eyes_root)/state"; mkdir -p "$d"; echo "$d"; }
eyes_bin_dir()   { local d; d="$(eyes_root)/bin";   mkdir -p "$d"; echo "$d"; }

eyes_timestamp() { date -u +"%Y%m%dT%H%M%SZ"; }

eyes_die() {
  printf 'eyes: %s\n' "$*" >&2
  exit 1
}

eyes_require() {
  command -v "$1" >/dev/null 2>&1 || eyes_die "missing required command: $1"
}

eyes_os() {
  case "$(uname -s)" in
    Darwin) echo "darwin";;
    Linux)  echo "linux";;
    MINGW*|MSYS*|CYGWIN*) echo "windows";;
    *) echo "unknown";;
  esac
}

eyes_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64";;
    arm64|aarch64) echo "arm64";;
    *) echo "unknown";;
  esac
}

eyes_free_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()' 2>/dev/null \
    || node -e 'const s=require("net").createServer(); s.listen(0,()=>{console.log(s.address().port); s.close();})' 2>/dev/null \
    || eyes_die "need python3 or node to pick a free port"
}

eyes_state_get() {
  local f; f="$(eyes_state_dir)/$1"
  if [ -f "$f" ]; then cat "$f"; else echo ""; fi
}

eyes_state_set() {
  local f; f="$(eyes_state_dir)/$1"
  printf '%s' "$2" > "$f"
}

eyes_redact() {
  # Pipe through: cmd | eyes_redact > out
  local r; r="$(eyes_root)/_redact.sh"
  if [ -x "$r" ]; then "$r"; else cat; fi
}

# With-timeout wrapper that works on macOS (no `timeout` by default) and Linux.
eyes_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    # Fallback: run in background, kill after secs
    ( "$@" ) & local pid=$!
    ( sleep "$secs" && kill -TERM "$pid" 2>/dev/null ) & local killer=$!
    wait "$pid" 2>/dev/null; local rc=$?
    kill -TERM "$killer" 2>/dev/null || true
    return $rc
  fi
}
