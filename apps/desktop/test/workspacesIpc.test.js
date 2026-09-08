"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// Several folders open at once, through the real handlers.
///
/// The property under test is that a path now says WHICH folder it is in, and that the shell honours
/// exactly that: a path naming one workspace must never reach another's provider, and a workspace
/// that has been closed must stop answering. Both are boundary questions, so they are asked here
/// rather than in the renderer.

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

/// Two real folders on disk, opened one after the other through the dialog.
async function withTwoWorkspaces(first, second, body) {
  const roots = [];
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-multi-data-"));

  try {
    for (const files of [first, second]) {
      const base = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-multi-"));
      const root = await fs.realpath(base);
      roots.push(root);
      for (const [file, content] of Object.entries(files)) {
        const full = path.join(root, file);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content ?? "x", "utf8");
      }
    }

    let next = 0;
    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      // Answers with the next folder each time, which is how a user opens a second one.
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [roots[next++]] }) },
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

    const one = (await ipcMain.invoke("workspace:open")).workspace;
    const two = (await ipcMain.invoke("workspace:open")).workspace;
    await body({ ipcMain, one, two, roots });
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
    for (const root of roots) await fs.rm(root, { recursive: true, force: true });
  }
}

test("opens two folders as two workspaces with different ids", async () => {
  await withTwoWorkspaces({ "a.md": "one" }, { "a.md": "two" }, async ({ one, two }) => {
    assert.notEqual(one.id, two.id);
    assert.notEqual(one.ref.root, two.ref.root);
  });
});

/// The whole point. The same relative path in two workspaces is two different files, and the only
/// thing telling them apart is the workspace on the front.
test("reads the file the path names, not the same name in the other workspace", async () => {
  await withTwoWorkspaces({ "a.md": "one" }, { "a.md": "two" }, async ({ ipcMain, one, two }) => {
    const first = await ipcMain.invoke("file:read", { path: `${one.id}/a.md` });
    const second = await ipcMain.invoke("file:read", { path: `${two.id}/a.md` });

    assert.equal(first.content, "one");
    assert.equal(second.content, "two");
  });
});

test("lists each workspace separately, and says which one every row is in", async () => {
  await withTwoWorkspaces({ "a.md": null }, { "b.md": null }, async ({ ipcMain, one, two }) => {
    const first = await ipcMain.invoke("workspace:list", { path: one.id });
    const second = await ipcMain.invoke("workspace:list", { path: two.id });

    // The ids come back qualified, so the renderer can hand one straight to any other channel and
    // never has to work out which workspace a row belongs to.
    assert.deepEqual(
      first.nodes.map((node) => node.id),
      [`${one.id}/a.md`],
    );
    assert.deepEqual(
      second.nodes.map((node) => node.id),
      [`${two.id}/b.md`],
    );
  });
});

/// The boundary, restated for the thing that is new. Each workspace has its own guard, and a path
/// naming one cannot climb into the other even though both are open.
test("a path cannot climb from one workspace into another", async () => {
  await withTwoWorkspaces({ "a.md": "one" }, { "a.md": "two" }, async ({ ipcMain, one, roots }) => {
    const escape = path.relative(roots[0], path.join(roots[1], "a.md")).split(path.sep).join("/");
    const result = await ipcMain.invoke("file:read", { path: `${one.id}/${escape}` });

    assert.equal(result.ok, false);
  });
});

test("a path naming a workspace that is not open is refused", async () => {
  await withTwoWorkspaces({ "a.md": null }, { "b.md": null }, async ({ ipcMain }) => {
    const result = await ipcMain.invoke("file:read", { path: "NotOpen/a.md" });
    assert.deepEqual(result, { ok: false, reason: "no-workspace" });
  });
});

test("a closed workspace stops answering, and the other carries on", async () => {
  await withTwoWorkspaces({ "a.md": "one" }, { "a.md": "two" }, async ({ ipcMain, one, two }) => {
    assert.deepEqual(await ipcMain.invoke("workspace:close", { workspaceId: one.id }), { ok: true });

    const gone = await ipcMain.invoke("file:read", { path: `${one.id}/a.md` });
    assert.deepEqual(gone, { ok: false, reason: "no-workspace" });

    const still = await ipcMain.invoke("file:read", { path: `${two.id}/a.md` });
    assert.equal(still.content, "two");
  });
});

// Closing what is already closed is the state the caller wanted, not a failure to report.
test("closing a workspace twice is not a failure", async () => {
  await withTwoWorkspaces({ "a.md": null }, { "b.md": null }, async ({ ipcMain, one }) => {
    await ipcMain.invoke("workspace:close", { workspaceId: one.id });
    assert.deepEqual(await ipcMain.invoke("workspace:close", { workspaceId: one.id }), { ok: true });
  });
});

test("refuses a close that is not the shape it expects", async () => {
  await withTwoWorkspaces({ "a.md": null }, { "b.md": null }, async ({ ipcMain, one }) => {
    for (const payload of [undefined, {}, { workspaceId: 7 }, { workspaceId: one.id, force: true }]) {
      const result = await ipcMain.invoke("workspace:close", payload);
      assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(payload)}`);
    }
  });
});

/// Two trees over one directory would be two sets of tabs for the same files, each with its own idea
/// of what is in them.
test("opening the same folder twice answers with the workspace it is already open as", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-same-"));
  const root = await fs.realpath(base);
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-same-data-"));

  try {
    await fs.writeFile(path.join(root, "a.md"), "x", "utf8");
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

    const first = (await ipcMain.invoke("workspace:open")).workspace;
    const second = (await ipcMain.invoke("workspace:open")).workspace;
    assert.equal(second.id, first.id);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});
