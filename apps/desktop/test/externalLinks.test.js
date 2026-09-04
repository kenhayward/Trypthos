"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// The channel that hands a URL to the operating system.
///
/// This is the one handler whose argument leaves the app entirely, so it is the one where trusting
/// the renderer costs the most: `shell.openExternal` will happily launch a registered protocol
/// handler, and Windows has several that do considerably more than open a page. The renderer having
/// already decided a link was external is not a decision.

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

async function withHandlers(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-external-"));
  const noise = console.error;
  console.error = () => {};
  try {
    const opened = [];
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
      openExternal: async (url) => opened.push(url),
    });
    await body({ ipcMain, opened });
  } finally {
    console.error = noise;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("opens a web address in the user's browser", async () => {
  await withHandlers(async ({ ipcMain, opened }) => {
    const result = await ipcMain.invoke("shell:openExternal", { url: "https://example.com/a" });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(opened, ["https://example.com/a"]);
  });
});

test("opens a mailto address, which the OS hands to the mail client", async () => {
  await withHandlers(async ({ ipcMain, opened }) => {
    await ipcMain.invoke("shell:openExternal", { url: "mailto:ada@example.com" });

    assert.deepEqual(opened, ["mailto:ada@example.com"]);
  });
});

test("refuses every scheme but the three, without reaching the operating system", async () => {
  await withHandlers(async ({ ipcMain, opened }) => {
    const refused = [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ms-msdt:/id PCWDiagnostic",
      "search-ms:query=x",
      "vbscript:msgbox",
      "notes.md",
      "\\\\server\\share\\payload.exe",
    ];

    for (const url of refused) {
      const result = await ipcMain.invoke("shell:openExternal", { url });
      assert.deepEqual(result, { ok: false, reason: "bad-request" }, `${url} was not refused`);
    }

    assert.deepEqual(opened, [], "nothing refused may reach the operating system");
  });
});

test("refuses a malformed payload", async () => {
  await withHandlers(async ({ ipcMain, opened }) => {
    for (const payload of [null, {}, { url: "" }, { url: 42 }, { url: "https://a", extra: 1 }]) {
      const result = await ipcMain.invoke("shell:openExternal", payload);
      assert.deepEqual(result, { ok: false, reason: "bad-request" });
    }

    assert.deepEqual(opened, []);
  });
});

// Opening a link does not need a folder open, and must not depend on one: the About box and the chat
// panel both render links before anybody has chosen a workspace.
test("works with no workspace open", async () => {
  await withHandlers(async ({ ipcMain, opened }) => {
    await ipcMain.invoke("shell:openExternal", { url: "https://example.com" });

    assert.deepEqual(opened, ["https://example.com"]);
  });
});
