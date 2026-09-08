"use strict";

const path = require("node:path");
const { createEncryptedStore } = require("./encryptedStore");

/// Where cloud provider credentials live: one token per provider.
///
/// **A separate file from the chat keys, deliberately.** Saving settings sweeps `chatKeys.json`,
/// dropping every key that does not belong to a configured chat profile - which is right for a key
/// whose only reason to exist is a profile, and catastrophic for a token whose reason to exist is an
/// account. A GitHub token in that file would be deleted the first time somebody removed a model,
/// signing them out of GitHub with nothing on screen connecting the two acts. The two files also
/// have separate histories, so a migration to one is not a corruption of the other.
///
/// The storage rules - ciphertext only, versioned, unreadable reads as absent, and no IPC channel
/// that returns a value - are `encryptedStore.js`, shared with the chat keys so there is one
/// implementation of them rather than one per credential.
///
/// **Only the token is kept.** Not the account name: a stored login is a second answer to "who is
/// this" that goes stale the moment a token is revoked or renamed, and the app would show a name for
/// an account it can no longer reach. Who a token belongs to is asked of the provider, which answers
/// and verifies the token in the same request.

const SCHEMA_VERSION = 1;

function accountsPath(userDataDir) {
  return path.join(userDataDir, "providerAccounts.json");
}

function createAccountStore({ userDataDir, encryptor, logger = console }) {
  const store = createEncryptedStore({
    file: accountsPath(userDataDir),
    field: "tokens",
    schemaVersion: SCHEMA_VERSION,
    encryptor,
    logger,
  });

  return {
    /// Keyed by provider kind - `github`, and whatever comes after it. One account per provider,
    /// which is what the folder browser can express: a second GitHub account would be a second tree
    /// with no way to say which one a repository row came from.
    setToken: (provider, token) => store.set(provider, token),
    /// **Main process only** - never reachable over IPC. A token in the renderer is a token in
    /// devtools, in the network panel, and in a renderer crash dump.
    getToken: (provider) => store.get(provider),
    /// Whether a usable token exists. This is what the renderer is allowed to know.
    hasToken: (provider) => store.has(provider),
    deleteToken: (provider) => store.remove(provider),
    /// Which providers hold a usable token. Providers, never tokens.
    connectedProviders: () => store.keys(),
  };
}

module.exports = { createAccountStore, accountsPath };
