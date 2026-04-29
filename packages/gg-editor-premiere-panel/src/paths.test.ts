import { describe, expect, it } from "vitest";
import { platform } from "node:os";
import { BUNDLE_ID, installedPanelDir, userExtensionsDir } from "./paths.js";

describe("paths", () => {
  it("BUNDLE_ID is the canonical reverse-DNS string", () => {
    expect(BUNDLE_ID).toBe("com.kenkaiiii.gg-editor-premiere-panel");
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

  it("installedPanelDir composes bundle id under extensions dir", () => {
    if (platform() === "darwin" || platform() === "win32") {
      expect(installedPanelDir()).toContain(BUNDLE_ID);
    }
  });
});
