"use strict";

/// Brings the main window back in front of the user, whatever state it was left in.
///
/// One routine for three callers - the tray click, the tray's "Show Trypthos" item, and a second
/// launch of the app - because they used to disagree: the second-instance handler restored a
/// minimised window but never showed a hidden one, so with close-to-tray on, launching Trypthos
/// again did nothing visible. Focusing a hidden window is a no-op, and nothing said so.
///
/// Returns false when there is no window to reveal, so a caller can tell the difference.
function revealWindow(window) {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
  return true;
}

module.exports = { revealWindow };
