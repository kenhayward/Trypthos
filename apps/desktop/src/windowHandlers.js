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
function registerWindowHandlers({
  ipcMain,
  getWindow,
  guard,
  /// The primary window was once the only renderer. Auxiliary document windows use the same narrow
  /// controls bridge, so each event must resolve back to the window that sent it.
  getWindowForEvent = () => getWindow(),
  guardForWindow = () => guard,
  /// The unsaved text a document window was opened with, by the id of the renderer asking - see
  /// `documentHandoff`. Nothing by default: a shell with no handoff has no drafts to give.
  takeDraft = () => null,
}) {
  const fromEvent = (event) => getWindowForEvent(event) ?? getWindow();
  const fromWindow = (window) => guardForWindow(window) ?? guard;
  const withWindow = (action) => (event) => {
    const window = fromEvent(event);
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

  ipcMain.handle("window:close", (event, payload) => {
    // Validated here, in the main process. The renderer having already checked is not a check.
    const parsed = CloseWindowRequest.safeParse(payload ?? {});
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    return withWindow((window) => {
      // The renderer forces a close only once it has asked about unsaved work and been told to go
      // ahead. Telling the guard first is what stops it asking again and the window never closing.
      if (parsed.data.force) fromWindow(window).allow();
      window.close();
    })(event);
  });

  ipcMain.handle("document:dirty", (event, payload) => {
    const parsed = DocumentDirtyRequest.safeParse(payload);
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    fromWindow(fromEvent(event)).setDirty(parsed.data.dirty);
    return { ok: true };
  });

  ipcMain.handle("document:confirmDiscard", async (event, payload) => {
    // Validated here like every other handler, even though the name only reaches a dialog: it is
    // renderer input, and the renderer is the untrusted side.
    const parsed = ConfirmDiscardRequest.safeParse(payload ?? {});
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    return { ok: true, choice: await fromWindow(fromEvent(event)).ask(parsed.data.name) };
  });

  // No payload to validate, deliberately: which draft is answered from WHO is asking, so there is
  // nothing a page could put in a request to reach another window's text.
  ipcMain.handle("document:takeDraft", (event) => ({
    ok: true,
    draft: takeDraft(event?.sender?.id) ?? null,
  }));
}

module.exports = { registerWindowHandlers };
