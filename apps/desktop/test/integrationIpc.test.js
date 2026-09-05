"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// The two channels behind the Explorer integration switch.
///
/// The registry is the only record of whether the entries exist - the user can remove them without
/// telling us - so the renderer asks rather than remembering, and every answer here comes from the
/// integration itself.

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
    has: (channel) => handlers.has(channel),
  };
}

/// Stands in for the registry, recording what it was asked to do.
function fakeIntegration(over = {}) {
  const calls = [];
  let registered = over.registered ?? false;
  return {
    calls,
    integration: {
      supported: () => over.supported ?? true,
      isRegistered: async () => registered,
      register: async () => {
        calls.push("register");
        registered = true;
        return { ok: true };
      },
      unregister: async () => {
        calls.push("unregister");
        registered = false;
        return { ok: true };
      },
    },
  };
}

async function withHandlers(over, body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-integration-"));
  const { calls, integration } = fakeIntegration(over);
  try {
    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => null,
      userDataDir: dir,
      secrets: {
        endpointsWithKeys: async () => [],
        setKey: async () => {},
        deleteKey: async () => {},
        retainOnly: async () => {},
      },
      explorerIntegration: integration,
    });
    await body({ ipcMain, calls });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("reports whether the entries are there, and whether they can be", async () => {
  await withHandlers({ registered: true }, async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("shell:integration"), {
      ok: true,
      supported: true,
      registered: true,
    });
  });
});

test("adds the entries when the switch goes on", async () => {
  await withHandlers({ registered: false }, async ({ ipcMain, calls }) => {
    const result = await ipcMain.invoke("shell:setIntegration", { enabled: true });

    assert.deepEqual(calls, ["register"]);
    // Answers with the state that follows, so the switch reflects what actually happened rather than
    // what was asked for.
    assert.deepEqual(result, { ok: true, supported: true, registered: true });
  });
});

test("takes them away again when it goes off", async () => {
  await withHandlers({ registered: true }, async ({ ipcMain, calls }) => {
    const result = await ipcMain.invoke("shell:setIntegration", { enabled: false });

    assert.deepEqual(calls, ["unregister"]);
    assert.equal(result.registered, false);
  });
});

test("refuses a request that is not a boolean", async () => {
  await withHandlers({}, async ({ ipcMain, calls }) => {
    const result = await ipcMain.invoke("shell:setIntegration", { enabled: "yes" });

    assert.equal(result.ok, false);
    assert.deepEqual(calls, []);
  });
});

// Everywhere but a packaged Windows build there is nothing to register, and the interface asks so it
// can say why the switch is not there rather than offering one that does nothing.
test("says it is unsupported rather than pretending", async () => {
  await withHandlers({ supported: false }, async ({ ipcMain, calls }) => {
    assert.deepEqual(await ipcMain.invoke("shell:integration"), {
      ok: true,
      supported: false,
      registered: false,
    });

    const result = await ipcMain.invoke("shell:setIntegration", { enabled: true });
    assert.equal(result.supported, false);
    assert.deepEqual(calls, []);
  });
});

// The channels exist whatever the platform, so the renderer's bridge is the same everywhere and the
// answer to "can I?" comes from one place.
test("registers both channels even where they cannot do anything", async () => {
  await withHandlers({ supported: false }, async ({ ipcMain }) => {
    assert.ok(ipcMain.has("shell:integration"));
    assert.ok(ipcMain.has("shell:setIntegration"));
  });
});
