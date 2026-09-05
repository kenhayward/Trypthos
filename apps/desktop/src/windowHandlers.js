"use strict";

const {
  CloseWindowRequest,
  ConfirmDiscardRequest,
  DocumentDirtyRequest,
} = require("@trypthos/domain");

/// Minimise, maximise and close, for the frameless window - and the two channels that keep a close
/// from throwing away unsaved work.
///
/// The window controls exist only because the window has no OS chrome to provide them. Each does
/// exactly one named thing to the app's own window - none can name a different window, so there is
/// nothing here for a renderer to point somewhere it should not.
///
/// The document channels are the other half of `closeGuard`: the renderer reports whether there is
/// unsaved work, and asks for the shared native prompt when something is about to discard it.
function registerWindowHandlers({ ipcMain, getWindow, guard }) {
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

  ipcMain.handle("window:close", (_event, payload) => {
    // Validated here, in the main process. The renderer having already checked is not a check.
    const parsed = CloseWindowRequest.safeParse(payload ?? {});
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    return withWindow((window) => {
      // The renderer forces a close only once it has asked about unsaved work and been told to go
      // ahead. Telling the guard first is what stops it asking again and the window never closing.
      if (parsed.data.force) guard.allow();
      window.close();
    })();
  });

  ipcMain.handle("document:dirty", (_event, payload) => {
    const parsed = DocumentDirtyRequest.safeParse(payload);
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    guard.setDirty(parsed.data.dirty);
    return { ok: true };
  });

  ipcMain.handle("document:confirmDiscard", async (_event, payload) => {
    // Validated here like every other handler, even though the name only reaches a dialog: it is
    // renderer input, and the renderer is the untrusted side.
    const parsed = ConfirmDiscardRequest.safeParse(payload ?? {});
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    return { ok: true, choice: await guard.ask(parsed.data.name) };
  });
}

module.exports = { registerWindowHandlers };
