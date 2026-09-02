"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DEFAULT_SETTINGS } = require("@trypthos/domain");
const { registerIpcHandlers } = require("../src/ipcHandlers");
const { writeSettings } = require("../src/settingsStore");

/// The chat channels.
///
/// The property worth protecting here is that the renderer names a PROFILE, not an endpoint - so a
/// renderer cannot point Trypthos at a server of its choosing, and cannot reach a key by naming the
/// endpoint it belongs to.

const PROFILE = {
  id: "one",
  label: "Local model",
  endpoint: "https://api.example.com/v1",
  model: "some-model",
  supportsImages: false,
  isDefault: true,
};

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

/// Records what reached the renderer, and what the provider was asked to do.
function harness({ run } = {}) {
  const sent = [];
  const runs = [];

  const chat = {
    run:
      run ??
      (async ({ profile, turns, onEvent }) => {
        runs.push({ profile, turns });
        onEvent({ type: "token", text: "Hi" });
        onEvent({ type: "end" });
      }),
  };

  const window = { isDestroyed: () => false, webContents: { send: (channel, message) => sent.push({ channel, message }) } };
  return { sent, runs, chat, window };
}

async function withHandlers(body, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-chat-ipc-"));
  const noise = console.error;
  console.error = () => {};
  try {
    await writeSettings(dir, {
      ...DEFAULT_SETTINGS,
      chat: { profiles: options.profiles ?? [PROFILE] },
    });

    const ipcMain = fakeIpcMain();
    const { sent, runs, chat, window } = harness(options);
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => window,
      userDataDir: dir,
      secrets: {
        endpointsWithKeys: async () => [],
        setKey: async () => ({ ok: true }),
        deleteKey: async () => {},
        retainOnly: async () => {},
        getKey: async () => null,
      },
      chat,
    });

    await body({ ipcMain, sent, runs });
  } finally {
    console.error = noise;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const turns = [{ role: "user", content: "Hello" }];

test("starts a stream and names it, so replies can be told apart", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const result = await ipcMain.invoke("chat:send", { profileId: "one", turns });

    assert.equal(result.ok, true);
    assert.equal(typeof result.streamId, "string");
    assert.ok(result.streamId.length > 0);
  });
});

test("pushes the reply to the renderer, tagged with its stream", async () => {
  await withHandlers(async ({ ipcMain, sent }) => {
    const { streamId } = await ipcMain.invoke("chat:send", { profileId: "one", turns });

    assert.deepEqual(
      sent.map((entry) => entry.message),
      [
        { streamId, event: { type: "token", text: "Hi" } },
        { streamId, event: { type: "end" } },
      ],
    );
    assert.deepEqual([...new Set(sent.map((entry) => entry.channel))], ["chat:event"]);
  });
});

// The point of naming a profile rather than an endpoint. A renderer that could name its own endpoint
// could point Trypthos at any server on the internet and have it send whatever key was stored there.
test("resolves the profile from settings rather than trusting the renderer", async () => {
  await withHandlers(async ({ ipcMain, runs }) => {
    await ipcMain.invoke("chat:send", { profileId: "one", turns });

    assert.equal(runs[0].profile.endpoint, "https://api.example.com/v1");
    assert.equal(runs[0].profile.model, "some-model");
  });
});

test("refuses a profile id that is not configured", async () => {
  await withHandlers(async ({ ipcMain, runs }) => {
    const result = await ipcMain.invoke("chat:send", { profileId: "invented", turns });

    assert.deepEqual(result, { ok: false, reason: "no-such-profile" });
    assert.equal(runs.length, 0, "an unknown profile must never reach the provider");
  });
});

test("refuses a request that names an endpoint of its own", async () => {
  await withHandlers(async ({ ipcMain, runs }) => {
    const result = await ipcMain.invoke("chat:send", {
      profileId: "one",
      turns,
      endpoint: "https://attacker.example.com/v1",
    });

    assert.deepEqual(result, { ok: false, reason: "bad-request" });
    assert.equal(runs.length, 0);
  });
});

test("refuses a malformed request before anything is sent", async () => {
  await withHandlers(async ({ ipcMain, runs }) => {
    for (const payload of [
      null,
      {},
      { profileId: "one" },
      { profileId: "one", turns: [] },
      { profileId: "one", turns: [{ role: "wizard", content: "Hello" }] },
      { profileId: "one", turns: [{ role: "user" }] },
    ]) {
      const result = await ipcMain.invoke("chat:send", payload);
      assert.deepEqual(result, { ok: false, reason: "bad-request" });
    }

    assert.equal(runs.length, 0);
  });
});

test("cancelling a stream stops it", async () => {
  let aborted = false;
  await withHandlers(
    async ({ ipcMain, sent }) => {
      const { streamId } = await ipcMain.invoke("chat:send", { profileId: "one", turns });
      await ipcMain.invoke("chat:cancel", { streamId });

      assert.equal(aborted, true);
      assert.deepEqual(sent.at(-1).message.event, { type: "end" });
    },
    {
      run: async ({ signal, onEvent }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          onEvent({ type: "end" });
        });
        // Left running: the test cancels it.
        await new Promise((resolve) => signal.addEventListener("abort", resolve));
      },
    },
  );
});

test("cancelling a stream that has already finished is harmless", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const { streamId } = await ipcMain.invoke("chat:send", { profileId: "one", turns });
    assert.deepEqual(await ipcMain.invoke("chat:cancel", { streamId }), { ok: true });
  });
});

// The window can be closed while a reply is still arriving. Sending to a destroyed webContents
// throws, and that exception would surface as an unhandled rejection in the main process.
test("a reply arriving after the window has gone is dropped quietly", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-chat-ipc-"));
  try {
    await writeSettings(dir, { ...DEFAULT_SETTINGS, chat: { profiles: [PROFILE] } });

    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => null,
      userDataDir: dir,
      secrets: {
        endpointsWithKeys: async () => [],
        setKey: async () => ({ ok: true }),
        deleteKey: async () => {},
        retainOnly: async () => {},
        getKey: async () => null,
      },
      chat: {
        run: async ({ onEvent }) => {
          onEvent({ type: "token", text: "Hi" });
          onEvent({ type: "end" });
        },
      },
    });

    assert.equal((await ipcMain.invoke("chat:send", { profileId: "one", turns })).ok, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
