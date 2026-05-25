import { contextBridge } from "electron";

import { electronAPI } from "@electron-toolkit/preload";

const mateyAPI = {
  getAppName: (): string => "Matey",
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electron", electronAPI);
  contextBridge.exposeInMainWorld("matey", mateyAPI);
}
