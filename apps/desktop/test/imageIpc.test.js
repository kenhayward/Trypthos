"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MAX_IMAGE_FILE_BYTES } = require("@trypthos/domain");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// Reading an image, which does not go through `file:read`.
///
/// The two channels do opposite things with the same bytes: one decodes them as text and refuses
/// anything binary, and this one does not look at them at all. That makes the boundary the thing
/// worth testing here - the guard is the same, and it has to still be.

/// One pixel of PNG. Small, real, and unmistakably binary: its second byte is 0x50 but its first is
/// 0x89, and it carries NUL bytes, which is exactly what the text read boundary refuses.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000a49444154789c6360000002000100" +
    "05fe02fea7b1a40000000049454e44ae426082",
  "hex",
);

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

async function withWorkspace(files, body) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-image-"));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-image-data-"));
  await fs.mkdir(path.join(base, "workspace"));
  const root = await fs.realpath(path.join(base, "workspace"));

  try {
    for (const [file, contents] of Object.entries(files)) {
      const full = path.join(root, file);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, contents);
    }

    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) },
      getWindow: () => null,
      userDataDir: userData,
      secrets: {
        endpointsWithKeys: async () => [],
        setKey: async () => {},
        deleteKey: async () => {},
        retainOnly: async () => {},
      },
      explorerIntegration: {
        supported: () => false,
        isRegistered: async () => false,
        register: async () => ({ ok: true }),
        unregister: async () => ({ ok: true }),
      },
    });

    const opened = await ipcMain.invoke("workspace:open");
    // Paths name their workspace now, and the id is the folder's name - a temporary directory here.
    const q = (path) => (path === "" ? opened.workspace.id : `${opened.workspace.id}/${path}`);
    await body({ ipcMain, root, q });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
}

test("answers with a data URL the window can draw", async () => {
  await withWorkspace({ "shot.png": PNG }, async ({ ipcMain, q }) => {
    const result = await ipcMain.invoke("file:readImage", { path: q("shot.png") });

    assert.equal(result.ok, true);
    assert.ok(result.dataUrl.startsWith("data:image/png;base64,"));
    // The bytes are the file's, unchanged - a picture that arrives altered is not the file.
    const encoded = result.dataUrl.slice("data:image/png;base64,".length);
    assert.deepEqual(Buffer.from(encoded, "base64"), PNG);
  });
});

// The reason this channel exists at all: `file:read` decodes, and would refuse these bytes.
test("reads what the text channel refuses", async () => {
  await withWorkspace({ "shot.png": PNG }, async ({ ipcMain, q }) => {
    const asText = await ipcMain.invoke("file:read", { path: q("shot.png") });
    assert.equal(asText.ok, false);
    assert.equal(asText.reason, "not-text");

    assert.equal((await ipcMain.invoke("file:readImage", { path: q("shot.png") })).ok, true);
  });
});

// The media type comes from the NAME, decided here. A renderer that could name it could tell the
// window to read one kind of file as another.
test("names the type from the file, and refuses a file that is not one", async () => {
  await withWorkspace({ "notes.md": "# Notes\n" }, async ({ ipcMain, q }) => {
    const result = await ipcMain.invoke("file:readImage", { path: q("notes.md") });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "not-an-image");
  });
});

// The boundary is unchanged by any of this. Bytes are still bytes inside the workspace only.
test("refuses a path that climbs out of the workspace", async () => {
  await withWorkspace({ "shot.png": PNG }, async ({ ipcMain, q }) => {
    const result = await ipcMain.invoke("file:readImage", { path: q("../outside.png") });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "permission-denied");
  });
});

test("refuses an image larger than the app will draw", async () => {
  await withWorkspace({}, async ({ ipcMain, root, q }) => {
    await fs.writeFile(path.join(root, "huge.png"), Buffer.alloc(MAX_IMAGE_FILE_BYTES + 1));

    const result = await ipcMain.invoke("file:readImage", { path: q("huge.png") });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "too-large");
    assert.equal(result.limitBytes, MAX_IMAGE_FILE_BYTES);
  });
});

test("refuses a malformed request before touching disk", async () => {
  await withWorkspace({}, async ({ ipcMain, q }) => {
    const result = await ipcMain.invoke("file:readImage", { path: q("a.png"), extra: true });
    assert.deepEqual(result, { ok: false, reason: "bad-request" });
  });
});
