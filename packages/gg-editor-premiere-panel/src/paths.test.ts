import { describe, expect, it } from "vitest";
import { platform } from "node:os";
import {
  BUNDLE_ID,
  BUNDLE_ID_UXP,
  installedPanelDir,
  installedUxpPluginDir,
  userExtensionsDir,
  userUxpPluginsDir,
} from "./paths.js";

describe("paths", () => {
  it("BUNDLE_ID is the canonical reverse-DNS string", () => {
    expect(BUNDLE_ID).toBe("com.kenkaiiii.gg-editor-premiere-panel");
  });

  it("BUNDLE_ID_UXP is distinct so CEP and UXP can coexist", () => {
    expect(BUNDLE_ID_UXP).toBe("com.kenkaiiii.gg-editor-premiere-panel.uxp");
    expect(BUNDLE_ID_UXP).not.toBe(BUNDLE_ID);
  });

  it("userExtensionsDir is platform-correct", () => {
    if (platform() === "darwin") {
      expect(userExtensionsDir()).toMatch(/Library\/Application Support\/Adobe\/CEP\/extensions$/);
    } else if (platform() === "win32") {
      expect(userExtensionsDir()).toMatch(/Adobe[\\/]CEP[\\/]extensions$/);
    } else {
      expect(() => userExtensionsDir()).toThrow();
    }
  });

  it("userUxpPluginsDir is platform-correct", () => {
    if (platform() === "darwin") {
      expect(userUxpPluginsDir()).toMatch(
        /Library\/Application Support\/Adobe\/UXP\/Plugins\/External$/,
      );
    } else if (platform() === "win32") {
      expect(userUxpPluginsDir()).toMatch(/Adobe[\\/]UXP[\\/]Plugins[\\/]External$/);
    } else {
      expect(() => userUxpPluginsDir()).toThrow();
    }
  });

  it("installedPanelDir composes bundle id under extensions dir", () => {
    if (platform() === "darwin" || platform() === "win32") {
      expect(installedPanelDir()).toContain(BUNDLE_ID);
    }
  });

  it("installedUxpPluginDir composes UXP bundle id under External dir", () => {
    if (platform() === "darwin" || platform() === "win32") {
      const dir = installedUxpPluginDir();
      expect(dir).toContain(BUNDLE_ID_UXP);
      expect(dir).toMatch(/UXP[\\/]Plugins[\\/]External/);
    }
  });
});
