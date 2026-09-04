"use strict";

const path = require("node:path");
const { revealWindow } = require("./revealWindow");

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
        click: () => revealWindow(getWindow()),
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

  const tray = new Tray(path.join(iconDir, trayIconFileFor(process.platform)));
  tray.setToolTip(`Trypthos ${app.getVersion()}`);

  tray.setContextMenu(build());
  updater.onChange(() => tray.setContextMenu(build()));
  // Left-click raises the window, which is what people expect of a tray icon even when its menu is
  // on the right button.
  tray.on("click", () => revealWindow(getWindow()));

  return tray;
}

/// Which generated file the tray reads, per platform - all drawn from the same app-icon artwork.
///
/// Windows: an .ico carrying every notification-area size, so the shell picks the entry for the
/// display's scaling rather than resampling one PNG. macOS: a Template image, recoloured by the menu
/// bar to suit either appearance (a coloured icon looks wrong in one of the two and cannot adapt);
/// Electron finds the "@2x" sibling by itself. Elsewhere: a plain PNG.
function trayIconFileFor(platform) {
  if (platform === "win32") return "tray.ico";
  if (platform === "darwin") return "trayTemplate.png";
  return "tray.png";
}

module.exports = { createTray, trayIconFileFor };
