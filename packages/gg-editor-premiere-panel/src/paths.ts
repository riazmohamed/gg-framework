import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Cross-platform paths for the gg-editor Premiere extensions.
 *
 * Two distinct extension formats live side-by-side; users on Premiere 25.6+
 * should prefer UXP (the only path that survives Adobe's September 2026
 * ExtendScript sunset). Both panels can be installed at once — they have
 * different bundle ids and don't conflict.
 *
 * CEP install locations (Adobe docs):
 *   - macOS: ~/Library/Application Support/Adobe/CEP/extensions/<bundleId>/
 *   - Windows: %APPDATA%\Adobe\CEP\extensions\<bundleId>\
 *
 * UXP install locations (Adobe UXP Developer Tool docs, "External" plugins):
 *   - macOS: ~/Library/Application Support/Adobe/UXP/Plugins/External/<bundleId>/
 *   - Windows: %APPDATA%\Adobe\UXP\Plugins\External\<bundleId>\
 *
 * Linux is unsupported on either path — Premiere has no Linux build.
 */

export const BUNDLE_ID = "com.kenkaiiii.gg-editor-premiere-panel";
export const BUNDLE_ID_UXP = "com.kenkaiiii.gg-editor-premiere-panel.uxp";

export function userExtensionsDir(): string {
  switch (platform()) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions");
    case "win32":
      return process.env.APPDATA
        ? join(process.env.APPDATA, "Adobe", "CEP", "extensions")
        : join(homedir(), "AppData", "Roaming", "Adobe", "CEP", "extensions");
    default:
      throw new Error(
        `CEP panels are only supported on macOS and Windows (got ${platform()}). ` +
          `Premiere has no Linux build.`,
      );
  }
}

export function installedPanelDir(): string {
  return join(userExtensionsDir(), BUNDLE_ID);
}

export function userUxpPluginsDir(): string {
  switch (platform()) {
    case "darwin":
      return join(
        homedir(),
        "Library",
        "Application Support",
        "Adobe",
        "UXP",
        "Plugins",
        "External",
      );
    case "win32":
      return process.env.APPDATA
        ? join(process.env.APPDATA, "Adobe", "UXP", "Plugins", "External")
        : join(homedir(), "AppData", "Roaming", "Adobe", "UXP", "Plugins", "External");
    default:
      throw new Error(
        `UXP plugins are only supported on macOS and Windows (got ${platform()}). ` +
          `Premiere has no Linux build.`,
      );
  }
}

export function installedUxpPluginDir(): string {
  return join(userUxpPluginsDir(), BUNDLE_ID_UXP);
}

/**
 * The set of CSXS minor versions to set PlayerDebugMode for. We set them
 * all so users with different Premiere versions all work.
 */
export const CSXS_VERSIONS = ["9", "10", "11", "12"];
