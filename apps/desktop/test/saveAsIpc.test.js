"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// Save As, through the channel that serves it.
///
/// The whole point of this handler is the asymmetry: the renderer says "the user asked to save this
/// somewhere", and every decision about WHERE happens on this side. It cannot be tested by calling a
/// pure function, because what is being tested is that a destination the renderer never saw is
/// checked against the open workspace before anything is written.

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

/// A workspace on disk, opened through the real handlers, with a save dialog that answers whatever
/// the test tells it to.
async function withWorkspace(files, body) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-saveas-"));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-saveas-data-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-saveas-outside-"));
  await fs.mkdir(path.join(base, "workspace"));
  // realpath after creating it: the temp directory is itself a symlink on macOS (/var ->
  // /private/var), so an unresolved root would fail its own containment check.
  const root = await fs.realpath(path.join(base, "workspace"));

  try {
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(root, file);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content ?? "x", "utf8");
    }

    /// What the next save dialog answers with. An absolute path, as a real dialog returns.
    const dialogState = { answer: null, seen: [] };

    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [root] }),
        showSaveDialog: async (_window, options) => {
          dialogState.seen.push(options);
          return dialogState.answer === null
            ? { canceled: true, filePath: undefined }
            : { canceled: false, filePath: dialogState.answer };
        },
      },
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

    await ipcMain.invoke("workspace:open");
    await body({ ipcMain, root, outside, dialogState });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
}

// Creating a file is the ordinary case, and it is the only way the scratch buffer reaches disk.
test("writes the document where the dialog said, and answers with the path in workspace terms", async () => {
  await withWorkspace({}, async ({ ipcMain, root, dialogState }) => {
    dialogState.answer = path.join(root, "notes", "plan.md");
    await fs.mkdir(path.join(root, "notes"));

    const result = await ipcMain.invoke("file:saveAs", { path: null, content: "# Plan\n" });

    assert.equal(result.ok, true);
    // Workspace-relative and forward-slashed, because that is what a path IS everywhere else in the
    // app - the tab, the tree, a markdown link and a saved chat all name a file this way.
    assert.equal(result.path, "notes/plan.md");
    assert.ok(result.revision.id.length > 0);
    assert.equal(await fs.readFile(path.join(root, "notes", "plan.md"), "utf8"), "# Plan\n");
  });
});

// The native dialog already asked. Answering "conflict" here would be putting the same question a
// second time and refusing the answer the user gave to the first.
test("replaces a file the dialog offered to replace", async () => {
  await withWorkspace({ "top.md": "# Old\n" }, async ({ ipcMain, root, dialogState }) => {
    dialogState.answer = path.join(root, "top.md");

    const result = await ipcMain.invoke("file:saveAs", { path: "draft.md", content: "# New\n" });

    assert.equal(result.ok, true);
    assert.equal(await fs.readFile(path.join(root, "top.md"), "utf8"), "# New\n");
  });
});

/// The boundary, which is the reason this channel exists at all rather than the renderer being told
/// a path and asked to write it.
test("refuses a destination outside the open workspace, and writes nothing", async () => {
  await withWorkspace({}, async ({ ipcMain, outside, dialogState }) => {
    const target = path.join(outside, "escaped.md");
    dialogState.answer = target;

    const result = await ipcMain.invoke("file:saveAs", { path: null, content: "secret\n" });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "outside-workspace");
    await assert.rejects(() => fs.stat(target), "nothing may be written outside the workspace");
  });
});

test("cancelling the dialog is not a failure and writes nothing", async () => {
  await withWorkspace({ "top.md": "# Old\n" }, async ({ ipcMain, root, dialogState }) => {
    dialogState.answer = null;

    const result = await ipcMain.invoke("file:saveAs", { path: "top.md", content: "# New\n" });

    assert.deepEqual(result, { ok: false, reason: "cancelled" });
    assert.equal(await fs.readFile(path.join(root, "top.md"), "utf8"), "# Old\n");
  });
});

// Where the dialog opens, which is the only thing the renderer's `path` is for. A Save As from a
// file deep in the tree that opened at the root would make the user navigate back to where they
// already were.
test("opens the dialog beside the document being saved", async () => {
  await withWorkspace({ "notes/nested.md": "x" }, async ({ ipcMain, root, dialogState }) => {
    dialogState.answer = path.join(root, "notes", "copy.md");
    await ipcMain.invoke("file:saveAs", { path: "notes/nested.md", content: "x" });

    assert.equal(dialogState.seen[0].defaultPath, path.join(root, "notes", "nested.md"));
  });
});

test("opens the dialog at the workspace root for a document that has never been anywhere", async () => {
  await withWorkspace({}, async ({ ipcMain, root, dialogState }) => {
    dialogState.answer = path.join(root, "scratch.md");
    await ipcMain.invoke("file:saveAs", { path: null, content: "x" });

    assert.equal(dialogState.seen[0].defaultPath, root);
  });
});

// The renderer cannot name a destination. Trying is a protocol error, refused before a dialog is
// ever shown.
test("refuses a request that tries to name where the file should go", async () => {
  await withWorkspace({}, async ({ ipcMain, outside, dialogState }) => {
    const result = await ipcMain.invoke("file:saveAs", {
      path: null,
      content: "x",
      target: path.join(outside, "planted.md"),
    });

    assert.deepEqual(result, { ok: false, reason: "bad-request" });
    assert.equal(dialogState.seen.length, 0, "no dialog may open for a malformed request");
  });
});
