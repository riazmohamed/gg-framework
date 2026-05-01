export {
  BUNDLE_ID,
  disableDebugMode,
  enableDebugMode,
  installedPanelDir,
  installPanel,
  isPanelInstalled,
  panelSourceDir,
  uninstallPanel,
  userExtensionsDir,
} from "./installer.js";
export type { DebugModeResult, InstallResult } from "./installer.js";
export const PANEL_DEFAULT_PORT = 7437;
