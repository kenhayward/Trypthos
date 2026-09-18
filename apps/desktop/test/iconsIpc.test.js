"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// The icons an Obsidian vault has assigned, served from the main process.
///
/// The read goes through the workspace provider, so the boundary guard applies and the renderer
/// never names another application's data directory. Every failure is an empty map: Iconic's format
/// is not ours, and an error banner about it would be something nobody could act on.

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

async function folder(files, { vault }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-iconsipc-")));
  if (vault) await fs.mkdir(path.join(root, ".obsidian"));
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  return root;
}

async function withShell(root, body) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-iconsipc-data-"));
  const ipcMain = fakeIpcMain();
  registerIpcHandlers({
    ipcMain,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [root] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    getWindow: () => null,
    userDataDir: userData,
    secrets: { endpointsWithKeys: async () => [], setKey: async () => {}, deleteKey: async () => {}, retainOnly: async () => {} },
    explorerIntegration: { supported: () => false, isRegistered: async () => false, register: async () => ({ ok: true }), unregister: async () => ({ ok: true }) },
    broadcast: () => {},
  });
  // The malformed-payload case logs on purpose - see `guarded` in ipcHandlers.js - and the
  // pristine-output rule applies here too.
  const noise = console.error;
  console.error = () => {};
  try {
    const opened = await ipcMain.invoke("workspace:open");
    assert.equal(opened.ok, true);
    await body({ ipcMain, id: opened.workspace.id });
    await ipcMain.invoke("workspace:close", { workspaceId: opened.workspace.id });
  } finally {
    console.error = noise;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
}

const ICONS = ".obsidian/plugins/iconic/data.json";

test("answers a vault's icon assignments, read through the provider", async () => {
  const root = await folder(
    {
      "Home.md": "",
      [ICONS]: JSON.stringify({
        fileIcons: {
          Projects: { icon: "lucide-folder-git-2" },
          "Projects/Charter.md": { icon: "lucide-scroll-text", color: "blue" },
        },
        settings: { biggerIcons: "on" },
      }),
    },
    { vault: true },
  );
  await withShell(root, async ({ ipcMain, id }) => {
    assert.deepEqual(await ipcMain.invoke("icons:map", { workspaceId: id }), {
      ok: true,
      icons: {
        Projects: { icon: "lucide-folder-git-2", colour: null },
        "Projects/Charter.md": { icon: "lucide-scroll-text", colour: "blue" },
      },
    });
  });
});

test("answers an empty map when there is no icon plugin", async () => {
  const root = await folder({ "Home.md": "" }, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    assert.deepEqual(await ipcMain.invoke("icons:map", { workspaceId: id }), { ok: true, icons: {} });
  });
});

test("answers an empty map when the plugin's file is not JSON", async () => {
  const root = await folder({ "Home.md": "", [ICONS]: "{ not json" }, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    assert.deepEqual(await ipcMain.invoke("icons:map", { workspaceId: id }), { ok: true, icons: {} });
  });
});

test("answers an empty map for a folder that is not a vault", async () => {
  const root = await folder({ "Home.md": "" }, { vault: false });
  await withShell(root, async ({ ipcMain, id }) => {
    assert.deepEqual(await ipcMain.invoke("icons:map", { workspaceId: id }), { ok: true, icons: {} });
  });
});

test("refuses a malformed icons request", async () => {
  const root = await folder({ "Home.md": "" }, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    assert.deepEqual(await ipcMain.invoke("icons:map", { workspaceId: id, path: "../secrets" }), {
      ok: false,
      reason: "bad-request",
    });
  });
});

test("refuses an icons request for a workspace that is not open", async () => {
  const root = await folder({ "Home.md": "" }, { vault: true });
  await withShell(root, async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("icons:map", { workspaceId: "Nowhere" }), {
      ok: false,
      reason: "no-workspace",
    });
  });
});
