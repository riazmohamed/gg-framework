#!/usr/bin/env bash
# Fork macOS build on this Mac, for when GitHub Actions can't run it.
# Merges Ken's upstream main into this checkout (branch og-mac, never pushed),
# builds GG Coder with the fork's app inbox, runs the inbox tests and stages the
# app. `install` swaps the staged app into /Applications, only while GG Coder is
# closed, keeping the previous app for `restore`.
#
#   fork-mac-local.sh build        merge + build + stage, if anything changed
#   fork-mac-local.sh install      install the staged build (waits for GG Coder to close)
#   fork-mac-local.sh run          what the background job runs: build at most every 3 hours, then install
#   fork-mac-local.sh restore      put the app from before the last install back
#   fork-mac-local.sh install-job  run `run` every 15 minutes (launchd)
#   fork-mac-local.sh remove-job
#
# State: ~/.gg/fork-mac (FORK_MAC_HOME). Target app: FORK_MAC_APP.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
REPO="$(cd "$(dirname "$SCRIPT")/../.." && pwd)"
STATE="${FORK_MAC_HOME:-$HOME/.gg/fork-mac}"
APP_DEST="${FORK_MAC_APP:-/Applications/GG Coder.app}"
LABEL="com.riazmohamed.gg-fork-mac"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BUILT="$REPO/gg-app/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/GG Coder.app"
mkdir -p "$STATE"

say() {
  echo "$(date '+%F %T') $1" | tee -a "$STATE/events.log"
  [[ -n "${FORK_MAC_QUIET:-}" ]] && return 0
  osascript -e "display notification \"$1\" with title \"GG Coder fork\"" >/dev/null 2>&1 || true
}

lock() {
  if ! mkdir "$STATE/lock" 2>/dev/null; then
    local holder
    holder="$(cat "$STATE/lock/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
      echo "Another fork build is running (pid $holder)"
      exit 0
    fi
    rm -rf "$STATE/lock"
    mkdir "$STATE/lock"
  fi
  echo $$ > "$STATE/lock/pid"
  trap 'rm -rf "$STATE/lock"' EXIT
}

# Run as its own process so `set -e` stops at the first failing step.
steps() {
  local version="$1"
  cd "$REPO"
  pnpm install --frozen-lockfile --prefer-offline
  pnpm build
  pnpm --filter gg-app stage:node
  pnpm --filter gg-app bundle:sidecar
  node gg-app/scripts/smoke-sidecar.mjs
  (cd packages/ggcoder && ./node_modules/.bin/vitest run src/core/app-inbox.test.ts src/app-sidecar/inbox-routes.test.ts)
  (cd gg-app && ./node_modules/.bin/vitest run src/InboxBar.test.tsx)
  # Ad-hoc: there is no Apple certificate for the fork.
  while IFS= read -r f; do
    if file "$f" | grep -q Mach-O; then
      codesign --force --options runtime --entitlements gg-app/src-tauri/entitlements.plist --sign - "$f"
    fi
  done < <(find gg-app/src-tauri/binaries gg-app/src-tauri/sidecar -type f)
  # No updater artifacts: they need the fork's private key, which is not on this Mac.
  local conf="gg-app/src-tauri/tauri.local-version.conf.json"
  printf '{"version":"%s","bundle":{"createUpdaterArtifacts":false}}\n' "$version" > "$conf"
  # Expanded now: `conf` is local and gone by the time the trap runs.
  trap "rm -f '$REPO/$conf'" EXIT
  (cd gg-app && pnpm tauri build --target aarch64-apple-darwin --bundles app \
    --config src-tauri/tauri.fork-mac.conf.json --config src-tauri/tauri.local-version.conf.json)
  codesign --verify --deep --strict "$BUILT"
}

build() {
  cd "$REPO"
  # set -e does not apply inside a function called from `||`, so every git step is checked.
  local dirty
  if ! dirty="$(git status --porcelain --untracked-files=no 2>&1)"; then
    say "Fork build skipped: git can't read $REPO ($dirty)"
    return 1
  fi
  if [[ -n "$dirty" ]]; then
    say "Fork build skipped: $REPO has uncommitted changes"
    return 1
  fi
  if ! git fetch -q --no-tags upstream main >> "$STATE/build.log" 2>&1; then
    say "Fork build skipped: couldn't fetch Ken's repo. It retries in 3 hours"
    return 1
  fi
  local ancestor=0
  git merge-base --is-ancestor upstream/main HEAD || ancestor=$?
  if (( ancestor > 1 )); then
    say "Fork build skipped: git failed comparing with Ken's repo. See $STATE/build.log"
    return 1
  fi
  if (( ancestor == 1 )); then
    if ! git merge -q --no-edit upstream/main >> "$STATE/build.log" 2>&1; then
      git merge --abort || true
      say "Ken's latest release clashes with the inbox code. Fork updates are paused until it is fixed"
      return 1
    fi
  fi
  local head
  head="$(git rev-parse HEAD)"
  if [[ "$(cat "$STATE/built-commit" 2>/dev/null || true)" == "$head" ]]; then
    echo "Up to date: the last build is already $head"
    return 0
  fi
  local upstream major minor patch n version
  upstream="$(node -p "require('./gg-app/package.json').version")"
  [[ "$upstream" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || { say "Unexpected gg-app version $upstream"; return 1; }
  major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"
  # Above the upstream version it is built on, below the next one (0.102.1 -> 0.102.101, 0.102.102).
  n=$(( $(cat "$STATE/builds-$upstream" 2>/dev/null || echo 0) + 1 ))
  (( n < 100 )) || { say "Too many fork builds on upstream $upstream"; return 1; }
  version="$major.$minor.$((patch * 100 + n))"
  echo "$(date '+%F %T') building $version (upstream $upstream, $head)" >> "$STATE/build.log"
  if ! "$SCRIPT" _steps "$version" >> "$STATE/build.log" 2>&1; then
    say "The fork build $version failed. See $STATE/build.log"
    return 1
  fi
  rm -rf "$STATE/staged"
  mkdir -p "$STATE/staged"
  ditto "$BUILT" "$STATE/staged/GG Coder.app"
  codesign --verify --deep --strict "$STATE/staged/GG Coder.app"
  echo "$version" > "$STATE/staged/version"
  echo "$head" > "$STATE/staged/commit"
  echo "$head" > "$STATE/built-commit"
  echo "$n" > "$STATE/builds-$upstream"
  echo "$(date '+%F %T') staged $version" >> "$STATE/events.log"
}

run() {
  local now last
  now="$(date +%s)"
  last="$(cat "$STATE/last-check" 2>/dev/null || echo 0)"
  # Ken's repo every 3 hours; the 15-minute runs in between only install once GG Coder is closed.
  if (( now - last >= ${FORK_MAC_CHECK_S:-10800} )); then
    echo "$now" > "$STATE/last-check"
    build || return 1
  fi
  install
}

install() {
  local staged="$STATE/staged/GG Coder.app" version
  if [[ ! -d "$staged" ]]; then
    echo "Nothing staged to install"
    return 0
  fi
  version="$(cat "$STATE/staged/version")"
  if pgrep -qf "$APP_DEST/Contents/MacOS/gg-app"; then
    if [[ ! -f "$STATE/staged/told" ]]; then
      say "GG Coder $version is ready. It installs the next time GG Coder is closed"
      touch "$STATE/staged/told"
    fi
    return 0
  fi
  rm -rf "$STATE/previous"
  if [[ -d "$APP_DEST" ]]; then
    mkdir -p "$STATE/previous"
    ditto "$APP_DEST" "$STATE/previous/GG Coder.app"
  fi
  ditto "$staged" "$APP_DEST.new"
  rm -rf "$APP_DEST"
  mv "$APP_DEST.new" "$APP_DEST"
  echo "$version" > "$STATE/installed-version"
  rm -rf "$STATE/staged"
  say "GG Coder $version with the inbox is installed"
}

restore() {
  [[ -d "$STATE/previous/GG Coder.app" ]] || { echo "No previous app to restore"; return 1; }
  if pgrep -qf "$APP_DEST/Contents/MacOS/gg-app"; then
    echo "Close GG Coder first"
    return 1
  fi
  rm -rf "$APP_DEST"
  ditto "$STATE/previous/GG Coder.app" "$APP_DEST"
  rm -f "$STATE/installed-version"
  say "The previous GG Coder is back"
}

install_job() {
  local path
  path="$(dirname "$(command -v node)"):$(dirname "$(command -v pnpm)"):$(dirname "$(command -v cargo)"):/usr/bin:/bin:/usr/sbin:/sbin"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$SCRIPT</string><string>run</string></array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$path</string></dict>
  <key>StandardOutPath</key><string>$STATE/job.log</string>
  <key>StandardErrorPath</key><string>$STATE/job.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL: checks every 15 minutes, builds at most every 3 hours"
}

remove_job() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
}

case "${1:-}" in
  build) lock; build ;;
  install) lock; install ;;
  run) lock; run ;;
  restore) lock; restore ;;
  install-job) install_job ;;
  remove-job) remove_job ;;
  _steps) steps "$2" ;;
  *) sed -n '2,15p' "$SCRIPT" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
