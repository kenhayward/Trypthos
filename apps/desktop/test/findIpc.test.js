"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// Find in Files, through the handler that serves it.
///
/// Exercised through the real handler rather than through the walker underneath, following
/// `outlineIpc.test.js`: the failure that file was written for - a schema added to the domain and
/// never exported from the barrel, so the destructure bound `undefined` and every call rejected -
/// is invisible to a unit test of the half that was fine.

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

async function withWorkspace(files, body) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-find-ipc-"));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-find-data-"));
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

    await ipcMain.invoke("workspace:open");
    await body({ ipcMain, root });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
}

const MARKDOWN = ["markdown"];

const find = (ipcMain, request) =>
  ipcMain.invoke("workspace:find", {
    path: "",
    regex: false,
    caseSensitive: false,
    fileTypes: MARKDOWN,
    ...request,
  });

test("finds a phrase and says where it is", async () => {
  await withWorkspace({ "notes.md": "alpha\nthe needle is here\nomega\n" }, async ({ ipcMain }) => {
    const result = await find(ipcMain, { pattern: "needle" });

    assert.equal(result.ok, true);
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0].path, "notes.md");
    assert.equal(result.hits[0].line, 2);
    assert.equal(result.hits[0].preview, "the needle is here");
  });
});

test("descends into subfolders", async () => {
  await withWorkspace(
    { "top.md": "needle", "a/mid.md": "needle", "a/b/deep.md": "needle" },
    async ({ ipcMain }) => {
      const result = await find(ipcMain, { pattern: "needle" });
      assert.deepEqual(
        result.hits.map((hit) => hit.path).sort(),
        ["a/b/deep.md", "a/mid.md", "top.md"],
      );
    },
  );
});

test("searches only below the folder it was given", async () => {
  await withWorkspace(
    { "outside.md": "needle", "docs/inside.md": "needle" },
    async ({ ipcMain }) => {
      const result = await find(ipcMain, { path: "docs", pattern: "needle" });
      assert.deepEqual(
        result.hits.map((hit) => hit.path),
        ["docs/inside.md"],
      );
    },
  );
});

/// A file type the user has turned off is not listed in the browser and is not opened by a click.
/// A search that read it anyway would be a way to see the contents of a file the app says it does
/// not open.
test("reads only the file types that are turned on", async () => {
  await withWorkspace({ "a.md": "needle", "b.log": "needle" }, async ({ ipcMain }) => {
    const result = await find(ipcMain, { pattern: "needle" });
    assert.deepEqual(
      result.hits.map((hit) => hit.path),
      ["a.md"],
    );
  });
});

/// Case sensitivity travels the same way as the expression flag: told, never guessed at.
test("matches case when it is told to", async () => {
  await withWorkspace({ "notes.md": "Needle\nneedle\nNEEDLE\n" }, async ({ ipcMain }) => {
    const insensitive = await find(ipcMain, { pattern: "needle" });
    assert.equal(insensitive.hits.length, 3);

    const sensitive = await find(ipcMain, { pattern: "needle", caseSensitive: true });
    assert.equal(sensitive.hits.length, 1);
    assert.equal(sensitive.hits[0].line, 2);
  });
});

test("takes a regular expression when it is told to", async () => {
  await withWorkspace({ "notes.md": "cat\nmat\ndog\n" }, async ({ ipcMain }) => {
    const result = await find(ipcMain, { pattern: "[cm]at", regex: true });
    assert.equal(result.hits.length, 2);
  });
});

/// Not the same answer as "nothing matched": one means retype the pattern and the other means the
/// text is not there.
test("says so when the expression does not compile", async () => {
  await withWorkspace({ "notes.md": "x" }, async ({ ipcMain }) => {
    const result = await find(ipcMain, { pattern: "[unclosed", regex: true });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "bad-pattern");
  });
});

test("an ordinary search with no match is a success with nothing in it", async () => {
  await withWorkspace({ "notes.md": "x" }, async ({ ipcMain }) => {
    const result = await find(ipcMain, { pattern: "needle" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.hits, []);
  });
});

/// The main security surface. The renderer having already checked is not a check.
test("refuses a folder that climbs out of the workspace", async () => {
  await withWorkspace({ "notes.md": "needle" }, async ({ ipcMain }) => {
    const result = await find(ipcMain, { path: "../..", pattern: "needle" });
    assert.equal(result.ok, false);
  });
});

test("refuses a request that is not the shape it expects", async () => {
  await withWorkspace({ "notes.md": "needle" }, async ({ ipcMain }) => {
    const empty = await ipcMain.invoke("workspace:find", {
      path: "",
      pattern: "",
      regex: false,
      caseSensitive: false,
      fileTypes: MARKDOWN,
    });
    assert.equal(empty.ok, false);

    const extra = await ipcMain.invoke("workspace:find", {
      path: "",
      pattern: "needle",
      regex: false,
      caseSensitive: false,
      fileTypes: MARKDOWN,
      follow: true,
    });
    assert.equal(extra.ok, false);
  });
});

/// A search is the one thing here that can touch a whole tree, so the cap is about effort. An answer
/// that was cut short has to say so, or it is a wrong answer given confidently.
test("says when it stopped early", async () => {
  const files = {};
  for (let n = 0; n < 40; n += 1) files[`f${n}.md`] = "needle\n".repeat(30);

  await withWorkspace(files, async ({ ipcMain }) => {
    const result = await find(ipcMain, { pattern: "needle" });
    assert.equal(result.ok, true);
    assert.equal(result.capped, true);
    assert.ok(result.hits.length > 0);
  });
});
