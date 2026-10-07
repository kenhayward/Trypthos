"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DEFAULT_SETTINGS, IPC_CHANNELS, SETTINGS_VERSION, SettingsSchema } = require("@trypthos/domain");
const { createSecretStore } = require("../src/secretStore");
const { registerIpcHandlers } = require("../src/ipcHandlers");
const { readSettings, writeSettings } = require("../src/settingsStore");

/// The IPC side of key storage, and the guard that keeps it write-only.
///
/// The store's own tests prove a key is encrypted at rest. These prove the stronger property the
/// architecture actually rests on: that no channel the renderer can call will hand one back.

const KEY = "sk-test-do-not-use-90210";
const ENDPOINT = "https://api.example.com/v1";

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

function fakeEncryptor() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(text, "utf8").map((byte) => byte ^ 0x5a),
    decryptString: (buffer) => Buffer.from(buffer).map((byte) => byte ^ 0x5a).toString("utf8"),
  };
}

async function withHandlers(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-secrets-ipc-"));
  const noise = console.error;
  console.error = () => {};
  try {
    const ipcMain = fakeIpcMain();
    const secrets = createSecretStore({
      userDataDir: dir,
      encryptor: fakeEncryptor(),
      logger: { error: () => {}, warn: () => {} },
    });
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => null,
      userDataDir: dir,
      secrets,
    });
    await body({ ipcMain, secrets, dir });
  } finally {
    console.error = noise;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("a key stored over IPC is readable in the main process", async () => {
  await withHandlers(async ({ ipcMain, secrets }) => {
    const result = await ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY });

    assert.deepEqual(result, { ok: true });
    assert.equal(await secrets.getKey(ENDPOINT), KEY);
  });
});

test("the renderer is told which endpoints have a key, and nothing more", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY });
    const result = await ipcMain.invoke("secrets:list");

    assert.deepEqual(result, { ok: true, endpoints: [ENDPOINT] });
  });
});

test("a key can be removed over IPC", async () => {
  await withHandlers(async ({ ipcMain, secrets }) => {
    await ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY });
    assert.deepEqual(await ipcMain.invoke("secrets:delete", { endpoint: ENDPOINT }), { ok: true });
    assert.equal(await secrets.getKey(ENDPOINT), null);
  });
});

test("a malformed secret write is refused before it reaches the store", async () => {
  await withHandlers(async ({ ipcMain, secrets }) => {
    for (const payload of [
      { endpoint: "not a url", key: KEY },
      { endpoint: ENDPOINT, key: "" },
      { endpoint: ENDPOINT },
      { endpoint: ENDPOINT, key: KEY, extra: true },
      null,
    ]) {
      assert.deepEqual(await ipcMain.invoke("secrets:set", payload), {
        ok: false,
        reason: "bad-request",
      });
    }

    assert.deepEqual(await secrets.endpointsWithKeys(), []);
  });
});

test("a platform that cannot encrypt is reported rather than quietly ignored", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-secrets-ipc-"));
  try {
    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => null,
      userDataDir: dir,
      secrets: createSecretStore({
        userDataDir: dir,
        encryptor: { ...fakeEncryptor(), isEncryptionAvailable: () => false },
        logger: { error: () => {}, warn: () => {} },
      }),
    });

    // The UI has to be able to say "your key was not saved". A silent { ok: true } here would show a
    // saved key that no request can ever use.
    assert.deepEqual(await ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY }), {
      ok: false,
      reason: "encryption-unavailable",
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// Saving settings is the only moment the app learns a profile was deleted or repointed. Without the
// sweep, a live credential for a provider the app no longer knows about stays on disk forever, with
// nothing in the UI that could remove it.
test("saving settings drops keys for endpoints no profile uses any more", async () => {
  await withHandlers(async ({ ipcMain, secrets }) => {
    await ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY });
    await ipcMain.invoke("secrets:set", { endpoint: "https://old.example.com/v1", key: "sk-x-1" });

    await ipcMain.invoke("settings:write", {
      ...DEFAULT_SETTINGS,
      chat: {
        ...DEFAULT_SETTINGS.chat,
        systemPrompt: "",
        profiles: [
          {
            id: "one",
            label: "Kept",
            endpoint: ENDPOINT,
            model: "some-model",
            supportsImages: false,
            isDefault: true,
          },
        ],
      },
    });

    assert.deepEqual(await secrets.endpointsWithKeys(), [ENDPOINT]);
  });
});

// Issue #235. An older build reads a newer build's settings as defaults - no profiles - and the
// renderer writes them back. The write is refused in the main process, whatever the renderer sends,
// and the sweep must be refused with it: otherwise "no profiles" deletes every chat key on disk.
test("a settings write over a newer build's file is refused, and sweeps no keys", async () => {
  await withHandlers(async ({ ipcMain, secrets, dir }) => {
    const warnings = console.warn;
    console.warn = () => {};
    try {
      await ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY });
      const future = JSON.stringify({ ...DEFAULT_SETTINGS, schemaVersion: SETTINGS_VERSION + 1 });
      const file = path.join(dir, "settings.json");
      await fs.writeFile(file, future, "utf8");

      const result = await ipcMain.invoke("settings:write", DEFAULT_SETTINGS);

      assert.deepEqual(result, { ok: false, reason: "from-the-future" });
      assert.equal(await fs.readFile(file, "utf8"), future);
      assert.deepEqual(await secrets.endpointsWithKeys(), [ENDPOINT]);
    } finally {
      console.warn = warnings;
    }
  });
});

// Replacing an unreadable file is a successful write - of the DEFAULTS this build fell back to, with
// no profiles. Sweeping by them would delete every chat key the lost file's profiles used.
test("a settings write that replaces an unreadable file sweeps no keys", async () => {
  await withHandlers(async ({ ipcMain, secrets, dir }) => {
    const warnings = console.warn;
    console.warn = () => {};
    try {
      await ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY });
      await fs.writeFile(path.join(dir, "settings.json"), "{ this is not json", "utf8");

      const result = await ipcMain.invoke("settings:write", DEFAULT_SETTINGS);

      assert.deepEqual(result, { ok: true });
      assert.deepEqual(await secrets.endpointsWithKeys(), [ENDPOINT]);
    } finally {
      console.warn = warnings;
    }
  });
});

// A key file nobody can parse is backed up before it is replaced. If that backup collides (a second
// instance of the app, the same millisecond), the store answers a result - never an exception
// thrown across IPC - and the file is left as it was.
test("a key-file backup that collides answers a refusal over IPC instead of throwing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-secrets-ipc-"));
  try {
    const instant = new Date("2026-01-02T03:04:05.006Z");
    const file = path.join(dir, "chatKeys.json");
    await fs.writeFile(file, "{ this is not json", "utf8");
    await fs.writeFile(`${file}.unreadable-2026-01-02T03-04-05-006Z`, "taken", "utf8");

    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => null,
      userDataDir: dir,
      secrets: createSecretStore({
        userDataDir: dir,
        encryptor: fakeEncryptor(),
        logger: { error: () => {}, warn: () => {} },
        now: () => instant,
      }),
    });

    assert.deepEqual(await ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY }), {
      ok: false,
      reason: "backup-failed",
    });
    assert.deepEqual(await ipcMain.invoke("secrets:delete", { endpoint: ENDPOINT }), {
      ok: false,
      reason: "backup-failed",
    });
    assert.equal(await fs.readFile(file, "utf8"), "{ this is not json");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// The replaced file held the profiles; what this session holds started from defaults. A later,
// ordinary save sweeping by those would delete every key the lost profiles used. Held off until
// the app restarts and settings load cleanly.
test("after replacing an unreadable file, later settings writes in the session sweep no keys", async () => {
  await withHandlers(async ({ ipcMain, secrets, dir }) => {
    const warnings = console.warn;
    console.warn = () => {};
    try {
      await ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY });
      await fs.writeFile(path.join(dir, "settings.json"), "{ this is not json", "utf8");

      assert.deepEqual(await ipcMain.invoke("settings:write", DEFAULT_SETTINGS), { ok: true });
      assert.deepEqual(await ipcMain.invoke("settings:write", DEFAULT_SETTINGS), { ok: true });

      assert.deepEqual(await secrets.endpointsWithKeys(), [ENDPOINT]);
    } finally {
      console.warn = warnings;
    }
  });
});

// ---- Fix round 3: a failed load belongs to the window that will save from it ----
//
// The launch race: one window's settings:read hits a file it cannot open and answers defaults. That
// window's renderer will write those defaults back. Whether IT loaded is the question - not whether
// some other read (chat:send, the outline, another window) happened to succeed in between.

/// Parsed, so it carries every default a stored profile is read back with and compares equal.
const KEPT = SettingsSchema.parse({
  ...DEFAULT_SETTINGS,
  chat: {
    ...DEFAULT_SETTINGS.chat,
    profiles: [{ id: "one", label: "Kept", endpoint: ENDPOINT, model: "m", supportsImages: false, isDefault: true }],
  },
});

/// A window, as the IPC layer sees one: its handler calls carry `event.sender`.
function windowOf(ipcMain, id) {
  return {
    invoke: (channel, payload) => ipcMain.handlers.get(channel)({ sender: { id } }, payload),
  };
}

/// The settings file made unopenable the portable way: a directory where the file should be reads
/// as EISDIR on every platform, which the store treats exactly as a held file.
async function makeUnopenable(file) {
  await fs.rm(file, { force: true });
  await fs.mkdir(file);
}

async function makeReadable(dir, file, settings = KEPT) {
  await fs.rm(file, { recursive: true, force: true });
  await writeSettings(dir, settings);
}

/// Every one of these provokes a warn line on purpose.
async function withQuietSettings(body) {
  await withHandlers(async (context) => {
    const warnings = console.warn;
    console.warn = () => {};
    try {
      await context.ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY });
      await body({ ...context, file: path.join(context.dir, "settings.json") });
    } finally {
      console.warn = warnings;
    }
  });
}

// (a) The bypass the re-review found: a plain read for chat:send succeeding must not clear the flag
// of the window that holds defaults.
test("a window's failed load is not cleared by another read succeeding", async () => {
  await withQuietSettings(async ({ ipcMain, secrets, dir, file }) => {
    const window = windowOf(ipcMain, 1);
    await makeUnopenable(file);
    assert.deepEqual((await window.invoke("settings:read")).settings, DEFAULT_SETTINGS);

    await makeReadable(dir, file);
    const before = await fs.readFile(file, "utf8");
    assert.deepEqual(await readSettings(dir), KEPT); // what chat:send does

    assert.deepEqual(await window.invoke("settings:write", DEFAULT_SETTINGS), { ok: false, reason: "not-loaded" });
    assert.equal(await fs.readFile(file, "utf8"), before);
    assert.deepEqual(await secrets.endpointsWithKeys(), [ENDPOINT]);
  });
});

// (b) The converse: a transient failure in a main-process read mid-session is not this window's load.
test("a failed read for chat:send does not block a window that loaded", async () => {
  await withQuietSettings(async ({ ipcMain, dir, file }) => {
    const window = windowOf(ipcMain, 1);
    await makeReadable(dir, file);
    assert.deepEqual((await window.invoke("settings:read")).settings, KEPT);

    await makeUnopenable(file);
    await readSettings(dir); // chat:send, failing
    await makeReadable(dir, file);

    assert.deepEqual(await window.invoke("settings:write", KEPT), { ok: true });
  });
});

// (c) One window's failure is its own.
test("one window's failed load does not block another that loaded", async () => {
  await withQuietSettings(async ({ ipcMain, dir, file }) => {
    const loaded = windowOf(ipcMain, 1);
    const failed = windowOf(ipcMain, 2);
    await makeReadable(dir, file);
    assert.deepEqual((await loaded.invoke("settings:read")).settings, KEPT);

    await makeUnopenable(file);
    await failed.invoke("settings:read");
    await makeReadable(dir, file);

    assert.deepEqual(await loaded.invoke("settings:write", KEPT), { ok: true });
    assert.deepEqual(await failed.invoke("settings:write", DEFAULT_SETTINGS), { ok: false, reason: "not-loaded" });
  });
});

// (d) Whatever the file's state at write time - here, gone. Defaults written and swept by would
// otherwise delete every key.
test("a failed load followed by the file going missing still refuses, and sweeps nothing", async () => {
  await withQuietSettings(async ({ ipcMain, secrets, file }) => {
    const window = windowOf(ipcMain, 1);
    await makeUnopenable(file);
    await window.invoke("settings:read");
    await fs.rm(file, { recursive: true, force: true });

    assert.deepEqual(await window.invoke("settings:write", DEFAULT_SETTINGS), { ok: false, reason: "not-loaded" });
    await assert.rejects(fs.access(file));
    assert.deepEqual(await secrets.endpointsWithKeys(), [ENDPOINT]);
  });
});

// (e) The window's own successful re-read is what clears it.
test("after the window's own successful re-read, its writes work again", async () => {
  await withQuietSettings(async ({ ipcMain, dir, file }) => {
    const window = windowOf(ipcMain, 1);
    await makeUnopenable(file);
    await window.invoke("settings:read");
    await makeReadable(dir, file);

    assert.deepEqual((await window.invoke("settings:read")).settings, KEPT);
    assert.deepEqual(await window.invoke("settings:write", KEPT), { ok: true });
  });
});

// A window that loaded an unreadable file holds defaults on purpose and replaces that file - but
// only that file. If it has since become readable (or gone), its defaults must not land over it.
test("a window that loaded an unreadable file may replace it, and nothing else", async () => {
  await withQuietSettings(async ({ ipcMain, secrets, dir, file }) => {
    const window = windowOf(ipcMain, 1);
    await fs.writeFile(file, "{ this is not json", "utf8");
    await window.invoke("settings:read");
    await makeReadable(dir, file);
    const before = await fs.readFile(file, "utf8");

    assert.deepEqual(await window.invoke("settings:write", DEFAULT_SETTINGS), { ok: false, reason: "not-loaded" });
    assert.equal(await fs.readFile(file, "utf8"), before);
    assert.deepEqual(await secrets.endpointsWithKeys(), [ENDPOINT]);
  });
});

// What the main process hears from a refused write. A window whose load failed holds defaults that
// are NOT what the session runs on - another window may hold the real settings - so pushing them into
// main state would empty the recent-files menu and reset close-to-tray. A window that loaded a newer
// build's file is different: defaults are what every window of this build runs on, so main hears them.
async function heard(body) {
  const { onSettingsWritten } = require("../src/settingsStore");
  const seen = [];
  const stop = onSettingsWritten((settings) => seen.push(settings));
  try {
    await body(seen);
  } finally {
    stop();
  }
}

test("a write refused because the window's load failed is not pushed into main state", async () => {
  await withQuietSettings(async ({ ipcMain, file }) => {
    const window = windowOf(ipcMain, 1);
    await makeUnopenable(file);
    await window.invoke("settings:read");

    await heard(async (seen) => {
      assert.deepEqual(await window.invoke("settings:write", DEFAULT_SETTINGS), { ok: false, reason: "not-loaded" });
      assert.equal(seen.length, 0);
    });
  });
});

test("a write refused because the loaded unreadable file was since repaired is not pushed into main state", async () => {
  await withQuietSettings(async ({ ipcMain, dir, file }) => {
    const window = windowOf(ipcMain, 1);
    await fs.writeFile(file, "{ this is not json", "utf8");
    await window.invoke("settings:read");
    await makeReadable(dir, file);

    await heard(async (seen) => {
      assert.deepEqual(await window.invoke("settings:write", DEFAULT_SETTINGS), { ok: false, reason: "not-loaded" });
      assert.equal(seen.length, 0);
    });
  });
});

test("a write from a window that loaded a newer build's file is still pushed into main state", async () => {
  await withQuietSettings(async ({ ipcMain, file }) => {
    const window = windowOf(ipcMain, 1);
    await fs.writeFile(file, JSON.stringify({ schemaVersion: SETTINGS_VERSION + 1 }), "utf8");
    await window.invoke("settings:read");

    await heard(async (seen) => {
      assert.equal((await window.invoke("settings:write", DEFAULT_SETTINGS)).ok, false);
      assert.deepEqual(seen, [DEFAULT_SETTINGS]);
    });
  });
});

/// The guard.
///
/// Not a check that `secrets:get` is absent - that would only catch someone who named it obviously.
/// This calls EVERY registered channel with payloads shaped to draw a key out, and fails if the key
/// appears anywhere in any response. A future handler that returns settings-plus-keys, or echoes a
/// stored value in an error, fails here without anyone having thought to test for it.
test("no IPC channel returns a stored key, whatever it is asked", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("secrets:set", { endpoint: ENDPOINT, key: KEY });

    const payloads = [
      undefined,
      null,
      {},
      { endpoint: ENDPOINT },
      { endpoint: ENDPOINT, key: KEY },
      { path: "" },
      { path: "notes.md" },
      { root: "/" },
      DEFAULT_SETTINGS,
    ];

    for (const [channel, handler] of ipcMain.handlers) {
      for (const payload of payloads) {
        let response;
        try {
          response = await handler(null, payload);
        } catch (error) {
          response = { error: String(error) };
        }

        assert.ok(
          !JSON.stringify(response ?? null).includes(KEY),
          `${channel} returned a stored API key for payload ${JSON.stringify(payload ?? null)}`,
        );
      }
    }
  });
});

/// The other half of the seam.
///
/// The test below proves every channel in the contract has a handler. This one proves the RENDERER
/// can reach it: a channel with a handler that the preload never names is a feature that works in
/// every test and fails the first time somebody uses it, because the bridge is the only route in and
/// there is deliberately no general "invoke any channel" helper.
test("every channel in the contract is named by the preload bridge", () => {
  const preload = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "src", "preload.js"),
    "utf8",
  );

  const unreachable = IPC_CHANNELS.filter((channel) => !preload.includes(`"${channel}"`));
  assert.deepEqual(unreachable, []);
});

test("every channel the preload bridge names is registered, and vice versa", async () => {
  await withHandlers(async ({ ipcMain }) => {
    // Registered elsewhere: the window and document channels by windowHandlers, which owns the close
    // guard, and menu:popup in main, where the Menu module and the live BrowserWindow both are. The
    // guard still earns its place - it is what catches a channel added to the contract and never
    // wired up.
    const windowChannels = [
      "window:minimize",
      "window:toggleMaximize",
      "window:close",
      "document:dirty",
      "document:confirmDiscard",
      "document:takeDraft",
      "menu:popup",
    ];
    const registered = [...ipcMain.handlers.keys()].sort();
    const expected = IPC_CHANNELS.filter((channel) => !windowChannels.includes(channel)).sort();

    assert.deepEqual(registered, [...expected]);
  });
});
