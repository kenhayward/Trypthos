"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// The folder map chat is given, through the handler that serves it.
///
/// This file exists because there was no test on this channel at all, and a handler that threw on
/// its first line went out in two releases: `OutlineRequest` was added to the domain's `ipc.ts` and
/// never exported from the barrel, so the destructure bound `undefined`. Every call rejected, the
/// renderer had no `.catch`, and chat's folder was silently empty.
///
/// Exercising the handler is what makes that impossible to repeat. The unit test underneath it
/// passed the whole time - it calls `outlineWorkspace` directly, which is the half that was fine.

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

/// A real workspace on disk, opened through the real handlers.
async function withWorkspace(files, body) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-outline-ipc-"));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-outline-data-"));
  const root = await fs.realpath(base);

  try {
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(root, file);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content ?? "x", "utf8");
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

    // Through the dialog, the way a user opens one.
    await ipcMain.invoke("workspace:open");
    await body({ ipcMain, root });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
}

test("answers with the files at the workspace root", async () => {
  await withWorkspace({ "top.md": null, "notes/inner.md": null }, async ({ ipcMain }) => {
    const result = await ipcMain.invoke("workspace:outline", { path: "" });

    assert.equal(result.ok, true);
    assert.deepEqual(result.outline.paths, ["top.md"]);
    assert.equal(result.outline.path, "");
  });
});

// The case the bug was reported against: a folder chosen in the tree rather than the root.
test("answers with the files in the folder it was given", async () => {
  await withWorkspace(
    { "top.md": null, "notes/inner.md": null, "notes/other.md": null },
    async ({ ipcMain }) => {
      const result = await ipcMain.invoke("workspace:outline", { path: "notes" });

      assert.equal(result.ok, true);
      assert.deepEqual(result.outline.paths, ["notes/inner.md", "notes/other.md"]);
      assert.equal(result.outline.path, "notes");
    },
  );
});

// It must REFUSE rather than throw. A rejected invoke is what made the original failure silent: the
// renderer's `.then` never ran, and nothing anywhere said why.
test("refuses a malformed request rather than throwing", async () => {
  await withWorkspace({ "top.md": null }, async ({ ipcMain }) => {
    for (const payload of [undefined, {}, { path: 7 }, { path: "", extra: true }]) {
      const result = await ipcMain.invoke("workspace:outline", payload);
      assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(payload)}`);
    }
  });
});

// The no-workspace path is deliberately not tested here. `registerIpcHandlers` keeps the open
// workspace in module state - not exported, and not settable except by the user choosing a folder -
// so a test for "nothing open" would only pass while it ran before any test that opens one. An
// assertion that depends on file order is one that fails for a reason nobody can read.
