"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");
const { searchNames } = require("../src/nameSearch");

/// The browser's filter box, through the handler that serves it.
///
/// Exercised through the real handler rather than through the walker underneath, following
/// `findIpc.test.js`: the failure that file was written for - a schema added to the domain and never
/// exported from the barrel, so the destructure bound `undefined` and every call rejected - is
/// invisible to a unit test of the half that was fine.

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

async function withWorkspace(files, body) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-filter-ipc-"));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-filter-data-"));
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

    const opened = await ipcMain.invoke("workspace:open");
    // Paths name their workspace now. The id comes from the folder's name, which is a temporary
    // directory here - so the tests learn it rather than assume it.
    const q = (relative) => (relative === "" ? opened.workspace.id : `${opened.workspace.id}/${relative}`);
    await body({ ipcMain, root, q });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
}

const filter = (ipcMain, q, request) =>
  ipcMain.invoke("workspace:filter", { path: q(""), ...request });

/// The whole point of the feature: a file nobody has expanded a folder to see.
test("finds a match in a folder that was never opened", async () => {
  await withWorkspace(
    { "docs/deep/chapter-one.md": null, "docs/other.md": null },
    async ({ ipcMain, q }) => {
      const result = await filter(ipcMain, q, { filter: "chapter" });

      assert.equal(result.ok, true);
      assert.deepEqual(result.paths, [q("docs/deep/chapter-one.md")]);
      assert.equal(result.truncated, false);
    },
  );
});

/// Qualified on this side, exactly as a listing is: the renderer hands these straight back to open
/// a file, and it never works out which workspace a path belongs to.
test("answers with paths that name their workspace", async () => {
  await withWorkspace({ "notes.md": null }, async ({ ipcMain, q }) => {
    const result = await filter(ipcMain, q, { filter: "notes" });
    assert.deepEqual(result.paths, [q("notes.md")]);
  });
});

test("reads * as any run of characters, against the whole name", async () => {
  await withWorkspace(
    { "notes.md": null, "notes.md.bak": null, "archive.zip": null },
    async ({ ipcMain, q }) => {
      const result = await filter(ipcMain, q, { filter: "*.md" });
      assert.deepEqual(result.paths, [q("notes.md")]);
    },
  );
});

test("reads ? as exactly one character", async () => {
  await withWorkspace({ "ch1.md": null, "ch12.md": null }, async ({ ipcMain, q }) => {
    const result = await filter(ipcMain, q, { filter: "ch?.md" });
    assert.deepEqual(result.paths, [q("ch1.md")]);
  });
});

/// The browser does not list hidden entries, so the filter must not find inside them. `.git` alone
/// is thousands of files nobody opened this app to read.
test("never looks inside a hidden folder, or at a hidden file", async () => {
  await withWorkspace(
    { ".git/notes.md": null, ".notes.md": null, "notes.md": null },
    async ({ ipcMain, q }) => {
      const result = await filter(ipcMain, q, { filter: "notes" });
      assert.deepEqual(result.paths, [q("notes.md")]);
    },
  );
});

/// Every kind of file the browser lists, not only the ones it opens: a type that is off is drawn in
/// grey in the tree rather than hidden from it, and nothing here reads a file's contents.
test("matches files whose type is turned off, as the tree lists them", async () => {
  await withWorkspace({ "picture.png": null }, async ({ ipcMain, q }) => {
    const result = await filter(ipcMain, q, { filter: "*.png" });
    assert.deepEqual(result.paths, [q("picture.png")]);
  });
});

test("refuses an empty filter rather than walking the tree for it", async () => {
  await withWorkspace({ "notes.md": null }, async ({ ipcMain, q }) => {
    const result = await filter(ipcMain, q, { filter: "" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "bad-request");
  });
});

test("refuses a folder in no open workspace", async () => {
  await withWorkspace({ "notes.md": null }, async ({ ipcMain }) => {
    const result = await filter(ipcMain, () => "", { path: "Nowhere/docs", filter: "notes" });
    assert.equal(result.ok, false);
  });
});

/// The walk is bounded, and an answer cut short says so. Driven directly rather than through the
/// handler: the real bounds are hundreds of files, and a test that built them would be a test about
/// how fast a temporary directory can be written.
test("stops at its budget, and reports that it did", async () => {
  const provider = {
    list: async (directory) =>
      directory === ""
        ? { ok: true, nodes: [{ id: "a.md", name: "a.md", kind: "file" }, { id: "b.md", name: "b.md", kind: "file" }] }
        : { ok: false, reason: "not-found" },
  };

  const result = await searchNames(provider, { path: "", filter: "*.md" }, { matches: 1, folders: 10 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.paths, ["a.md"]);
  assert.equal(result.truncated, true);
});

/// One unreadable folder must not take the answer away from every other. The same rule as Find in
/// Files, and the reason a cloud provider's failure mid-listing is survivable.
test("skips a folder it cannot list rather than failing the whole filter", async () => {
  const provider = {
    list: async (directory) => {
      if (directory === "") {
        return {
          ok: true,
          nodes: [
            { id: "locked", name: "locked", kind: "directory" },
            { id: "open", name: "open", kind: "directory" },
          ],
        };
      }
      if (directory === "open") {
        return { ok: true, nodes: [{ id: "open/notes.md", name: "notes.md", kind: "file" }] };
      }
      return { ok: false, reason: "permission-denied" };
    },
  };

  const result = await searchNames(provider, { path: "", filter: "notes" });

  assert.equal(result.ok, true);
  assert.deepEqual(result.paths, ["open/notes.md"]);
});
