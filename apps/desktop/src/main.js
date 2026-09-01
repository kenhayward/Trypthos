"use strict";

const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { webPreferencesFor } = require("./windowOptions");
const { rendererTarget } = require("./rendererTarget");
const { builtIndexPath } = require("./builtIndex");
const { nextRetryDelayMs } = require("./devReload");

let mainWindow = null;
let loadAttempt = 0;
let retryTimer = null;

function loadRenderer(window) {
  const target = rendererTarget(
    process.env,
    builtIndexPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      shellDir: __dirname,
    }),
  );

  if (target.kind === "url") {
    return window.loadURL(target.value);
  }
  return window.loadFile(target.value);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: webPreferencesFor(path.join(__dirname, "preload.js")),
  });

  // In development the shell and the Vite server start together, so the shell routinely wins the
  // race. Retrying turns "blank window, no explanation" into "appears a moment later", and also
  // covers restarting the dev server while the shell stays open.
  mainWindow.webContents.on("did-fail-load", () => {
    if (!mainWindow) return;

    const delay = nextRetryDelayMs(loadAttempt, {});
    if (delay === null) {
      console.error("Giving up loading the renderer after %d attempts.", loadAttempt);
      return;
    }

    loadAttempt += 1;
    retryTimer = setTimeout(() => {
      if (mainWindow) void loadRenderer(mainWindow);
    }, delay);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    loadAttempt = 0;
  });

  void loadRenderer(mainWindow);

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on("closed", () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
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
