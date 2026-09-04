"use strict";

const path = require("node:path");
const { downloadAssetFor, pickUpdate } = require("@trypthos/domain");

/// Checking for, and applying, a newer release.
///
/// Two paths, because they are genuinely different problems:
///
///   - **Windows** uses electron-updater, which downloads and installs in place.
///   - **macOS** cannot. Squirrel.Mac refuses to apply an update to an unsigned app, and Trypthos is
///     unsigned until Developer ID signing exists. So macOS checks GitHub directly, downloads the
///     matching `.dmg` itself, and opens it - which mounts the disk image exactly as a manual
///     download and double-click would, without making the user find and click the right asset on
///     the releases page first. Only if no matching asset exists (or the download fails) does it
///     fall back to that page, which is honest about what it can actually do rather than failing
///     silently part-way through.
///
/// Two consent models, which is the reason `trigger` exists:
///
///   - **startup**: a notification. Clicking it IS the consent, so the download begins on click with
///     nothing further asked. A check that finds nothing says nothing at all.
///   - **manual**: the user asked, so they get an answer either way - and are asked before ~110 MB is
///     spent on their connection.

/// electron-updater is required lazily and only in a packaged Windows build.
///
/// In development there is no app-update.yml for it to read, and requiring it eagerly would make
/// every `npm run app` load an updater that cannot possibly work.
function defaultAutoUpdaterFactory(logger) {
  try {
    const { autoUpdater: updater } = require("electron-updater");
    // Never without consent: the startup notification and the tray prompt are what start a
    // download, not the check itself.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    return updater;
  } catch (error) {
    logger.error("electron-updater is unavailable:", error.message);
    return null;
  }
}

const RELEASES_API = "https://api.github.com/repos/kenhayward/Trypthos/releases";
const RELEASES_PAGE = "https://github.com/kenhayward/Trypthos/releases/latest";

/// Asks GitHub what has been published. Used on macOS, and as the fallback anywhere
/// electron-updater cannot answer.
async function fetchAvailableUpdate(currentVersion) {
  const response = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Trypthos" },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);

  return pickUpdate(await response.json(), currentVersion);
}

function createUpdater({
  app,
  dialog,
  shell,
  Notification,
  getWindow,
  logger = console,
  fs = require("node:fs/promises"),
  downloadsDir = app.getPath("downloads"),
  // Lazily requires electron-updater's real autoUpdater, or null outside a packaged Windows build.
  // Injectable so a test can simulate "not available" deterministically and instantly, rather than
  // depending on the real module's own failure mode when invoked outside a packaged app - which is
  // real behaviour worth relying on in production, but not something a test should depend on to be
  // fast or predictable.
  autoUpdaterFactory = defaultAutoUpdaterFactory,
  // Injectable for the same reason autoUpdaterFactory is: a test must not depend on which OS
  // actually runs the suite. CI's test job runs on Linux, where every platform-branching decision
  // here - which updater path applies, which asset name to look for - would silently take neither
  // the Windows nor the macOS branch if this were read from the real process.platform.
  platform = process.platform,
}) {
  /// Guards against two checks running at once - the startup check and an impatient tray click.
  let checking = false;
  /// Set once a download completes, so the tray can offer to restart into it.
  let downloaded = null;
  /// The update found by the last check, remembered so the tray can surface it.
  ///
  /// This is what saves the feature on a machine with notifications switched off. Windows reports
  /// `isSupported()` as true and then refuses delivery, so without somewhere else to show it the
  /// startup check would be silent and dead - the user would simply never hear about an update.
  let available = null;
  let onStateChange = () => {};

  const isPackaged = app.isPackaged;
  const currentVersion = app.getVersion();

  function autoUpdater() {
    if (platform !== "win32" || !isPackaged) return null;
    return autoUpdaterFactory(logger);
  }

  /// Fetches one asset and opens it - mounting a `.dmg`, or running a `.exe`'s installer - without
  /// sending the user to a webpage to find and click it themselves.
  ///
  /// Returns whether it worked. Any failure - no matching asset, a network error, a write error, or
  /// the OS having nothing to open the file with - is the caller's cue to fall back to the releases
  /// page, which is why nothing here throws outward.
  async function downloadAndOpen(update) {
    const asset = downloadAssetFor(update.assets, platform, update.version);
    if (asset === null) return false;

    let destination;
    try {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`download answered ${response.status}`);

      const bytes = Buffer.from(await response.arrayBuffer());
      destination = path.join(downloadsDir, asset.name);
      await fs.writeFile(destination, bytes);
    } catch (error) {
      logger.error("Downloading the update failed:", error.message);
      return false;
    }

    // shell.openPath resolves with an error STRING on failure rather than rejecting - there is no
    // exception to catch, only an answer to check. The file is already on disk at this point, so a
    // failure here is "could not open it", not "could not get it".
    const openError = await shell.openPath(destination);
    if (openError !== "") {
      logger.error("Opening the downloaded update failed:", openError);
      return false;
    }

    return true;
  }

  async function download(update) {
    const updater = autoUpdater();
    if (updater !== null) {
      try {
        // downloadUpdate() rejects immediately with "Please check update first" unless
        // checkForUpdates() has populated its internal update info on this same instance - our own
        // check above answers "is there an update" from the GitHub API directly and never touches
        // electron-updater at all, so without this call the Windows path always failed and silently
        // fell through to the asset-download fallback below on every single download.
        await updater.checkForUpdates();
        await updater.downloadUpdate();
        return;
      } catch (error) {
        logger.error("Downloading the update failed:", error.message);
        // Falls through to the asset-download path below, same as macOS: electron-updater failing
        // is not a reason to strand the user on a webpage when the installer can be fetched directly.
      }
    }

    if (await downloadAndOpen(update)) return;

    // Nothing else worked: hand it to the browser rather than pretending to install.
    await shell.openExternal(update?.url ?? RELEASES_PAGE);
  }

  /// Runs a check and responds according to how it was triggered.
  async function check(trigger) {
    if (checking) return { ok: false, reason: "already-checking" };
    checking = true;

    try {
      if (downloaded !== null) {
        promptRestart(downloaded);
        return { ok: true, state: "downloaded" };
      }

      const update = await fetchAvailableUpdate(currentVersion);

      if (update === null) {
        // Silence on startup is the point: an app that announces "you are up to date" every launch
        // is an app that trains people to dismiss it without reading.
        if (trigger === "manual") {
          await dialog.showMessageBox(getWindow() ?? undefined, {
            type: "info",
            message: `Trypthos ${currentVersion} is up to date.`,
            buttons: ["OK"],
          });
        }
        return { ok: true, state: "up-to-date" };
      }

      available = update;
      onStateChange();

      if (trigger === "startup") notifyAvailable(update);
      else await askToDownload(update);

      return { ok: true, state: "update-available", version: update.version };
    } catch (error) {
      logger.error("Checking for updates failed:", error.message);
      if (trigger === "manual") {
        await dialog.showMessageBox(getWindow() ?? undefined, {
          type: "warning",
          message: "Could not check for updates.",
          detail: "Check your connection and try again.",
          buttons: ["OK"],
        });
      }
      // A failed startup check is silent. It is not the user's problem, and there is nothing for
      // them to do about it at the moment the app opens.
      return { ok: false, reason: "check-failed" };
    } finally {
      checking = false;
    }
  }

  function notifyAvailable(update) {
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: `Trypthos ${update.version} is available`,
      body: "Click to download and install it.",
    });
    // Clicking the notification IS the consent - so nothing further is asked. Returned rather than
    // void-d: Electron ignores an event handler's return value either way, and returning it is what
    // lets a test double observe the download actually finishing rather than racing ahead of it.
    notification.on("click", () => download(update));
    // Delivery can be refused after the fact: Windows answers isSupported() with true and then
    // declines if the user has notifications switched off. Nothing is shown and nothing throws, so
    // this is the only signal - and the tray label is what the user is left with.
    notification.on("failed", (_event, error) => {
      logger.error("The update notification could not be delivered:", error);
    });
    notification.show();
  }

  async function askToDownload(update) {
    const { response } = await dialog.showMessageBox(getWindow() ?? undefined, {
      type: "question",
      message: `Trypthos ${update.version} is available.`,
      detail:
        platform === "win32"
          ? "Download it now? It will install when you restart."
          : "Download it now? Trypthos will open the disk image so you can drag it to Applications.",
      buttons: ["Download", "Not now"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) await download(update);
  }

  async function promptRestart(update) {
    const { response } = await dialog.showMessageBox(getWindow() ?? undefined, {
      type: "question",
      message: `Trypthos ${update.version} is ready to install.`,
      detail: "Restart now to finish updating.",
      buttons: ["Restart", "Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) autoUpdater()?.quitAndInstall();
  }

  function start() {
    const updater = autoUpdater();
    if (updater !== null) {
      updater.on("update-downloaded", (info) => {
        downloaded = { version: info.version };
        promptRestart(downloaded);
      });
      updater.on("error", (error) => logger.error("Updater error:", error.message));
    }

    // Only a packaged build checks. In development the version is whatever the repo says, so every
    // run would announce an update to the release that matches the source already checked out.
    if (isPackaged) void check("startup");
  }

  return {
    start,
    check,
    /// What the tray shows. Null when there is nothing to offer.
    getAvailable: () => downloaded ?? available,
    isDownloaded: () => downloaded !== null,
    /// Lets the tray rebuild its menu when an update appears.
    onChange: (listener) => {
      onStateChange = listener;
    },
  };
}

module.exports = { createUpdater, fetchAvailableUpdate };
