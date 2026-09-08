"use strict";

const path = require("node:path");
const { normaliseEndpoint } = require("@trypthos/domain");
const { createEncryptedStore } = require("./encryptedStore");

/// Where AI provider API keys live.
///
/// Separate from settings.json for one reason: settings are a convenience the app can lose, and keys
/// are a credential it must not leak. Keeping them apart means the settings file can be copied,
/// diffed, attached to a bug report or synced without carrying a live key with it.
///
/// The storage rules - ciphertext only, versioned, unreadable reads as absent, no channel that
/// returns a key - live in `encryptedStore.js`, which `accountStore.js` uses as well. What is here
/// is the one thing particular to chat keys:
///
///   - **Keyed by endpoint, not by profile.** Two profiles pointing at the same provider are the
///     same account, so re-entering the key for a second model would be busywork.

const SCHEMA_VERSION = 1;

function secretsPath(userDataDir) {
  return path.join(userDataDir, "chatKeys.json");
}

/// The same provider typed two ways is one account, and the rule for deciding that lives in the
/// domain: the renderer asks the same question to decide whether to show "Key stored", so a second
/// copy here would drift and put the badge on the wrong profile.
const normalise = normaliseEndpoint;

function createSecretStore({ userDataDir, encryptor, logger = console }) {
  const store = createEncryptedStore({
    file: secretsPath(userDataDir),
    field: "keys",
    schemaVersion: SCHEMA_VERSION,
    encryptor,
    logger,
  });

  return {
    setKey: (endpoint, key) => store.set(normalise(endpoint), key),
    /// The key for an endpoint. **Main process only** - never reachable over IPC.
    getKey: (endpoint) => store.get(normalise(endpoint)),
    /// Whether a usable key exists. This is what the renderer is allowed to know.
    hasKey: (endpoint) => store.has(normalise(endpoint)),
    deleteKey: (endpoint) => store.remove(normalise(endpoint)),
    /// Which endpoints hold a usable key. Endpoints, never keys.
    endpointsWithKeys: () => store.keys(),
    /// Drops every key not belonging to one of `endpoints`.
    ///
    /// Called after settings are saved. Editing a profile's endpoint or deleting a profile would
    /// otherwise leave a live credential on disk for a provider the app no longer knows about, with
    /// nothing in the UI that could ever remove it.
    ///
    /// **This is why cloud provider tokens are in a different file.** A sweep driven by the chat
    /// profile list would take a GitHub token with it the first time somebody deleted a model.
    retainOnly: (endpoints) => store.retainOnly(endpoints.map(normalise)),
  };
}

module.exports = { createSecretStore, secretsPath };
