"use strict";

/// Runs `cleanup` once `window` has closed, with the id of the page it held.
///
/// The id is read NOW, while the window is alive. By the time "closed" fires its `webContents` is
/// destroyed, and reading it throws "Object has been destroyed" - an uncaught exception in the main
/// process, shown to the user as an error dialog on every quit.
function onWindowClosed(window, cleanup) {
  const contentsId = window.webContents.id;
  window.on("closed", () => cleanup(contentsId));
}

module.exports = { onWindowClosed };
