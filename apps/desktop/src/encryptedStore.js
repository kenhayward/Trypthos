"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

/// Credentials on disk, encrypted by the operating system.
///
/// Extracted so there is ONE implementation of this rather than one per kind of credential. There
/// are two kinds already - AI provider API keys, and cloud provider account tokens - and the list
/// grows with every provider added. A second copy of these rules would be a second chance to get
/// one of them subtly wrong, and the weaker copy would be the one holding somebody's GitHub token.
///
/// The rules, each of which is a test:
///
///   - **Ciphertext only.** Encryption comes from Electron's `safeStorage`, which is DPAPI on
///     Windows and the Keychain on macOS. If it is unavailable a write FAILS - it never falls back
///     to plaintext, because doing so would put a live credential in a readable file on exactly the
///     machines least able to protect it, silently.
///   - **The file is versioned, and a version from the future is not guessed at.** Answering "no
///     credentials" costs the user a re-paste; misreading a shape we do not know could write a
///     mangled file back over the real one. Nor is it ever WRITTEN over: every change refuses
///     while the file is a newer build's (issue #235, and `readForChange` below).
///   - **A value that will not decrypt reads as absent.** safeStorage blobs are bound to the machine
///     and the OS user, so a restored profile or a new machine invalidates every one at once. That
///     is a re-paste, not a crash.
///   - **Reading is main-process only.** No IPC channel returns a stored value, and there must never
///     be one - a credential in the renderer is a credential in devtools, in the network panel, and
///     in a renderer crash dump.
///
/// Losing a credential is recoverable. Leaking one is not, so every ambiguous case here resolves
/// towards "no credential".

/// A file name suffix safe on every platform: an ISO time with the colons and the dot that Windows
/// refuses in a file name swapped for hyphens.
function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/// Builds a store over one file.
///
/// `schemaVersion` and `field` belong to the caller rather than to this module: the two stores have
/// separate files with separate histories, and a shared version number would make a migration to one
/// look like a corruption of the other.
///
/// `readFile` is injectable so a test can make a read fail the way a held file does on Windows.
function createEncryptedStore({ file, field, schemaVersion, encryptor, logger = console, readFile = fs.readFile }) {
  const directory = path.dirname(file);

  /// Every change to the file runs through here, one at a time. Each is a read-modify-write of the
  /// whole file, and one file holds every provider's token: two in flight would each write back a
  /// file missing the other's change. A change that fails is reported to its caller and does not
  /// stop the next one. Reads need no turn: they see the file before a rename or after it.
  let changes = Promise.resolve();
  function queued(operation) {
    const run = changes.then(operation, operation);
    changes = run.catch(() => {});
    return run;
  }
  let written = 0;

  /// The file, classified. Total: every failure is a `state`, never a throw.
  ///
  ///   "missing"          - no file yet, the overwhelmingly common case
  ///   "current"          - this build's version, with its `values`
  ///   "from-the-future"  - a newer build's version
  ///   "unreadable"       - not JSON, not an object, or a version and shape no build here reads
  ///   "unopenable"       - present, but could not be read (held by another process, permissions)
  async function inspect() {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return { state: "missing", values: {} };
      return { state: "unopenable", reason: error?.code ?? error?.name, values: {} };
    }

    let stored;
    try {
      stored = JSON.parse(text);
    } catch {
      return { state: "unreadable", reason: "not-json", values: {} };
    }

    const version = stored?.schemaVersion;
    if (typeof version === "number" && version > schemaVersion) {
      return { state: "from-the-future", reason: "from-the-future", values: {} };
    }
    const values = stored?.[field];
    if (version !== schemaVersion || !values || typeof values !== "object" || Array.isArray(values)) {
      return { state: "unreadable", reason: version === schemaVersion ? "invalid" : "unknown-version", values: {} };
    }
    return { state: "current", values };
  }

  /// Every read answers with an object, however badly the file has gone wrong. One line when it has,
  /// naming the step and the reason - never the file's contents or its path.
  async function readAll() {
    const found = await inspect();
    if (found.state !== "current" && found.state !== "missing") {
      logger.warn?.(`Credential store (${field}) read: ignored the file (${found.reason}).`);
    }
    return found.values;
  }

  /// The read half of every change, and the guard on it (issue #235).
  ///
  /// Answers `{ ok: true, values }` when the file may be replaced, or `{ ok: false, reason }`:
  ///
  ///   - **From the future**: REFUSED, and the file is never touched. Reads already answer "no
  ///     credentials" for it; a write would replace every token the newer build holds with this
  ///     build's handful. Refusing costs a sign-in that does not stick on this build. The way out is
  ///     to run the newer build again, which finds every token where it left it.
  ///   - **Unreadable**: copied aside to `<file>.unreadable-<timestamp>`, then replaced. No build can
  ///     use a token in a file nobody can parse, so nothing is lost by moving it, and refusing would
  ///     leave the user unable to connect anything ever again. The copy is ciphertext still bound to
  ///     this machine and OS user, so it holds nothing readable anywhere else.
  ///   - **Unopenable**: refused - there is nothing to copy and no telling what it holds.
  async function readForChange() {
    const found = await inspect();
    if (found.state === "current" || found.state === "missing") return { ok: true, values: found.values };

    if (found.state === "unreadable") {
      await fs.copyFile(file, `${file}.unreadable-${backupStamp()}`, fs.constants.COPYFILE_EXCL);
      logger.warn?.(`Credential store (${field}) write: backed up the unreadable file (${found.reason}).`);
      return { ok: true, values: {} };
    }

    logger.warn?.(`Credential store (${field}) write: refused (${found.reason}).`);
    return { ok: false, reason: found.state === "from-the-future" ? "from-the-future" : "unopenable" };
  }

  /// Written via a temporary file and a rename, which is atomic: a reader sees the old file or the
  /// new one, never a half-written one. A truncated file would read as "no credentials", so a crash
  /// mid-write would silently lose every one of them.
  /// The temporary name is unique per write, so a write from another store over the same file (a
  /// second instance, or a second process) cannot rename this one's half-written file into place.
  async function writeAll(values) {
    written += 1;
    const temporary = `${file}.${process.pid}.${written}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temporary, JSON.stringify({ schemaVersion, [field]: values }), "utf8");
      await fs.rename(temporary, file);
    } catch (error) {
      // A unique name is never overwritten by the next write, so a failed one is cleared here.
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  function set(key, value) {
    return queued(async () => {
      if (!encryptor.isEncryptionAvailable()) {
        logger.error?.("Encryption is unavailable, so the credential was not stored.");
        return { ok: false, reason: "encryption-unavailable" };
      }

      const found = await readForChange();
      if (!found.ok) return found;
      const { values } = found;
      values[key] = encryptor.encryptString(value).toString("base64");
      await writeAll(values);
      return { ok: true };
    });
  }

  /// The value for a key. **Main process only** - never reachable over IPC.
  async function get(key) {
    const stored = (await readAll())[key];
    if (typeof stored !== "string") return null;

    try {
      return encryptor.decryptString(Buffer.from(stored, "base64"));
    } catch {
      logger.error?.("A stored credential could not be decrypted, and was treated as absent.");
      return null;
    }
  }

  /// Whether a USABLE value exists. This is what the renderer is allowed to know.
  ///
  /// It decrypts rather than merely checking for the entry, so a blob that cannot be read reports
  /// honestly - otherwise the interface would show "connected" against a credential no request can
  /// use.
  async function has(key) {
    return (await get(key)) !== null;
  }

  /// Answers `{ ok: true }`, or the refusal from `readForChange` - a result, not a throw, so a
  /// sign-out on a downgraded build reads as signed out (this build cannot see the token anyway)
  /// without rewriting the newer build's file.
  function remove(key) {
    return queued(async () => {
      const found = await readForChange();
      if (!found.ok) return found;
      const { values } = found;
      delete values[key];
      await writeAll(values);
      return { ok: true };
    });
  }

  /// Which keys hold a usable value. Keys, never values.
  async function keys() {
    const values = await readAll();
    const found = [];
    for (const key of Object.keys(values)) {
      if (await has(key)) found.push(key);
    }
    return found;
  }

  /// Drops every key not in `keep`.
  function retainOnly(keep) {
    const wanted = new Set(keep);
    return queued(async () => {
      const found = await readForChange();
      if (!found.ok) return found;
      const { values } = found;
      let changed = false;

      for (const key of Object.keys(values)) {
        if (wanted.has(key)) continue;
        delete values[key];
        changed = true;
      }

      if (changed) await writeAll(values);
      return { ok: true };
    });
  }

  return { set, get, has, remove, keys, retainOnly };
}

module.exports = { createEncryptedStore };
