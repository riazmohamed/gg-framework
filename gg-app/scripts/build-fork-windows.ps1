<#
.SYNOPSIS
  Fork-only: build the signed OG Coder Windows installer locally, the same steps
  release-windows.yml runs, and optionally install it.

.DESCRIPTION
  Run from the Windows checkout (C:\Users\riaza\gg-framework) on branch `windows`.
  Fails fast on a dirty tree, a commit not on origin/windows, a missing signing
  key, or any failing step. Signing material is read from
  %USERPROFILE%\.gg-signing and only passed to tauri through the environment.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File gg-app\scripts\build-fork-windows.ps1 -Version 0.117.101 -Install
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [switch]$Install
)

$ErrorActionPreference = "Stop"

function Invoke-Step([string]$Name, [scriptblock]$Command) {
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "Step failed ($LASTEXITCODE): $Name" }
}

# Version scheme: upstream major.minor, patch = upstream_patch * 100 + fork build.
$Version = $Version.Trim()
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 0.117.101, got '$Version'" }

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

# `rustc --print host-tuple` (stage:node) and cargo must be reachable.
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

Invoke-Step "git fetch origin windows" { git fetch --no-tags origin windows }
if (git status --porcelain) { throw "Working tree is dirty; commit or stash first." }
git merge-base --is-ancestor HEAD origin/windows
if ($LASTEXITCODE -ne 0) { throw "HEAD is not on origin/windows; push it first." }

$keyFile = Join-Path $env:USERPROFILE ".gg-signing\og-coder-updater.key"
$passFile = Join-Path $env:USERPROFILE ".gg-signing\og-coder-updater.password"
foreach ($f in @($keyFile, $passFile)) {
  if (-not (Test-Path $f)) { throw "Missing signing file: $f (losing the key strands installed apps)" }
}
$env:TAURI_SIGNING_PRIVATE_KEY = $keyFile
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -Raw $passFile).Trim()

# Outside the repo so the tree stays clean (release-windows.yml writes it in-tree on CI).
$versionConf = Join-Path $env:TEMP "tauri.release-version.conf.json"
Set-Content -Path $versionConf -Value ('{"version":"' + $Version + '"}') -Encoding ascii

try {
  # Frozen: a non-frozen install on Windows rewrites pnpm-lock.yaml (see DISTRIBUTION.md).
  Invoke-Step "pnpm install --frozen-lockfile" { pnpm install --frozen-lockfile }
  Invoke-Step "pnpm build" { pnpm build }
  Invoke-Step "stage node runtime" { pnpm --filter gg-app stage:node }
  Invoke-Step "bundle sidecar" { pnpm --filter gg-app bundle:sidecar }
  Invoke-Step "installer art" { pnpm --filter gg-app installer:art }
  Invoke-Step "sidecar smoke" { node gg-app/scripts/smoke-sidecar.mjs }
  Invoke-Step "tauri build (NSIS, fork-signed, $Version)" {
    pnpm --filter gg-app tauri build --bundles nsis `
      --config src-tauri/tauri.fork-release.conf.json `
      --config $versionConf
  }
} finally {
  Remove-Item $versionConf -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$nsisDir = Join-Path $repo "gg-app\src-tauri\target\release\bundle\nsis"
$installer = Get-ChildItem $nsisDir -Filter "*_${Version}_x64-setup.exe" | Select-Object -First 1
if (-not $installer) { throw "No installer for $Version under $nsisDir" }
$hash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLower()
Write-Host "Installer: $($installer.FullName)" -ForegroundColor Green
Write-Host "SHA256:    $hash"

if ($Install) {
  if (Get-Process gg-app -ErrorAction SilentlyContinue) {
    throw "OG Coder is running; close it, then run the installer: $($installer.FullName) /S"
  }
  Write-Host "==> installing (per-user, silent)" -ForegroundColor Cyan
  $proc = Start-Process -FilePath $installer.FullName -ArgumentList "/S" -Wait -PassThru
  if ($proc.ExitCode -ne 0) { throw "Installer exited with $($proc.ExitCode)" }
  $exe = Join-Path $env:LOCALAPPDATA "GG Coder\gg-app.exe"
  Write-Host "Installed: $((Get-Item $exe).VersionInfo.ProductVersion)" -ForegroundColor Green
}
