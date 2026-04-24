#!/usr/bin/env bash
# Emits JSON to stdout describing which visual impls make sense for this project.
#   { "candidates": ["playwright","adb","simctl","window","godot","unity","generic"], "primary": "<first>" }
# Multi-stack projects (e.g. React Native) return multiple candidates — install all that apply.
set -euo pipefail

ROOT="${EYES_PROJECT_ROOT:-$PWD}"
CANDIDATES=()

add() {
  case " ${CANDIDATES[*]:-} " in *" $1 "*) return;; esac
  CANDIDATES+=("$1")
}

# --- Web ---
if [ -f "$ROOT/package.json" ]; then
  if grep -qE '"(next|vite|@sveltejs/kit|astro|remix|nuxt|gatsby|@angular/core|vue|svelte|solid-js|qwik|@builder\.io/qwik|react-dom)"' "$ROOT/package.json" 2>/dev/null; then
    add playwright
  fi
fi
if [ -f "$ROOT/index.html" ] || [ -f "$ROOT/public/index.html" ] || [ -f "$ROOT/dist/index.html" ]; then
  add playwright
fi
# Rails / Django / Laravel / Phoenix / etc. — any project with server-rendered HTML and a dev server
if [ -f "$ROOT/Gemfile" ] && grep -q 'rails' "$ROOT/Gemfile" 2>/dev/null; then add playwright; fi
if [ -f "$ROOT/manage.py" ] || { [ -f "$ROOT/pyproject.toml" ] && grep -qE 'django|flask|fastapi|starlette' "$ROOT/pyproject.toml" 2>/dev/null; }; then add playwright; fi
if [ -f "$ROOT/artisan" ]; then add playwright; fi
if [ -f "$ROOT/mix.exs" ] && grep -q 'phoenix' "$ROOT/mix.exs" 2>/dev/null; then add playwright; fi

# --- Mobile ---
# Android
if [ -d "$ROOT/android" ] \
   || [ -f "$ROOT/AndroidManifest.xml" ] \
   || find "$ROOT" -maxdepth 3 -name "AndroidManifest.xml" 2>/dev/null | head -1 | grep -q . \
   || { find "$ROOT" -maxdepth 3 -name "build.gradle*" 2>/dev/null | xargs grep -l 'com.android' 2>/dev/null | head -1 | grep -q .; }; then
  add adb
fi
# iOS
if [ -d "$ROOT/ios" ] \
   || find "$ROOT" -maxdepth 2 -name "*.xcodeproj" 2>/dev/null | head -1 | grep -q . \
   || find "$ROOT" -maxdepth 2 -name "*.xcworkspace" 2>/dev/null | head -1 | grep -q . \
   || [ -f "$ROOT/Podfile" ]; then
  add simctl
fi
# Flutter — has both ios/ and android/ dirs under project root; already covered.

# --- Desktop ---
if [ -f "$ROOT/src-tauri/tauri.conf.json" ] \
   || { [ -f "$ROOT/package.json" ] && grep -qE '"(electron|@electron/|nwjs|neutralinojs)"' "$ROOT/package.json" 2>/dev/null; }; then
  add window
fi
# GTK / Qt / wxWidgets
if find "$ROOT" -maxdepth 2 -name "*.pro" -o -name "CMakeLists.txt" 2>/dev/null | xargs grep -l 'Qt\|gtk\|wx' 2>/dev/null | head -1 | grep -q .; then
  add window
fi

# --- Games ---
[ -f "$ROOT/project.godot" ] && add godot
if [ -d "$ROOT/Assets" ] && [ -d "$ROOT/ProjectSettings" ]; then add unity; fi
# Unreal
if find "$ROOT" -maxdepth 2 -name "*.uproject" 2>/dev/null | head -1 | grep -q .; then add unreal; fi
# LÖVE / Pygame / Bevy / custom — fall through to window capture
if [ -f "$ROOT/main.lua" ] || { [ -f "$ROOT/Cargo.toml" ] && grep -q 'bevy' "$ROOT/Cargo.toml" 2>/dev/null; }; then
  add window
fi

# --- Fallback ---
if [ ${#CANDIDATES[@]} -eq 0 ]; then add generic; fi

# --- Emit JSON ---
printf '{"candidates":['
first=1
for c in "${CANDIDATES[@]}"; do
  [ $first -eq 0 ] && printf ','
  printf '"%s"' "$c"
  first=0
done
printf '],"primary":"%s"}\n' "${CANDIDATES[0]}"
