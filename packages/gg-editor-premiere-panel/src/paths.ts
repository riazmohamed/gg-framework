import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Cross-platform paths for CEP extension installation.
 *
 * CEP scans these directories on app launch and loads any extension that
 * matches the host's product code (PPRO for Premiere Pro).
 *
 * Per Adobe docs:
 *   - macOS: ~/Library/Application Support/Adobe/CEP/extensions/<bundleId>/
 *   - Windows: %APPDATA%\Adobe\CEP\extensions\<bundleId>\
 *   - Linux: not supported (Premiere has no Linux build)
 */

export const BUNDLE_ID = "com.kenkaiiii.gg-editor-premiere-panel";

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

/**
 * The set of CSXS minor versions to set PlayerDebugMode for. We set them
 * all so users with different Premiere versions all work.
 */
export const CSXS_VERSIONS = ["9", "10", "11", "12"];
