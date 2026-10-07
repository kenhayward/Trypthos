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
///
/// `readFile` is injectable so a test can make one read fail the way a held file does on Windows.
async function inspectStored(userDataDir, readFile = fs.readFile) {
  let text;
  try {
    text = await readFile(settingsPath(userDataDir), "utf8");
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

/// Which settings directories' last load did NOT succeed (review round 1 of #235).
///
/// The stateless check in `writeSettings` sees the file as it is at write time - which is not
/// enough. If the load hit a held file (EBUSY at launch), it answered defaults; 400 ms later the
/// lock is gone, the file reads as current, and the renderer's write would put those defaults over
/// it. So a failed load is remembered, and while it is, a write over an existing current file is
/// refused (`not-loaded`) until a later load succeeds. A missing file is a successful load of
/// nothing, so a first run is never blocked. Keyed by directory, so tests over separate temporary
/// directories cannot see each other's state.
const failedLoads = new Set();

async function readSettings(userDataDir, { logger = console, readFile } = {}) {
  const stored = await inspectStored(userDataDir, readFile);

  if (stored.state === "current" || stored.state === "missing") failedLoads.delete(userDataDir);
  else failedLoads.add(userDataDir);

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

/// Every write runs through here, one at a time, so check-then-write is one step: two writes in
/// flight over an unreadable file would otherwise each see it unreadable and each try to back it up.
/// The same pattern as `encryptedStore.js`. A write that fails does not stop the next one.
let writes = Promise.resolve();
function queued(operation) {
  const run = writes.then(operation, operation);
  writes = run.catch(() => {});
  return run;
}
let written = 0;

/// Writes via a temporary file and a rename - after checking it may (see the header above).
///
/// Answers `{ ok: true }`; `{ ok: true, replacedUnreadable: true }` when it replaced an unreadable
/// file, so the caller knows the settings it wrote are defaults and must not act on them (the
/// chat-key sweep); or `{ ok: false, reason }` when it did not write. A refusal is a result, never a
/// throw: it is the expected outcome for the rest of a session on a downgraded build, and it crosses
/// IPC.
///
/// A rename is atomic, so a reader sees either the old file or the new one - never a half-written
/// one. Writing in place risks a crash or a power cut leaving a truncated file, and settings are
/// written often enough (every panel drag settles) that "rarely" is not an argument. The temporary
/// name is unique per write, so a second instance of the app cannot rename this one's half-written
/// file into place.
function writeSettings(userDataDir, settings, { logger = console, now = () => new Date(), readFile } = {}) {
  return queued(async () => {
    const target = settingsPath(userDataDir);
    const stored = await inspectStored(userDataDir, readFile);

    if (stored.state === "from-the-future") {
      logger.warn?.("Settings write: refused (from-the-future).");
      return { ok: false, reason: "from-the-future" };
    }
    if (stored.state === "unopenable") {
      logger.warn?.(`Settings write: refused, the file could not be opened (${stored.code}).`);
      return { ok: false, reason: "unopenable" };
    }
    if (stored.state === "current" && failedLoads.has(userDataDir)) {
      logger.warn?.("Settings write: refused (not-loaded).");
      return { ok: false, reason: "not-loaded" };
    }

    try {
      await fs.mkdir(userDataDir, { recursive: true });
    } catch (error) {
      logger.error?.(`Settings write: could not create the directory (${error?.code ?? error?.name}).`);
      return { ok: false, reason: "write-failed" };
    }

    if (stored.state === "unreadable") {
      // Copied, not renamed: if the write below fails, the original is still where it was.
      // COPYFILE_EXCL so a backup is never overwritten; a collision answers a refusal, and the next
      // change tries again with a fresh time.
      try {
        await fs.copyFile(target, backupPath(userDataDir, now()), fs.constants.COPYFILE_EXCL);
      } catch (error) {
        logger.error?.(`Settings write: could not back up the unreadable file (${error?.code ?? error?.name}).`);
        return { ok: false, reason: "backup-failed" };
      }
      logger.warn?.(`Settings write: backed up the unreadable file (${stored.reason}) before replacing it.`);
    }

    written += 1;
    const temporary = `${target}.${process.pid}.${written}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      await fs.rename(temporary, target);
    } catch (error) {
      // A unique name is never overwritten by the next write, so a failed one is cleared here.
      await fs.rm(temporary, { force: true }).catch(() => {});
      logger.error?.(`Settings write: could not write the file (${error?.code ?? error?.name}).`);
      return { ok: false, reason: "write-failed" };
    }

    if (stored.state === "unreadable") {
      // What is on disk now is what this session holds, so later writes are ordinary ones.
      failedLoads.delete(userDataDir);
      return { ok: true, replacedUnreadable: true };
    }
    return { ok: true };
  });
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
