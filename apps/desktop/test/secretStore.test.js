"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createSecretStore, secretsPath } = require("../src/secretStore");

/// A stand-in for Electron's safeStorage.
///
/// Hand-written rather than mocked, and deliberately a real transform: a fake that returned the
/// plaintext unchanged would pass the round-trip tests while making the "nothing readable on disk"
/// test vacuous - it would be asserting that a string is absent from a file that contains it.
function fakeEncryptor({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(text, "utf8").map((byte) => byte ^ 0x5a),
    decryptString: (buffer) => Buffer.from(buffer).map((byte) => byte ^ 0x5a).toString("utf8"),
  };
}

const silent = { error: () => {}, warn: () => {} };

async function withStore(body, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-secrets-"));
  try {
    const encryptor = options.encryptor ?? fakeEncryptor();
    await body(createSecretStore({ userDataDir: dir, encryptor, logger: silent }), dir, encryptor);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const ENDPOINT = "https://api.example.com/v1";
const KEY = "sk-test-do-not-use-90210";

test("a key can be stored and read back within the main process", async () => {
  await withStore(async (store) => {
    assert.deepEqual(await store.setKey(ENDPOINT, KEY), { ok: true });
    assert.equal(await store.getKey(ENDPOINT), KEY);
  });
});

test("reports which endpoints have a key, without revealing any", async () => {
  await withStore(async (store) => {
    assert.equal(await store.hasKey(ENDPOINT), false);
    await store.setKey(ENDPOINT, KEY);
    assert.equal(await store.hasKey(ENDPOINT), true);

    const endpoints = await store.endpointsWithKeys();
    assert.deepEqual(endpoints, [ENDPOINT]);
    assert.ok(!JSON.stringify(endpoints).includes(KEY));
  });
});

test("deleting a key removes it", async () => {
  await withStore(async (store) => {
    await store.setKey(ENDPOINT, KEY);
    await store.deleteKey(ENDPOINT);

    assert.equal(await store.hasKey(ENDPOINT), false);
    assert.equal(await store.getKey(ENDPOINT), null);
  });
});

// The whole reason this module exists rather than a field in settings.json.
test("the file on disk contains nothing resembling the key", async () => {
  await withStore(async (store, dir) => {
    await store.setKey(ENDPOINT, KEY);

    const raw = await fs.readFile(secretsPath(dir), "utf8");
    assert.ok(!raw.includes(KEY), "the key itself is on disk in plain text");
    assert.ok(!raw.includes("sk-test"), "a recognisable prefix of the key is on disk");
    // The endpoint is not a secret and is needed to look the key up, so it is expected here.
    assert.ok(raw.includes(ENDPOINT));
  });
});

// Refusing is the only safe answer. Falling back to plaintext would put a live key in a readable
// file precisely on the machines least able to protect it, and the user would never be told.
test("refuses to store a key when the platform cannot encrypt it", async () => {
  await withStore(
    async (store, dir) => {
      const result = await store.setKey(ENDPOINT, KEY);
      assert.deepEqual(result, { ok: false, reason: "encryption-unavailable" });

      await assert.rejects(fs.readFile(secretsPath(dir), "utf8"));
    },
    { encryptor: fakeEncryptor({ available: false }) },
  );
});

// safeStorage blobs are tied to the machine and the OS user. Restore a profile onto a new machine
// and every stored blob becomes undecryptable at once - which must read as "no key", not as a crash
// on the path that opens the chat panel.
test("an entry that will not decrypt reads as absent rather than throwing", async () => {
  await withStore(async (store, dir) => {
    await store.setKey(ENDPOINT, KEY);
    const stored = JSON.parse(await fs.readFile(secretsPath(dir), "utf8"));
    stored.keys[ENDPOINT] = "not-base64-at-all!!";
    await fs.writeFile(secretsPath(dir), JSON.stringify(stored), "utf8");

    const broken = createSecretStore({
      userDataDir: dir,
      encryptor: {
        isEncryptionAvailable: () => true,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => {
          throw new Error("Failed to decrypt");
        },
      },
      logger: silent,
    });

    assert.equal(await broken.getKey(ENDPOINT), null);
    assert.equal(await broken.hasKey(ENDPOINT), false);
  });
});

test("a corrupt secrets file reads as no keys at all", async () => {
  await withStore(async (store, dir) => {
    await fs.writeFile(secretsPath(dir), "{ this is not json", "utf8");
    assert.deepEqual(await store.endpointsWithKeys(), []);
  });
});

// The same endpoint typed two ways is the same provider and the same key. Without this a user
// re-enters their key because they added a trailing slash, and neither entry looks wrong.
test("endpoints differing only in trailing slash or case share one key", async () => {
  await withStore(async (store) => {
    await store.setKey("https://API.Example.com/v1/", KEY);
    assert.equal(await store.getKey("https://api.example.com/v1"), KEY);
  });
});

// The path a key is deleted through, when a profile's endpoint is edited or the profile removed.
test("keys not belonging to any configured endpoint can be swept", async () => {
  await withStore(async (store) => {
    await store.setKey(ENDPOINT, KEY);
    await store.setKey("https://old.example.com/v1", "sk-test-stale-11111");

    await store.retainOnly([ENDPOINT]);

    assert.deepEqual(await store.endpointsWithKeys(), [ENDPOINT]);
  });
});

test("sweeping with nothing configured clears the file", async () => {
  await withStore(async (store) => {
    await store.setKey(ENDPOINT, KEY);
    await store.retainOnly([]);
    assert.deepEqual(await store.endpointsWithKeys(), []);
  });
});

// Persisted data carries a schemaVersion, like everything else the app writes. A reader that
// silently tolerates an old shape is how corruption becomes permanent.
test("the stored file is versioned, and a future version is not guessed at", async () => {
  await withStore(async (store, dir) => {
    await store.setKey(ENDPOINT, KEY);
    const stored = JSON.parse(await fs.readFile(secretsPath(dir), "utf8"));
    assert.equal(stored.schemaVersion, 1);

    await fs.writeFile(
      secretsPath(dir),
      JSON.stringify({ schemaVersion: 99, keys: { [ENDPOINT]: "whatever" } }),
      "utf8",
    );
    assert.deepEqual(await store.endpointsWithKeys(), []);
  });
});
