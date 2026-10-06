"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { mediaUrl } = require("@trypthos/domain");
const { registerIpcHandlers, locateMedia } = require("../src/ipcHandlers");
const { createMediaHandler } = require("../src/mediaProtocol");

/// A local file through the real locator and the real protocol handler: the adapter that turns the
/// local provider's `{ path, size }` into the byte source the handler reads.
///
/// `mediaProtocol.test.js` proves the handler against an in-memory source; this proves the local
/// adapter's range really is the file's bytes, end to end.

const BODY = Buffer.from("0123456789ABCDEFGHIJ");

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

async function withWorkspace(body) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-media-ipc-"));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-media-ipc-data-"));
  await fs.mkdir(path.join(base, "workspace"));
  const root = await fs.realpath(path.join(base, "workspace"));
  try {
    await fs.writeFile(path.join(root, "clip.mp4"), BODY);
    await fs.writeFile(path.join(root, "empty.mp4"), Buffer.alloc(0));

    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) },
      getWindow: () => null,
      userDataDir: userData,
      secrets: { endpointsWithKeys: async () => [], setKey: async () => {}, deleteKey: async () => {}, retainOnly: async () => {} },
      explorerIntegration: { supported: () => false, isRegistered: async () => false },
    });
    const opened = await ipcMain.invoke("workspace:open");
    await body({ q: (file) => `${opened.workspace.id}/${file}` });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
}

test("a local file is a byte source that reads exactly the range it is asked for", async () => {
  await withWorkspace(async ({ q }) => {
    const found = await locateMedia(q("clip.mp4"));
    assert.equal(found.ok, true);
    assert.equal(found.size, 20);

    const opened = await found.open(5, 9);
    assert.equal(opened.ok, true);
    assert.equal(await new Response(opened.body).text(), "56789");
  });
});

test("the protocol serves a 206 from a local file through the real locator", async () => {
  await withWorkspace(async ({ q }) => {
    const handle = createMediaHandler({ locate: locateMedia });
    const response = await handle(new Request(mediaUrl(q("clip.mp4")), { headers: { Range: "bytes=10-14" } }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 10-14/20");
    assert.equal(await response.text(), "ABCDE");
  });
});

test("a missing local file and an unopened workspace are refused, not thrown", async () => {
  await withWorkspace(async ({ q }) => {
    assert.equal((await locateMedia(q("nothing.mp4"))).ok, false);
    assert.deepEqual(await locateMedia("Elsewhere/clip.mp4"), { ok: false, reason: "no-workspace" });
  });
});
