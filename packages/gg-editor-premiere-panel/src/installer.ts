import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_ID, CSXS_VERSIONS, installedPanelDir, userExtensionsDir } from "./paths.js";

/**
 * Locate the panel/ directory that ships in this package. Works whether the
 * package is consumed from npm (panel/ alongside dist/) or from the source
 * tree (panel/ alongside src/).
 */
export function panelSourceDir(): string {
  // Built file lives at dist/src/installer.js → ../../panel
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "panel"), // when built: dist/src/* → ../../panel
    resolve(here, "..", "panel"), // when run from src/* → ../panel (dev)
    resolve(here, "panel"), // safety
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "CSXS", "manifest.xml"))) return c;
  }
  throw new Error("Could not find panel/ directory in package. Searched: " + candidates.join(", "));
}

export interface InstallResult {
  installedTo: string;
  copiedFiles: number;
}

/** Recursively copy panel/ into the user's CEP extensions directory. */
export function installPanel(): InstallResult {
  const src = panelSourceDir();
  const dest = installedPanelDir();
  mkdirSync(userExtensionsDir(), { recursive: true });

  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  cpSync(src, dest, { recursive: true });

  return { installedTo: dest, copiedFiles: countFiles(dest) };
}

export function uninstallPanel(): { removed: boolean; path: string } {
  const dest = installedPanelDir();
  if (!existsSync(dest)) return { removed: false, path: dest };
  rmSync(dest, { recursive: true, force: true });
  return { removed: true, path: dest };
}

export function isPanelInstalled(): boolean {
  return existsSync(join(installedPanelDir(), "CSXS", "manifest.xml"));
}

// ── Debug-mode toggle ────────────────────────────────────────

/**
 * Unsigned CEP panels won't load unless PlayerDebugMode=1 is set per CSXS
 * version. For an alpha distribution we toggle it programmatically.
 *
 * macOS: `defaults write com.adobe.CSXS.<N> PlayerDebugMode 1`
 * Windows: registry key HKCU\Software\Adobe\CSXS.<N> → PlayerDebugMode = "1"
 */
export interface DebugModeResult {
  ok: boolean;
  perVersion: Record<string, boolean>;
  notes: string[];
}

export function enableDebugMode(): DebugModeResult {
  const perVersion: Record<string, boolean> = {};
  const notes: string[] = [];

  for (const v of CSXS_VERSIONS) {
    if (platform() === "darwin") {
      const r = spawnSync("defaults", ["write", `com.adobe.CSXS.${v}`, "PlayerDebugMode", "1"], {
        encoding: "utf8",
      });
      perVersion[v] = r.status === 0;
      if (r.status !== 0 && r.stderr) notes.push(`CSXS.${v}: ${r.stderr.trim()}`);
    } else if (platform() === "win32") {
      const r = spawnSync(
        "reg",
        [
          "ADD",
          `HKCU\\Software\\Adobe\\CSXS.${v}`,
          "/v",
          "PlayerDebugMode",
          "/t",
          "REG_SZ",
          "/d",
          "1",
          "/f",
        ],
        { encoding: "utf8", windowsHide: true },
      );
      perVersion[v] = r.status === 0;
      if (r.status !== 0 && r.stderr) notes.push(`CSXS.${v}: ${r.stderr.trim()}`);
    } else {
      perVersion[v] = false;
      notes.push(`platform ${platform()} not supported`);
    }
  }

  const ok = Object.values(perVersion).some((v) => v);
  return { ok, perVersion, notes };
}

export function disableDebugMode(): DebugModeResult {
  const perVersion: Record<string, boolean> = {};
  const notes: string[] = [];
  for (const v of CSXS_VERSIONS) {
    if (platform() === "darwin") {
      const r = spawnSync("defaults", ["delete", `com.adobe.CSXS.${v}`, "PlayerDebugMode"], {
        encoding: "utf8",
      });
      // delete returns non-zero if key didn't exist; treat as success.
      perVersion[v] = true;
      if (r.status !== 0) notes.push(`CSXS.${v}: not previously set`);
    } else if (platform() === "win32") {
      const r = spawnSync(
        "reg",
        ["DELETE", `HKCU\\Software\\Adobe\\CSXS.${v}`, "/v", "PlayerDebugMode", "/f"],
        { encoding: "utf8", windowsHide: true },
      );
      perVersion[v] = true;
      if (r.status !== 0) notes.push(`CSXS.${v}: not previously set`);
    } else {
      perVersion[v] = false;
    }
  }
  return { ok: true, perVersion, notes };
}

// ── Helpers ──────────────────────────────────────────────────

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

export { BUNDLE_ID, installedPanelDir, userExtensionsDir };
