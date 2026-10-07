"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAccountStore, accountsPath } = require("../src/accountStore");
const { createSecretStore } = require("../src/secretStore");
const { createEncryptedStore } = require("../src/encryptedStore");

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

// ---- Final review I1: one file, every provider's writes ----

// Each write is a read-modify-write of the one file. Unqueued, two providers writing at once (a
// OneDrive refresh, which writes every time, beside a Google sign-in) each wrote back a file
// missing the other's token - or collided on one temporary name and threw.
test("two providers storing at the same moment both keep their token", async () => {
  await withStore(async (store) => {
    for (let round = 0; round < 10; round += 1) {
      await store.deleteToken("google");
      await store.deleteToken("onedrive");
      const results = await Promise.all([
        store.setToken("google", `google-invented-${round}`),
        store.setToken("onedrive", `onedrive-invented-${round}`),
      ]);
      assert.deepEqual(results, [{ ok: true }, { ok: true }]);
      assert.equal(await store.getToken("google"), `google-invented-${round}`);
      assert.equal(await store.getToken("onedrive"), `onedrive-invented-${round}`);
    }
  });
});

test("one provider signing out while another stores leaves the other's token", async () => {
  await withStore(async (store) => {
    for (let round = 0; round < 10; round += 1) {
      await store.setToken("github", "ghp_invented");
      await Promise.all([store.deleteToken("github"), store.setToken("onedrive", `onedrive-invented-${round}`)]);
      assert.equal(await store.getToken("github"), null);
      assert.equal(await store.getToken("onedrive"), `onedrive-invented-${round}`);
    }
  });
});

test("a write that fails does not stop the next one", async () => {
  await withStore(async (store, dir, encryptor) => {
    const real = encryptor.encryptString;
    let failOnce = true;
    encryptor.encryptString = (value) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("sealing failed");
      }
      return real(value);
    };
    const failing = store.setToken("google", "google-invented");
    const next = store.setToken("onedrive", "onedrive-invented");
    await assert.rejects(failing);
    assert.deepEqual(await next, { ok: true });
    assert.equal(await store.getToken("onedrive"), "onedrive-invented");
    assert.equal(await store.getToken("google"), null);
  });
});

// ---- Issue #235: an older build must never write over a newer build's file ----

/// What a newer build would leave behind. This build reads it as "no tokens" - and before the fix,
/// the next sign-in wrote a file holding only the new token over every token the newer build kept.
const FUTURE_TEXT = JSON.stringify({ schemaVersion: 99, tokens: { github: "c2VhbGVkOmdocF9pbnZlbnRlZA==" } });

test("a newer build's token file survives a store and a delete, byte for byte", async () => {
  await withStore(async (store, dir) => {
    await fs.writeFile(accountsPath(dir), FUTURE_TEXT, "utf8");

    assert.deepEqual(await store.setToken("google", "google-invented"), {
      ok: false,
      reason: "from-the-future",
    });
    assert.deepEqual(await store.deleteToken("github"), { ok: false, reason: "from-the-future" });

    assert.equal(await fs.readFile(accountsPath(dir), "utf8"), FUTURE_TEXT);
    assert.deepEqual(await fs.readdir(dir), ["providerAccounts.json"]);
  });
});

test("a refused credential write logs one line, naming the step and the reason and nothing stored", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-accounts-"));
  try {
    const lines = [];
    const record = (...args) => lines.push(args.join(" "));
    const store = createAccountStore({ userDataDir: dir, encryptor: fakeEncryptor(), logger: { warn: record, error: record } });
    await fs.writeFile(accountsPath(dir), FUTURE_TEXT, "utf8");

    await store.setToken("google", "google-invented");

    assert.equal(lines.length, 1);
    assert.match(lines[0], /write/i);
    assert.match(lines[0], /from-the-future/);
    assert.doesNotMatch(lines[0], /providerAccounts|c2VhbGVk|google-invented/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/// A file nothing can parse holds no token any build could use, and refusing would leave the user
/// unable to connect anything ever again. The bytes are kept beside it, then the file is replaced.
test("an unparseable token file is backed up beside itself, then replaced", async () => {
  await withStore(async (store, dir) => {
    const corrupt = "{ this is not json";
    await fs.writeFile(accountsPath(dir), corrupt, "utf8");

    assert.deepEqual(await store.setToken("github", "ghp_invented"), { ok: true });
    assert.equal(await store.getToken("github"), "ghp_invented");

    const backups = (await fs.readdir(dir)).filter((name) => name.startsWith("providerAccounts.json.unreadable-"));
    assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(dir, backups[0]), "utf8"), corrupt);

    // Once replaced the file is current, so the next write is an ordinary one.
    await store.setToken("google", "google-invented");
    assert.equal((await fs.readdir(dir)).length, 2);
  });
});

test("a current token file still stores and deletes normally", async () => {
  await withStore(async (store, dir) => {
    assert.deepEqual(await store.setToken("github", "ghp_invented"), { ok: true });
    assert.deepEqual(await store.setToken("google", "google-invented"), { ok: true });
    assert.deepEqual(await store.deleteToken("github"), { ok: true });
    assert.deepEqual(await store.connectedProviders(), ["google"]);
    assert.deepEqual(await fs.readdir(dir), ["providerAccounts.json"]);
  });
});

/// The settings write sweeps the chat keys by the profiles it holds. A sweep over a newer build's
/// key file would rewrite it in this build's shape, losing whatever it could not read.
test("sweeping a newer build's key file leaves it byte for byte", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-accounts-"));
  try {
    const secrets = createSecretStore({ userDataDir: dir, encryptor: fakeEncryptor(), logger: silent });
    const future = JSON.stringify({ schemaVersion: 99, keys: { "https://api.example.com/v1": "c2VhbGVk" } });
    const file = path.join(dir, "chatKeys.json");
    await fs.writeFile(file, future, "utf8");

    assert.deepEqual(await secrets.retainOnly([]), { ok: false, reason: "from-the-future" });
    assert.equal(await fs.readFile(file, "utf8"), future);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/// A file held by another process (EBUSY on Windows) cannot be read, so nothing is known about what
/// it holds. Writing would replace every token in it with this one; backing it up is impossible.
test("a token file that cannot be opened is refused, with no backup and the bytes unchanged", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-accounts-"));
  try {
    const encryptor = fakeEncryptor();
    const file = accountsPath(dir);
    await createAccountStore({ userDataDir: dir, encryptor, logger: silent }).setToken("github", "ghp_invented");
    const before = await fs.readFile(file, "utf8");

    const held = createEncryptedStore({
      file,
      field: "tokens",
      schemaVersion: 1,
      encryptor,
      logger: silent,
      readFile: async () => {
        throw Object.assign(new Error("held"), { code: "EBUSY" });
      },
    });

    assert.deepEqual(await held.set("google", "google-invented"), { ok: false, reason: "unopenable" });
    assert.deepEqual(await held.remove("github"), { ok: false, reason: "unopenable" });
    assert.deepEqual(await held.retainOnly([]), { ok: false, reason: "unopenable" });
    assert.equal(await fs.readFile(file, "utf8"), before);
    assert.deepEqual(await fs.readdir(dir), ["providerAccounts.json"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
