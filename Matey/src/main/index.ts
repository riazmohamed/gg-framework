import { app, BrowserWindow, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const screenshotPrefix = "--matey-screenshot=";
const screenshotPath = process.argv
  .find((arg) => arg.startsWith(screenshotPrefix))
  ?.slice(screenshotPrefix.length);

import { electronApp, is, optimizer } from "@electron-toolkit/utils";

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    useContentSize: true,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: "Matey",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    if (!screenshotPath) {
      mainWindow.show();
    }
  });

  if (screenshotPath) {
    mainWindow.webContents.once("did-finish-load", () => {
      void mainWindow.webContents
        .capturePage()
        .then((image) => writeFile(screenshotPath, image.toPNG()))
        .then(() => app.quit());
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.kenkaiiii.matey");

  app.on("browser-window-created", (_event, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
