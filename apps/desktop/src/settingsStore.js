"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { DEFAULT_SETTINGS, readStoredSettings } = require("@trypthos/domain");

/// Reading and writing the settings file.
///
/// Nothing here is the user's work - a panel width, which folder was last open - so every failure
/// to READ answers with defaults rather than stopping the app. An unopenable editor because a
/// remembered width is malformed would be a far worse bug than forgetting the width.
///
/// Answering with defaults does NOT mean the next write may replace the file (issue #235). The
/// renderer writes its settings back 400 ms after loading them, so a build that read a file as
/// defaults would otherwise write those defaults over it - and a downgrade, or an old dev build run
/// once, wiped every setting a newer build had stored. So every write first looks at what is on
/// disk, HERE in the main process, because the renderer is untrusted and a guard there is not one:
///
///   - **From the future** (a newer build wrote it): the write is REFUSED and the file is never
///     touched - not backed up, not renamed, not rewritten. This session runs on defaults in memory.
///     The way out is to run the newer build again, which reads the file intact. Nothing an older
///     build could do would be better than that: it cannot read the shape, so anything it wrote
///     would lose what it could not see.
///   - **Unreadable** (not JSON, not an object, no version, an old version with no migration path,
///     or a shape that fails the schema): the file is copied aside to
///     `settings.json.unreadable-<timestamp>`, and the write then goes ahead. No build can read such
///     a file, so refusing would leave the user unable to save a setting ever again; the copy keeps
///     the bytes for anyone who wants to repair them by hand. Once replaced the file is current, so
///     the copy is taken once rather than on every later write.
///   - **Could not be opened at all** (held by another process, permissions): refused, since there
///     is nothing to back up and no telling what it holds. The next write tries again.
///
/// Log lines name the step and the reason. Never the file's contents, and never its path - the path
/// carries the user's account name on every platform.

function settingsPath(userDataDir) {
  return path.join(userDataDir, "settings.json");
}

/// What is on disk, classified. Total: every failure is a `state`, never a throw.
///
///   { state: "missing" }                     - first run
///   { state: "current", settings }           - readable, possibly migrated from an older version
///   { state: "from-the-future" }             - written by a newer build
///   { state: "unreadable", reason }          - present, but no build could read it
///   { state: "unopenable", code }            - present (or maybe), but it could not be read
async function inspectStored(userDataDir) {
  let text;
  try {
    text = await fs.readFile(settingsPath(userDataDir), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "missing" };
    return { state: "unopenable", code: error?.code ?? error?.name };
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    // Truncated or corrupt - exactly what the atomic write below exists to prevent creating.
    return { state: "unreadable", reason: "not-json" };
  }

  const result = readStoredSettings(raw);
  if (result.ok) return { state: "current", settings: result.value };
  if (result.reason === "from-the-future") return { state: "from-the-future" };
  return { state: "unreadable", reason: result.reason };
}

async function readSettings(userDataDir, { logger = console } = {}) {
  const stored = await inspectStored(userDataDir);

  switch (stored.state) {
    case "current":
      return stored.settings;
    case "missing":
      // First run. The overwhelmingly common case, and not worth a line.
      return DEFAULT_SETTINGS;
    case "from-the-future":
      logger.warn?.("Settings load: fell back to defaults (from-the-future); the file will not be written.");
      return DEFAULT_SETTINGS;
    case "unreadable":
      logger.warn?.(`Settings load: fell back to defaults (${stored.reason}).`);
      return DEFAULT_SETTINGS;
    default:
      logger.warn?.(`Settings load: could not open the file (${stored.code}).`);
      return DEFAULT_SETTINGS;
  }
}

/// A file name safe on every platform: an ISO time with the colons and the dot that Windows refuses
/// in a file name swapped for hyphens.
function backupPath(userDataDir, now) {
  return `${settingsPath(userDataDir)}.unreadable-${now.toISOString().replace(/[:.]/g, "-")}`;
}

/// Writes via a temporary file and a rename - after checking it may (see the header above).
///
/// Answers `{ ok: true }`, or `{ ok: false, reason }` when it refused. A refusal is a result, never
/// a throw: it is the expected outcome for the rest of a session on a downgraded build.
///
/// A rename is atomic, so a reader sees either the old file or the new one - never a half-written
/// one. Writing in place risks a crash or a power cut leaving a truncated file, and settings are
/// written often enough (every panel drag settles) that "rarely" is not an argument.
async function writeSettings(userDataDir, settings, { logger = console, now = () => new Date() } = {}) {
  const target = settingsPath(userDataDir);
  const stored = await inspectStored(userDataDir);

  if (stored.state === "from-the-future") {
    logger.warn?.("Settings write: refused (from-the-future).");
    return { ok: false, reason: "from-the-future" };
  }
  if (stored.state === "unopenable") {
    logger.warn?.(`Settings write: refused, the file could not be opened (${stored.code}).`);
    return { ok: false, reason: "unopenable" };
  }

  await fs.mkdir(userDataDir, { recursive: true });

  if (stored.state === "unreadable") {
    // Copied, not renamed: if the write below fails, the original is still where it was. COPYFILE_EXCL
    // so two backups in the same millisecond cannot overwrite each other - the second throws, and the
    // write is retried on the next change with a fresh time.
    await fs.copyFile(target, backupPath(userDataDir, now()), fs.constants.COPYFILE_EXCL);
    logger.warn?.(`Settings write: backed up the unreadable file (${stored.reason}) before replacing it.`);
  }

  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
  return { ok: true };
}

/// Just the one value the main process needs at close time.
///
/// Read through the same loader, so a v1 file on disk migrates rather than being treated as missing.
async function readCloseToTray(userDataDir) {
  return (await readSettings(userDataDir)).window.closeToTray;
}

/// Notified whenever the renderer saves, so the main process does not have to re-read the file on
/// every window close - and cannot act on a preference the user changed a moment ago.
const writeListeners = new Set();

function onSettingsWritten(listener) {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

function notifySettingsWritten(settings) {
  for (const listener of writeListeners) listener(settings);
}

module.exports = {
  readSettings,
  writeSettings,
  settingsPath,
  readCloseToTray,
  onSettingsWritten,
  notifySettingsWritten,
};
