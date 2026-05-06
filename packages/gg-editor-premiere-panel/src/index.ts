export {
  BUNDLE_ID,
  BUNDLE_ID_UXP,
  disableDebugMode,
  enableDebugMode,
  installCepPanel,
  installPanel,
  installUxpPlugin,
  installedPanelDir,
  installedUxpPluginDir,
  isCepPanelInstalled,
  isPanelInstalled,
  isUxpPluginInstalled,
  panelSourceDir,
  uninstallCepPanel,
  uninstallPanel,
  uninstallUxpPlugin,
  userExtensionsDir,
  userUxpPluginsDir,
  uxpPluginSourceDir,
} from "./installer.js";
export type { DebugModeResult, InstallResult } from "./installer.js";
export const PANEL_DEFAULT_PORT = 7437;
