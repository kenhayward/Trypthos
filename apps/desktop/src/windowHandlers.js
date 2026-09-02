"use strict";

/// Minimise, maximise and close, for the frameless window.
///
/// These exist only because the window has no OS chrome to provide them. Each does exactly one named
/// thing to the app's own window - none takes an argument, and none can name a different window, so
/// there is nothing here for a renderer to point somewhere it should not.
function registerWindowHandlers({ ipcMain, getWindow }) {
  const withWindow = (action) => () => {
    const window = getWindow();
    // The window can be gone between a click and its handler - during shutdown, or after a crash.
    // Acting on a destroyed window throws, and the throw would surface in the renderer as an opaque
    // failure of a button that simply no longer has anything to act on.
    if (!window || window.isDestroyed()) return { ok: false, reason: "no-window" };
    action(window);
    return { ok: true };
  };

  ipcMain.handle("window:minimize", withWindow((window) => window.minimize()));

  ipcMain.handle(
    "window:toggleMaximize",
    withWindow((window) => {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    }),
  );

  ipcMain.handle("window:close", withWindow((window) => window.close()));
}

module.exports = { registerWindowHandlers };
