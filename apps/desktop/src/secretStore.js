"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { normaliseEndpoint } = require("@trypthos/domain");

/// Where AI provider API keys live.
///
/// Separate from settings.json for one reason: settings are a convenience the app can lose, and keys
/// are a credential it must not leak. Keeping them apart means the settings file can be copied,
/// diffed, attached to a bug report or synced without carrying a live key with it.
///
/// Three rules hold this module together, and each one is a test:
///
///   - **Ciphertext only.** Encryption comes from Electron's `safeStorage`, which is backed by DPAPI
///     on Windows and the Keychain on macOS. If it is unavailable, a write FAILS - it never falls
///     back to plaintext, because doing so would put a live key in a readable file on exactly the
///     machines least able to protect it, silently.
///   - **Keyed by endpoint, not by profile.** Two profiles pointing at the same provider are the
///     same account, so re-entering the key for a second model would be busywork.
///   - **`getKey` is main-process only.** There is no IPC channel that returns a key, and there must
///     never be one: a key in the renderer is a key in devtools, in the network panel, and in a
///     renderer crash dump. The renderer asks `hasKey` and gets a boolean.
///
/// Losing a key is recoverable - the user pastes it again. Leaking one is not, so every ambiguous
/// case here resolves towards "no key".

const SCHEMA_VERSION = 1;

function secretsPath(userDataDir) {
  return path.join(userDataDir, "chatKeys.json");
}

/// The same provider typed two ways is one account, and the rule for deciding that lives in the
/// domain: the renderer asks the same question to decide whether to show "Key stored", so a second
/// copy here would drift and put the badge on the wrong profile.
const normalise = normaliseEndpoint;

function createSecretStore({ userDataDir, encryptor, logger = console }) {
  const file = secretsPath(userDataDir);

  /// Every read answers with a keys object, however badly the file has gone wrong.
  async function readAll() {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      return {}; // No file yet. The overwhelmingly common case.
    }

    try {
      const stored = JSON.parse(text);
      // A file from a newer build is not guessed at. Answering "no keys" costs the user a re-paste;
      // misreading a shape we do not know could write a mangled file back over the real one.
      if (stored?.schemaVersion !== SCHEMA_VERSION) {
        logger.warn?.(`Ignoring a chat key file at schema version ${stored?.schemaVersion}.`);
        return {};
      }
      return stored.keys && typeof stored.keys === "object" ? stored.keys : {};
    } catch {
      logger.error?.("The stored chat keys could not be read, and were ignored.");
      return {};
    }
  }

  /// Written via a temporary file and a rename, which is atomic: a reader sees the old file or the
  /// new one, never a half-written one. A truncated key file would read as "no keys", so a crash
  /// mid-write would silently lose every stored credential.
  async function writeAll(keys) {
    const temporary = `${file}.tmp`;
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(temporary, JSON.stringify({ schemaVersion: SCHEMA_VERSION, keys }), "utf8");
    await fs.rename(temporary, file);
  }

  async function setKey(endpoint, key) {
    if (!encryptor.isEncryptionAvailable()) {
      logger.error?.("Encryption is unavailable, so the key was not stored.");
      return { ok: false, reason: "encryption-unavailable" };
    }

    const keys = await readAll();
    keys[normalise(endpoint)] = encryptor.encryptString(key).toString("base64");
    await writeAll(keys);
    return { ok: true };
  }

  /// The key for an endpoint. **Main process only** - never reachable over IPC.
  async function getKey(endpoint) {
    const stored = (await readAll())[normalise(endpoint)];
    if (typeof stored !== "string") return null;

    try {
      return encryptor.decryptString(Buffer.from(stored, "base64"));
    } catch {
      // safeStorage blobs are bound to the machine and OS user, so a restored profile or a new
      // machine invalidates every one of them at once. That reads as "no key", not as a crash.
      logger.error?.("A stored chat key could not be decrypted, and was treated as absent.");
      return null;
    }
  }

  /// Whether a usable key exists. This is what the renderer is allowed to know.
  ///
  /// It decrypts rather than merely checking for the entry, so a blob that cannot be read reports
  /// honestly - otherwise the UI would show "key saved" against a key no request can use.
  async function hasKey(endpoint) {
    return (await getKey(endpoint)) !== null;
  }

  async function deleteKey(endpoint) {
    const keys = await readAll();
    delete keys[normalise(endpoint)];
    await writeAll(keys);
  }

  /// Which endpoints hold a usable key. Endpoints, never keys.
  async function endpointsWithKeys() {
    const keys = await readAll();
    const found = [];
    for (const endpoint of Object.keys(keys)) {
      if (await hasKey(endpoint)) found.push(endpoint);
    }
    return found;
  }

  /// Drops every key not belonging to one of `endpoints`.
  ///
  /// Called after settings are saved. Editing a profile's endpoint or deleting a profile would
  /// otherwise leave a live credential on disk for a provider the app no longer knows about, with
  /// nothing in the UI that could ever remove it.
  async function retainOnly(endpoints) {
    const keep = new Set(endpoints.map(normalise));
    const keys = await readAll();
    let changed = false;

    for (const endpoint of Object.keys(keys)) {
      if (keep.has(endpoint)) continue;
      delete keys[endpoint];
      changed = true;
    }

    if (changed) await writeAll(keys);
  }

  return { setKey, getKey, hasKey, deleteKey, endpointsWithKeys, retainOnly };
}

module.exports = { createSecretStore, secretsPath };
