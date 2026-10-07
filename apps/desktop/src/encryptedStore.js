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
///     mangled file back over the real one.
///   - **A value that will not decrypt reads as absent.** safeStorage blobs are bound to the machine
///     and the OS user, so a restored profile or a new machine invalidates every one at once. That
///     is a re-paste, not a crash.
///   - **Reading is main-process only.** No IPC channel returns a stored value, and there must never
///     be one - a credential in the renderer is a credential in devtools, in the network panel, and
///     in a renderer crash dump.
///
/// Losing a credential is recoverable. Leaking one is not, so every ambiguous case here resolves
/// towards "no credential".

/// Builds a store over one file.
///
/// `schemaVersion` and `field` belong to the caller rather than to this module: the two stores have
/// separate files with separate histories, and a shared version number would make a migration to one
/// look like a corruption of the other.
function createEncryptedStore({ file, field, schemaVersion, encryptor, logger = console }) {
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

  /// Every read answers with an object, however badly the file has gone wrong.
  async function readAll() {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      return {}; // No file yet. The overwhelmingly common case.
    }

    try {
      const stored = JSON.parse(text);
      if (stored?.schemaVersion !== schemaVersion) {
        logger.warn?.(`Ignoring ${path.basename(file)} at schema version ${stored?.schemaVersion}.`);
        return {};
      }
      const values = stored[field];
      return values && typeof values === "object" ? values : {};
    } catch {
      logger.error?.(`The stored ${path.basename(file)} could not be read, and was ignored.`);
      return {};
    }
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

      const values = await readAll();
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

  function remove(key) {
    return queued(async () => {
      const values = await readAll();
      delete values[key];
      await writeAll(values);
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
      const values = await readAll();
      let changed = false;

      for (const key of Object.keys(values)) {
        if (wanted.has(key)) continue;
        delete values[key];
        changed = true;
      }

      if (changed) await writeAll(values);
    });
  }

  return { set, get, has, remove, keys, retainOnly };
}

module.exports = { createEncryptedStore };
