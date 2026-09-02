"use strict";

const path = require("node:path");

/// The notification-area icon and its menu.
///
/// Closing the window still quits the app: close-to-tray is a preference, and there is nowhere to set
/// one yet. An app that silently keeps running after you close it, with no setting to say otherwise,
/// is an app people find in their tray a week later and resent.
function createTray({ Tray, Menu, app, updater, getWindow, iconDir }) {
  /// Rebuilt whenever the updater finds something.
  ///
  /// This is the only place an update is visible on a machine where notifications are switched off -
  /// Windows reports them as supported and then declines delivery, so the toast is not a path that
  /// can be relied on alone.
  const build = () => {
    const update = updater.getAvailable();

    return Menu.buildFromTemplate([
      {
        label: "Show Trypthos",
        click: () => {
          const window = getWindow();
          if (!window) return;
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        },
      },
      { type: "separator" },
      update === null
        ? {
            label: "Check for Updates",
            // Explicitly asked for, so it answers either way and asks before spending the bandwidth.
            click: () => void updater.check("manual"),
          }
        : {
            label: updater.isDownloaded()
              ? `Restart to update to ${update.version}`
              : `Update to ${update.version}...`,
            click: () => void updater.check("manual"),
          },
      { type: "separator" },
      { label: "Quit Trypthos", click: () => app.quit() },
    ]);
  };

  const icon =
    process.platform === "darwin"
      ? // A Template image is recoloured by macOS to suit the menu bar in either appearance. A
        // coloured icon there looks wrong in one of the two and cannot adapt.
        path.join(iconDir, "trayTemplate.png")
      : path.join(iconDir, "tray.png");

  const tray = new Tray(icon);
  tray.setToolTip(`Trypthos ${app.getVersion()}`);

  tray.setContextMenu(build());
  updater.onChange(() => tray.setContextMenu(build()));
  // Left-click raises the window, which is what people expect of a tray icon even when its menu is
  // on the right button.
  tray.on("click", () => getWindow()?.show());

  return tray;
}

module.exports = { createTray };
