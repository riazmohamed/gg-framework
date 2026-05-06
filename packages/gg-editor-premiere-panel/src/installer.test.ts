import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installUxpPlugin,
  isUxpPluginInstalled,
  panelSourceDir,
  uninstallUxpPlugin,
  uxpPluginSourceDir,
} from "./installer.js";
import * as paths from "./paths.js";

describe("panelSourceDir", () => {
  it("locates the panel/ directory containing a manifest", () => {
    const dir = panelSourceDir();
    expect(existsSync(join(dir, "CSXS", "manifest.xml"))).toBe(true);
    expect(existsSync(join(dir, "index.html"))).toBe(true);
    expect(existsSync(join(dir, "lib", "server.js"))).toBe(true);
    expect(existsSync(join(dir, "jsx", "runtime.jsx"))).toBe(true);
  });
});

describe("uxpPluginSourceDir", () => {
  it("locates the panel-uxp/ directory containing a UXP manifest", () => {
    const dir = uxpPluginSourceDir();
    expect(existsSync(join(dir, "manifest.json"))).toBe(true);
    expect(existsSync(join(dir, "index.html"))).toBe(true);
    expect(existsSync(join(dir, "main.js"))).toBe(true);
  });
});

describe("UXP plugin install round-trip", () => {
  let scratch: string;

  beforeEach(() => {
    // Redirect both the parent External dir and the destination plugin dir
    // into a tempdir so the test never touches the user's real Adobe folder.
    scratch = mkdtempSync(join(tmpdir(), "gg-uxp-install-"));
    vi.spyOn(paths, "userUxpPluginsDir").mockReturnValue(scratch);
    vi.spyOn(paths, "installedUxpPluginDir").mockReturnValue(join(scratch, paths.BUNDLE_ID_UXP));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it("installs the plugin into the External dir and reports it installed", () => {
    expect(isUxpPluginInstalled()).toBe(false);
    const r = installUxpPlugin();
    expect(r.installedTo).toContain(paths.BUNDLE_ID_UXP);
    expect(r.copiedFiles).toBeGreaterThan(0);
    expect(isUxpPluginInstalled()).toBe(true);
    expect(existsSync(join(r.installedTo, "manifest.json"))).toBe(true);
  });

  it("overwrites a previous install rather than failing", () => {
    installUxpPlugin();
    // Drop a stray file in there \u2014 it should be wiped on re-install.
    const stray = join(scratch, paths.BUNDLE_ID_UXP, "stray.txt");
    writeFileSync(stray, "stale");
    installUxpPlugin();
    expect(existsSync(stray)).toBe(false);
  });

  it("uninstalls cleanly and reports state", () => {
    installUxpPlugin();
    const r = uninstallUxpPlugin();
    expect(r.removed).toBe(true);
    expect(isUxpPluginInstalled()).toBe(false);
    // Second call is a no-op.
    const r2 = uninstallUxpPlugin();
    expect(r2.removed).toBe(false);
  });
});
