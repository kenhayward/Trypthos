"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  net,
  safeStorage,
  shell,
} = require("electron");
const {
  MENU_ACTION_CHANNEL,
  OPEN_TARGET_CHANNEL,
  PopupMenuRequest,
  isExternalUrl,
} = require("@trypthos/domain");
const path = require("node:path");
const { webPreferencesFor } = require("./windowOptions");
const { rendererTarget } = require("./rendererTarget");
const { navigationDecision } = require("./navigationGuard");
const { builtIndexPath } = require("./builtIndex");
const { nextRetryDelayMs, shouldRetryLoad } = require("./devReload");
const { WINDOW_STATE_CHANNEL } = require("@trypthos/domain");
const {
  registerIpcHandlers,
  pasteMarkdownLabelFor,
  forgetPasteMarkdownContext,
} = require("./ipcHandlers");
const { createSecretStore } = require("./secretStore");
const { createAccountStore } = require("./accountStore");
const { createGitHubApi } = require("./githubApi");
const { createChatProvider } = require("./chatProvider");
const { appMenuTemplate, contextMenuTemplate, popupTemplate } = require("./menus");
const { enableSpellChecker } = require("./spellcheck");
const { APP_NAME } = require("./appName");
const { chromeOptionsFor } = require("./windowChrome");
const { registerWindowHandlers } = require("./windowHandlers");
const { closeDecision, createCloseGuard } = require("./closeGuard");
const { createDocumentHandoff } = require("./documentHandoff");
const { createUpdater } = require("./updater");
const { createTray } = require("./tray");
const { revealWindow } = require("./revealWindow");
const { createExplorerIntegration } = require("./explorerIntegration");
const { pathFromArgv, resolveTarget } = require("./launchTarget");
const { readCloseToTray, onSettingsWritten, readSettings } = require("./settingsStore");

let mainWindow = null;
/// Each document-only window needs its own dirty bit and close permission. Holding them by window
/// means the shared IPC handlers can route an event back to the renderer that sent it.
const documentGuards = new Map();
/// Unsaved text travelling from a tab into a document window of its own. See `documentHandoff.js`.
const documentHandoff = createDocumentHandoff();

/// Unsaved work, and whether the window may close on it. Built once and shared: the close listener
/// reads it, and the document channels write to it. See `closeGuard.js` for the split.
const closeGuard = createCloseGuard({
  dialog,
  send: (channel, payload) => mainWindow?.webContents.send(channel, payload),
});
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
/// True once the renderer has loaded successfully at least once.
///
/// What separates "the dev server is not up yet" from "a running app just had a load fail". The
/// first is worth retrying; the second must never reload the window, because that discards the
/// user's open tabs and any unsaved work.
let hasLoaded = false;

function loadRenderer(window, documentTarget = null) {
  const target = rendererTarget(
    process.env,
    builtIndexPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      shellDir: __dirname,
    }),
  );

  if (target.kind === "url") {
    if (documentTarget === null) return window.loadURL(target.value);
    const url = new URL(target.value);
    url.searchParams.set("view", "document");
    url.searchParams.set("root", documentTarget.root);
    url.searchParams.set("file", documentTarget.file);
    return window.loadURL(url.toString());
  }
  if (documentTarget === null) return window.loadFile(target.value);
  return window.loadFile(target.value, {
    query: { view: "document", root: documentTarget.root, file: documentTarget.file },
  });
}

/// A link belongs in the system browser. Shared by the main window and a focused document window:
/// a second renderer has the same isolation boundary as the first one.
function protectNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const decision = navigationDecision(window.webContents.getURL(), url);
    if (decision === "allow") return;

    event.preventDefault();
    if (decision === "external") void shell.openExternal(url);
  });
}

/// Creates a native-framed window containing only one document surface. It intentionally does not
/// use `chromeOptionsFor`: the custom title bar would be app chrome in a window whose purpose is to
/// show only the requested file.
function createDocumentWindow(target) {
  const documentWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 320,
    title: path.basename(target.file),
    show: false,
    backgroundColor: "#111827",
    webPreferences: webPreferencesFor(path.join(__dirname, "preload.js")),
  });
  const guard = createCloseGuard({
    dialog,
    send: (channel, payload) => {
      if (!documentWindow.isDestroyed()) documentWindow.webContents.send(channel, payload);
    },
  });
  documentGuards.set(documentWindow, guard);

  documentWindow.on("close", (event) => {
    const decision = closeDecision({ forced: guard.forced(), hiding: false, dirty: guard.isDirty() });
    if (decision === "close") return;
    event.preventDefault();
    guard.requestClose();
  });
  // Read now: `webContents` cannot be reached once the window is destroyed, which is exactly when the
  // handoff most needs to hear about it.
  const contentsId = documentWindow.webContents.id;
  documentWindow.on("closed", () => {
    documentGuards.delete(documentWindow);
    documentHandoff.abandon(contentsId);
    forgetPasteMarkdownContext(contentsId);
  });
  documentWindow.once("ready-to-show", () => documentWindow.show());
  protectNavigation(documentWindow);

  // A tab with unsaved work moving in. The answer waits until this window's page has claimed the
  // text, so the tab it came from closes only once the text is somewhere - and a window whose page
  // never gets that far says so, leaving the tab open.
  const draft = target.draft ?? null;
  const claimed = draft === null ? Promise.resolve({ ok: true }) : documentHandoff.hold(contentsId, draft);
  if (draft !== null) {
    documentWindow.webContents.on("render-process-gone", () => documentHandoff.abandon(contentsId));
    documentWindow.webContents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) documentHandoff.abandon(contentsId);
    });
  }

  void loadRenderer(documentWindow, { root: target.root, file: target.file });
  return claimed;
}

/// The menu handlers, shared between the popup channel and the context-menu listener.
///
/// A holder rather than a value: the window is created before the handlers are built, and the
/// listener registered on it has to see them once they exist.
const menuHandlersRef = { current: null };

/// Opens what a launch was pointed at: a folder from Explorer, or a markdown file within one.
///
/// Sent to the renderer rather than acted on here, because the renderer owns the open documents and
/// is the only side that can ask about unsaved work before replacing them. Nothing is sent when the
/// argument names nothing openable, which is the ordinary case of the app simply being started.
///
/// Queued when the window is not ready yet: the first launch resolves this while the renderer is
/// still loading, and a message sent to a page that has not finished loading is a message nobody
/// receives.
let pendingTarget = null;

async function openFromArgv(argv) {
  const target = await resolveTarget(pathFromArgv(argv, { packaged: app.isPackaged }));
  if (target === null) return;

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(OPEN_TARGET_CHANNEL, target);
    return;
  }
  pendingTarget = target;
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

  // Nothing is underlined and no suggestion is ever offered when the spellchecker resolves to no
  // languages at all - a state that looks exactly like a document with nothing wrong in it. See
  // `spellcheck.js`; this only steps in when Electron resolved nothing itself.
  const spelling = enableSpellChecker(mainWindow.webContents.session, {
    platform: process.platform,
    locale: app.getLocale(),
  });
  if (!spelling.checking) {
    console.warn("Spellchecking is off: no dictionary is available for this system.");
  }

  /// The right-click menu, for any text the user can select or edit.
  ///
  /// Registered on the window's own web contents rather than through a preload bridge, because the
  /// spelling information only exists here: Electron reports the misspelled word and its
  /// suggestions on the event itself, and there is no way to ask for them afterwards. The renderer
  /// never sees them and does not need to.
  ///
  /// One item goes the other way: Paste as markdown is named by the RENDERER, because the catalogue
  /// lives there. Its report arrives before this event - the DOM contextmenu precedes the browser's
  /// own menu request - so `pasteMarkdownLabelFor` holds what was under the cursor that just clicked.
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const template = contextMenuTemplate(params, {
      on: menuHandlersRef.current,
      pasteMarkdownLabel: pasteMarkdownLabelFor(mainWindow.webContents.id),
    });
    // An empty menu is a real answer - a right-click on a plain paragraph with nothing selected has
    // nothing to offer, and a menu of dead items would be worse than none.
    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  // In development the shell and the Vite server start together, so the shell routinely wins the
  // race. Retrying turns "blank window, no explanation" into "appears a moment later", and also
  // covers restarting the dev server while the shell stays open.
  mainWindow.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (!mainWindow) return;
    // A running app must not reload itself: that discards every open tab and any unsaved work, and
    // says nothing about why. See `shouldRetryLoad`.
    if (!shouldRetryLoad({ isMainFrame, hasLoaded, isDev: process.env.TRYPTHOS_DEV === "1" })) {
      // Logged rather than swallowed. This used to reload the window silently, which is why nobody
      // could tell it had happened - and the code is the only thing that says what actually failed.
      // Deliberately not the URL: it can name a file on the user's machine.
      console.error("A load failed and was not retried: %s (%d), mainFrame=%s", description, code, isMainFrame);
      return;
    }

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
    // From here on a failed load is not a startup race, and a packaged app stops retrying.
    hasLoaded = true;
    // Whatever the app was launched with, now that there is a page to receive it. Cleared as it is
    // sent, so a later reload does not reopen a folder the user has since navigated away from.
    if (pendingTarget !== null) {
      mainWindow.webContents.send(OPEN_TARGET_CHANNEL, pendingTarget);
      pendingTarget = null;
    }
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

  // Closing the window: close-to-tray and unsaved work meet on the same event, and `closeDecision`
  // states the order between them once rather than leaving it to the order of the `if`s here.
  mainWindow.on("close", (event) => {
    const decision = closeDecision({
      forced: closeGuard.forced(),
      hiding: closeToTray && !quitting,
      dirty: closeGuard.isDirty(),
    });

    if (decision === "close") return;

    event.preventDefault();

    if (decision === "hide") {
      // Hidden rather than closed, so reopening from the tray is instant and the document survives.
      mainWindow.hide();
      return;
    }

    // Asking. The renderer owns the document, so it puts the question and closes the window itself -
    // `closeGuard.js` says why that cannot be decided here.
    closeGuard.requestClose();
    // A quit the user is about to be asked about is not a quit yet: leaving this set would make the
    // next ordinary close skip the tray and close for real.
    quitting = false;
    // The prompt is about a document nobody can see while the window is hidden in the tray.
    revealWindow(mainWindow);
  });

  mainWindow.on("closed", () => {
    forgetPasteMarkdownContext(mainWindow.webContents.id);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    mainWindow = null;
  });

  protectNavigation(mainWindow);
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
  // A second launch hands over to the running instance, which has to come back into view whether
  // it was minimised or hidden to the tray - a hidden window that is merely focused stays hidden.
  app.on("second-instance", (_event, argv) => {
    revealWindow(mainWindow);
    // The launch that lost the lock still names a folder or a file - it is a right-click in Explorer
    // - so its arguments come here rather than being dropped with the process that carried them.
    void openFromArgv(argv);
  });

  void app.whenReady().then(async () => {
    // safeStorage is only usable after the app is ready, which is why the store is built here
    // rather than at module load. DPAPI on Windows, the Keychain on macOS.
    const secrets = createSecretStore({
      userDataDir: app.getPath("userData"),
      encryptor: safeStorage,
    });

    // Cloud provider tokens, in their own file. Not beside the chat keys: saving settings sweeps
    // those, and a GitHub token there would be deleted the first time somebody removed a model.
    const accounts = createAccountStore({
      userDataDir: app.getPath("userData"),
      encryptor: safeStorage,
    });

    registerIpcHandlers({
      ipcMain,
      dialog,
      getWindow: () => mainWindow,
      // A file the model asked to show the user, down the same channel a launch from Explorer uses.
      openInWindow: (target) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send(OPEN_TARGET_CHANNEL, target);
      },
      openInNewWindow: createDocumentWindow,
      userDataDir: app.getPath("userData"),
      secrets,
      // The provider call lives here and only here. The renderer never opens a socket to a provider
      // and never holds the key.
      //
      // **Electron's `net.fetch`, not Node's**, for two reasons. Node's gives up on any response
      // after five minutes of silence, which no setting here could raise - so a large reasoning model
      // thinking before its first token could never be waited for. Chromium's stack sets no such
      // limit, and each model's own reply timeout (see `createSilenceWatch`) is the limit instead. It
      // also knows the machine's proxy and certificate store, which is why GitHub already uses it.
      chat: createChatProvider({ secrets, fetchImpl: (url, options) => net.fetch(url, options) }),
      accounts,
      // Every GitHub call happens here, where the token is. The renderer never opens a socket to
      // GitHub and never holds the token - the same rule as the chat provider, for the same reason.
      // A factory rather than a client, so connecting can verify a token before it is stored.
      //
      // **Electron's `net.fetch`, not Node's.** Node's knows nothing about the machine's proxy
      // settings or its certificate store; Chromium's networking stack knows both. Behind a
      // corporate proxy or a VPN that is the difference between a request that answers and one that
      // hangs - and a hung request left the picker spinning with nothing to say. Wrapped rather than
      // passed by reference, so it keeps its receiver.
      createGitHub: (getToken) =>
        createGitHubApi({ getToken, fetch: (url, options) => net.fetch(url, options) }),
      // The only path from the renderer to the operating system's protocol handlers, and the reason
      // the schema behind it is an allow-list rather than a deny-list.
      openExternal: (url) => shell.openExternal(url),
      // Open in Explorer / Finder. A folder is opened; a file is shown selected in the folder that
      // holds it, which is what "open the containing folder" looks like in both file managers.
      revealPath: async ({ path: target, kind }) => {
        if (kind === "directory") await shell.openPath(target);
        else shell.showItemInFolder(target);
      },
      // Trypthos's entries in File Explorer's right-click menu, written only when the user asks.
      // Windows-only and packaged-only: in development `process.execPath` is Electron's own binary,
      // which cannot start Trypthos from a path alone.
      explorerIntegration: createExplorerIntegration({
        platform: process.platform,
        packaged: app.isPackaged,
        exePath: process.execPath,
      }),
      // Obsidian's own list of vaults. `appData` is the per-user folder every app keeps its settings
      // under - %APPDATA% on Windows, ~/Library/Application Support on macOS - and Obsidian's is the
      // `obsidian` folder in it. A file that is not there means Obsidian is not installed.
      obsidianConfigPath: path.join(app.getPath("appData"), "obsidian", "obsidian.json"),
      broadcast: (channel, payload) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send(channel, payload);
        }
      },
    });
    registerWindowHandlers({
      ipcMain,
      getWindow: () => mainWindow,
      guard: closeGuard,
      getWindowForEvent: (event) =>
        event?.sender ? BrowserWindow.fromWebContents(event.sender) ?? mainWindow : mainWindow,
      guardForWindow: (window) => documentGuards.get(window) ?? closeGuard,
      takeDraft: (contentsId) => documentHandoff.take(contentsId),
    });

    /// The recent files list, as the menus need it.
    ///
    /// Held here rather than read on every popup, and kept current from the settings write the
    /// renderer already makes - `onSettingsWritten` exists for exactly this. Read once at startup so
    /// the first menu opened is not empty.
    let recentFiles = (await readSettings(app.getPath("userData"))).recentFiles;

    /// What a menu item does.
    ///
    /// Renderer actions go over IPC and drive the paths the user already has - the same open, save,
    /// preferences and about the buttons and shortcuts use, rather than a second copy of each.
    /// Everything the renderer has no business arranging stays here.
    const menuHandlers = (menuHandlersRef.current = {
      action: (name) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send(MENU_ACTION_CHANNEL, { action: name });
      },
      // A recent file is a FOLDER and a document in it, which is the same thing a launch from
      // Explorer carries - so it goes down the same channel and the renderer handles it the one way.
      // The alternative, opening it here, would be a second implementation with its own idea of
      // whether to ask about unsaved work.
      openRecent: (target) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send(OPEN_TARGET_CHANNEL, target);
      },
      quit: () => app.quit(),
      closeWindow: () => mainWindow?.close(),
      checkForUpdates: () => void updater?.check("manual"),
      addToDictionary: (word) =>
        mainWindow?.webContents.session.addWordToSpellCheckerDictionary(word),
      replaceMisspelling: (word) => mainWindow?.webContents.replaceMisspelling(word),
    });

    // macOS shows the application menu in the system menu bar whether or not the window has a
    // frame, so it is set once - and rebuilt whenever the recent list changes, because a menu bar
    // that is already on screen does not re-read its template. Windows and Linux get NO application
    // menu: the window is frameless, Electron has nowhere to draw one, and leaving a menu set there
    // only produces stray Alt-key behaviour for a bar nobody can see. Their File menu is popped
    // fresh on every click, so it picks the list up without any of this.
    const setApplicationMenu = () => {
      Menu.setApplicationMenu(
        process.platform === "darwin"
          ? Menu.buildFromTemplate(
              appMenuTemplate({ appName: APP_NAME, on: menuHandlers, recent: recentFiles }),
            )
          : null,
      );
    };
    setApplicationMenu();

    onSettingsWritten((settings) => {
      recentFiles = settings.recentFiles;
      setApplicationMenu();
    });

    ipcMain.handle("menu:popup", async (_event, payload) => {
      const parsed = PopupMenuRequest.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: "bad-request" };
      if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: "no-window" };

      Menu.buildFromTemplate(
        popupTemplate(parsed.data.menu, { on: menuHandlers, recent: recentFiles }),
      ).popup({
        window: mainWindow,
        x: parsed.data.x,
        y: parsed.data.y,
      });
      return { ok: true };
    });

    updater = createUpdater({
      app,
      dialog,
      shell,
      Notification,
      getWindow: () => mainWindow,
      // Electron's network stack rather than Node's, for the same reason the GitHub provider uses
      // it: Node's fetch knows nothing about the machine's proxy settings or its certificate store,
      // so an update check could fail on a corporate network while the releases page opened
      // perfectly well in a browser on the same machine. Wrapped rather than passed by reference,
      // so it keeps its receiver.
      fetch: (url, options) => net.fetch(url, options),
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

    // What this launch was pointed at, if anything. Resolved after the window exists so it can be
    // queued for the page that is still loading rather than raced against it.
    void openFromArgv(process.argv);

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
