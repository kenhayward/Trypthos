"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { closeDecision, createCloseGuard } = require("../src/closeGuard");
const { registerWindowHandlers } = require("../src/windowHandlers");

/// The preload bridge, loaded for real against a stand-in `electron`.
///
/// Everything else in the shell is tested from the main process's side, with payloads the test
/// writes itself - which is exactly how an argument the bridge never forwards goes unnoticed. These
/// tests call the function the renderer calls and follow what arrives at the handler.

/// Loads `src/preload.js` with `electron` answered by a fake: `contextBridge` hands back what the
/// bridge exposes, and `ipcRenderer.invoke` routes into handlers registered on a fake `ipcMain`.
function loadBridge() {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  let exposed = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (_key, api) => (exposed = api) },
    ipcRenderer: {
      invoke: async (channel, payload) => handlers.get(channel)({ sender: { id: 1 } }, payload),
      on: () => {},
      removeListener: () => {},
    },
  };

  const file = path.join(__dirname, "..", "src", "preload.js");
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    return request === "electron" ? electron : original.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve(file)];
    require(file);
  } finally {
    Module._load = original;
  }
  return { bridge: exposed, ipcMain };
}

/// A window that behaves like main.js's: its close is intercepted by `closeDecision`, and an
/// intercepted close asks the renderer - here, counted - instead of closing.
function fakeWindow(guard) {
  const window = {
    closed: false,
    asked: 0,
    isDestroyed: () => false,
    close() {
      const decision = closeDecision({ forced: guard.forced(), hiding: false, dirty: guard.isDirty() });
      if (decision === "close") window.closed = true;
      else window.asked += 1;
    },
  };
  return window;
}

test("a close the renderer forces after Don't Save closes the window, dirty or not", async () => {
  const { bridge, ipcMain } = loadBridge();
  const guard = createCloseGuard({ dialog: {}, send: () => {} });
  const window = fakeWindow(guard);
  registerWindowHandlers({ ipcMain, getWindow: () => window, guard });

  await bridge.setDocumentDirty(true);
  // What App does once `mayDiscard` has been answered "discard".
  await bridge.closeWindow(true);

  assert.equal(window.asked, 0, "the close was intercepted and the prompt would be shown again");
  assert.equal(window.closed, true);
});

test("the vault calls reach their handlers with what the renderer passed", async () => {
  const { bridge, ipcMain } = loadBridge();
  const received = [];
  ipcMain.handle("obsidian:vaults", async (_event, payload) => {
    received.push(["vaults", payload]);
    return { ok: true, installed: false, vaults: [] };
  });
  ipcMain.handle("obsidian:openVault", async (_event, payload) => {
    received.push(["open", payload]);
    return { ok: false, reason: "not-found" };
  });

  await bridge.obsidianVaults();
  await bridge.openObsidianVault("aaaa1111bbbb2222");

  assert.deepEqual(received, [
    ["vaults", undefined],
    ["open", { id: "aaaa1111bbbb2222" }],
  ]);
});

test("an unforced close from the title bar still asks about unsaved work", async () => {
  const { bridge, ipcMain } = loadBridge();
  const guard = createCloseGuard({ dialog: {}, send: () => {} });
  const window = fakeWindow(guard);
  registerWindowHandlers({ ipcMain, getWindow: () => window, guard });

  await bridge.setDocumentDirty(true);
  await bridge.closeWindow();

  assert.equal(window.asked, 1);
  assert.equal(window.closed, false);
});
