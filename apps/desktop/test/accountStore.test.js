"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAccountStore, accountsPath } = require("../src/accountStore");
const { createSecretStore } = require("../src/secretStore");

/// Cloud provider credentials, kept exactly as carefully as the chat keys are.
///
/// The reason this file exists at all rather than a second field in `chatKeys.json` is the sweep:
/// saving settings drops every chat key not belonging to a configured profile, and a GitHub token
/// sharing that file would be deleted the first time somebody removed a model. That is the last test
/// below, and it is the one worth reading.

/// A stand-in for Electron's safeStorage. Reversible rather than real encryption - what is being
/// proved is that the stored bytes are not the token, and that an unavailable platform refuses.
function fakeEncryptor({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`sealed:${value}`, "utf8"),
    decryptString: (buffer) => {
      const text = buffer.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("not ours");
      return text.slice("sealed:".length);
    },
  };
}

const silent = { warn: () => {}, error: () => {} };

async function withStore(body, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-accounts-"));
  const encryptor = fakeEncryptor(options);
  try {
    await body(createAccountStore({ userDataDir: dir, encryptor, logger: silent }), dir, encryptor);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("a token can be stored and read back within the main process", async () => {
  await withStore(async (store) => {
    assert.deepEqual(await store.setToken("github", "ghp_invented"), { ok: true });
    assert.equal(await store.getToken("github"), "ghp_invented");
  });
});

test("reports which providers are connected, without revealing a token", async () => {
  await withStore(async (store) => {
    assert.equal(await store.hasToken("github"), false);
    await store.setToken("github", "ghp_invented");
    assert.equal(await store.hasToken("github"), true);
    assert.deepEqual(await store.connectedProviders(), ["github"]);
  });
});

test("disconnecting removes the token", async () => {
  await withStore(async (store) => {
    await store.setToken("github", "ghp_invented");
    await store.deleteToken("github");
    assert.equal(await store.getToken("github"), null);
    assert.deepEqual(await store.connectedProviders(), []);
  });
});

test("the file on disk contains nothing resembling the token", async () => {
  await withStore(async (store, dir) => {
    await store.setToken("github", "ghp_invented");
    const written = await fs.readFile(accountsPath(dir), "utf8");

    assert.ok(!written.includes("ghp_invented"), "the token must not appear in the file");
    assert.ok(written.includes("schemaVersion"), "the file must say what shape it is");
  });
});

// Never a plaintext fallback. A machine that cannot encrypt is exactly the machine least able to
// protect a readable file, and failing loudly costs the user a re-paste rather than a leak.
test("refuses to store a token when the platform cannot encrypt it", async () => {
  await withStore(
    async (store, dir) => {
      const result = await store.setToken("github", "ghp_invented");
      assert.equal(result.ok, false);
      assert.equal(result.reason, "encryption-unavailable");

      await assert.rejects(() => fs.readFile(accountsPath(dir), "utf8"));
    },
    { available: false },
  );
});

// safeStorage blobs are bound to the machine and the OS user, so a restored profile invalidates
// every one at once. That reads as "not connected", which asks for a new token - not as a crash.
test("a token that will not decrypt reads as absent rather than throwing", async () => {
  await withStore(async (store, dir) => {
    await store.setToken("github", "ghp_invented");
    await fs.writeFile(
      accountsPath(dir),
      JSON.stringify({ schemaVersion: 1, tokens: { github: "bm90IG91cnM=" } }),
      "utf8",
    );

    assert.equal(await store.getToken("github"), null);
    assert.equal(await store.hasToken("github"), false);
  });
});

test("a file from a version this build does not know is not guessed at", async () => {
  await withStore(async (store, dir) => {
    await fs.writeFile(
      accountsPath(dir),
      JSON.stringify({ schemaVersion: 99, tokens: { github: "whatever" } }),
      "utf8",
    );
    assert.equal(await store.getToken("github"), null);
  });
});

/// The whole reason for a second file.
///
/// Saving settings sweeps the chat keys, dropping every one that does not belong to a configured
/// profile. A GitHub token in that file would have no profile, so it would go - and the user would
/// be signed out of GitHub by deleting a chat model, with nothing on screen connecting the two.
test("deleting every chat model does not disconnect GitHub", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-accounts-"));
  const encryptor = fakeEncryptor();
  try {
    const secrets = createSecretStore({ userDataDir: dir, encryptor, logger: silent });
    const accounts = createAccountStore({ userDataDir: dir, encryptor, logger: silent });

    await secrets.setKey("https://api.example.com/v1", "sk-invented");
    await accounts.setToken("github", "ghp_invented");

    // What `settings:write` does when the last profile is removed.
    await secrets.retainOnly([]);

    assert.deepEqual(await secrets.endpointsWithKeys(), []);
    assert.equal(await accounts.getToken("github"), "ghp_invented");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
