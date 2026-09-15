"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// Obsidian's vaults, through the real handlers.
///
/// The file these read is Obsidian's, not ours, so every folder and id here is invented and written
/// to a temporary directory - nothing reads the list on the machine running the tests.

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

/// A temporary directory holding an `obsidian.json` (or not), and the handlers registered over it.
///
/// `vaults` maps an id to a folder name under the temporary directory; `made` lists which of those
/// folders exist, because a vault Obsidian remembers can have been deleted since.
async function withObsidian({ config, made = [] }, body) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-obsidian-")));
  try {
    for (const name of made) await fs.mkdir(path.join(base, name), { recursive: true });

    const configPath = path.join(base, "obsidian", "obsidian.json");
    if (config !== undefined) {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      const text = typeof config === "string" ? config : JSON.stringify(config(base));
      await fs.writeFile(configPath, text, "utf8");
    }

    const ipcMain = fakeIpcMain();
    const picked = path.join(base, "Garden");
    registerIpcHandlers({
      ipcMain,
      // The folder dialog, for the test that opens a vault's folder the ordinary way first.
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [picked] }) },
      getWindow: () => null,
      userDataDir: base,
      secrets: {
        endpointsWithKeys: async () => [],
        setKey: async () => {},
        deleteKey: async () => {},
        retainOnly: async () => {},
      },
      obsidianConfigPath: configPath,
    });

    await body({ ipcMain, base });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
}

const TWO_VAULTS = (base) => ({
  vaults: {
    aaaa1111bbbb2222: { path: path.join(base, "Garden"), ts: 1, open: true },
    cccc3333dddd4444: { path: path.join(base, "Archive"), ts: 2 },
  },
});

test("says Obsidian is not installed when its list of vaults does not exist", async () => {
  await withObsidian({}, async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("obsidian:vaults"), { ok: true, installed: false, vaults: [] });
  });
});

test("says Obsidian is not installed where the shell has no path to look at", async () => {
  const ipcMain = fakeIpcMain();
  registerIpcHandlers({ ipcMain, dialog: {}, getWindow: () => null, userDataDir: os.tmpdir(), secrets: {} });

  assert.deepEqual(await ipcMain.invoke("obsidian:vaults"), { ok: true, installed: false, vaults: [] });
});

test("lists the vaults Obsidian knows, by name, marking the ones whose folder has gone", async () => {
  await withObsidian({ config: TWO_VAULTS, made: ["Garden"] }, async ({ ipcMain, base }) => {
    const answer = await ipcMain.invoke("obsidian:vaults");

    assert.deepEqual(answer, {
      ok: true,
      installed: true,
      vaults: [
        { id: "cccc3333dddd4444", name: "Archive", path: path.join(base, "Archive"), available: false },
        { id: "aaaa1111bbbb2222", name: "Garden", path: path.join(base, "Garden"), available: true },
      ],
    });
  });
});

// The file exists, so Obsidian is installed - it simply has nothing this build can read in it.
test("answers installed with no vaults when the list cannot be read", async () => {
  await withObsidian({ config: "{ not json" }, async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("obsidian:vaults"), { ok: true, installed: true, vaults: [] });
  });
});

test("opens a vault as a local folder that remembers it is a vault", async () => {
  await withObsidian({ config: TWO_VAULTS, made: ["Garden/.obsidian"] }, async ({ ipcMain, base }) => {
    await fs.writeFile(path.join(base, "Garden", "plan.md"), "# Plan", "utf8");

    const opened = await ipcMain.invoke("obsidian:openVault", { id: "aaaa1111bbbb2222" });

    assert.equal(opened.ok, true);
    assert.deepEqual(opened.workspace.ref, { kind: "local", root: path.join(base, "Garden"), origin: "obsidian" });
    assert.equal(opened.workspace.name, "Garden");

    // An ordinary folder in every other respect: listed by the same channel, through the same guard.
    const listed = await ipcMain.invoke("workspace:list", { path: opened.workspace.id });
    assert.deepEqual(
      listed.nodes.filter((node) => node.kind === "file").map((node) => node.name),
      ["plan.md"],
    );
  });
});

// One folder is one workspace however it was chosen, so the second open answers the first.
test("answers the workspace already open when the vault's folder is open as a plain folder", async () => {
  await withObsidian({ config: TWO_VAULTS, made: ["Garden"] }, async ({ ipcMain }) => {
    const folder = await ipcMain.invoke("workspace:open");
    const vault = await ipcMain.invoke("obsidian:openVault", { id: "aaaa1111bbbb2222" });

    assert.equal(vault.ok, true);
    assert.equal(vault.workspace.id, folder.workspace.id);
  });
});

test("refuses an id Obsidian does not list", async () => {
  await withObsidian({ config: TWO_VAULTS, made: ["Garden"] }, async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("obsidian:openVault", { id: "eeee5555ffff6666" }), {
      ok: false,
      reason: "not-found",
    });
  });
});

test("says a vault whose folder has gone was not found", async () => {
  await withObsidian({ config: TWO_VAULTS, made: ["Garden"] }, async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("obsidian:openVault", { id: "cccc3333dddd4444" }), {
      ok: false,
      reason: "not-found",
    });
  });
});

// The renderer names a vault by id only. A folder in its place is refused before anything is read.
test("refuses a folder sent in place of an id", async () => {
  await withObsidian({ config: TWO_VAULTS, made: ["Garden"] }, async ({ ipcMain, base }) => {
    assert.deepEqual(await ipcMain.invoke("obsidian:openVault", { id: path.join(base, "Garden") }), {
      ok: false,
      reason: "bad-request",
    });
    assert.deepEqual(await ipcMain.invoke("obsidian:openVault", { root: path.join(base, "Garden") }), {
      ok: false,
      reason: "bad-request",
    });
  });
});
