"use strict";

const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { webPreferencesFor } = require("./windowOptions");
const { rendererTarget } = require("./rendererTarget");

/// The renderer bundle, relative to this file in both dev and a packaged build.
const BUILT_INDEX = path.join(__dirname, "..", "..", "app", "dist", "index.html");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    webPreferences: webPreferencesFor(path.join(__dirname, "preload.js")),
  });

  const target = rendererTarget(process.env, BUILT_INDEX);
  if (target.kind === "url") {
    void mainWindow.loadURL(target.value);
  } else {
    void mainWindow.loadFile(target.value);
  }

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // A link to the wider internet opens in the user's browser, never inside the app window - an
  // in-app navigation would hand a remote page the app's own origin.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
