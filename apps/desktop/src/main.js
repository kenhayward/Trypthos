"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} = require("electron");
const path = require("node:path");
const { webPreferencesFor } = require("./windowOptions");
const { rendererTarget } = require("./rendererTarget");
const { builtIndexPath } = require("./builtIndex");
const { nextRetryDelayMs } = require("./devReload");
const { WINDOW_STATE_CHANNEL } = require("@trypthos/domain");
const { registerIpcHandlers } = require("./ipcHandlers");
const { createSecretStore } = require("./secretStore");
const { createChatProvider } = require("./chatProvider");
const { chromeOptionsFor } = require("./windowChrome");
const { registerWindowHandlers } = require("./windowHandlers");
const { createUpdater } = require("./updater");
const { createTray } = require("./tray");
const { readCloseToTray, onSettingsWritten } = require("./settingsStore");

let mainWindow = null;
/// Held for the lifetime of the app. A Tray that is garbage collected disappears from the
/// notification area, which looks exactly like the feature never having worked - so the reference
/// exists to be kept, not to be read.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tray = null;
let updater = null;
/// Set only by an explicit quit - the tray's Quit, or the OS asking. Without it, close-to-tray would
/// make the app unquittable: every close would hide the window, including the one during shutdown.
let quitting = false;
/// Mirrored from settings so the close handler can answer immediately. Re-read on every write, since
/// the preference can change while the window is open.
let closeToTray = false;
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
    // Painted before the renderer loads, so the frameless window does not flash white on a dark
    // system while the first paint is in flight.
    backgroundColor: "#111827",
    ...chromeOptionsFor(process.platform),
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

  // The maximise button has to show the right glyph, and the window can be maximised by ways the
  // renderer never sees - a double-click on the bar, the OS snap gesture, a keyboard shortcut. So the
  // state is pushed rather than asked for.
  const pushWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(WINDOW_STATE_CHANNEL, { maximized: mainWindow.isMaximized() });
  };
  mainWindow.on("maximize", pushWindowState);
  mainWindow.on("unmaximize", pushWindowState);
  mainWindow.webContents.on("did-finish-load", pushWindowState);

  mainWindow.on("close", (event) => {
    if (!closeToTray || quitting) return;
    // Hidden rather than closed, so reopening from the tray is instant and the document survives.
    event.preventDefault();
    mainWindow.hide();
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

/// Must match `appId` in electron-builder.config.cjs.
///
/// Windows will not display a toast unless the process's App User Model ID matches that of a Start
/// Menu shortcut, and the installer sets the shortcut's to the appId. Without this Electron derives
/// an identity from the executable, the two do not match, and every notification is dropped -
/// silently, with no error and nothing shown. Not needed on macOS, which has no such concept.
const APP_USER_MODEL_ID = "com.trypthos.app";
if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    // safeStorage is only usable after the app is ready, which is why the store is built here
    // rather than at module load. DPAPI on Windows, the Keychain on macOS.
    const secrets = createSecretStore({
      userDataDir: app.getPath("userData"),
      encryptor: safeStorage,
    });

    registerIpcHandlers({
      ipcMain,
      dialog,
      getWindow: () => mainWindow,
      userDataDir: app.getPath("userData"),
      secrets,
      // The provider call lives here and only here. The renderer never opens a socket to a provider
      // and never holds the key.
      chat: createChatProvider({ secrets }),
    });
    registerWindowHandlers({ ipcMain, getWindow: () => mainWindow });

    updater = createUpdater({
      app,
      dialog,
      shell,
      Notification,
      getWindow: () => mainWindow,
    });

    tray = createTray({
      Tray,
      Menu,
      app,
      updater,
      getWindow: () => mainWindow,
      // Packed as extraResources, so it sits beside the app rather than inside the asar - a Tray
      // cannot read an icon from an archive.
      iconDir: app.isPackaged ? path.join(process.resourcesPath, "build") : path.join(__dirname, "..", "build"),
    });

    updater.start();

    // The shell needs this at close time, and the renderer owns the settings file - so main reads it
    // once at startup and is told about later changes rather than re-reading the file on every close.
    closeToTray = await readCloseToTray(app.getPath("userData"));
    onSettingsWritten((settings) => {
      closeToTray = settings.window.closeToTray;
    });
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("window-all-closed", () => {
    // With close-to-tray on, the window is hidden rather than closed, so this does not fire - which
    // is what keeps the app alive in the tray.
    if (process.platform !== "darwin") app.quit();
  });
}
