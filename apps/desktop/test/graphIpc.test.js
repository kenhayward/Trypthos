"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { GRAPH_CHANGED_CHANNEL } = require("@trypthos/domain");
const { registerIpcHandlers } = require("../src/ipcHandlers");

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

async function folder(files, { vault }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-graphipc-")));
  if (vault) await fs.mkdir(path.join(root, ".obsidian"));
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  return root;
}

async function withShell(root, body) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-graphipc-data-"));
  const broadcasts = [];
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
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
  });
  // The "bad request" case deliberately logs - see `guarded` in ipcHandlers.js - and CLAUDE.md's
  // pristine-output rule applies here as much as in the jsdom suite, so it is silenced like every
  // other shell test that exercises a rejected payload on purpose.
  const noise = console.error;
  console.error = () => {};
  try {
    const opened = await ipcMain.invoke("workspace:open");
    assert.equal(opened.ok, true);
    await body({ ipcMain, id: opened.workspace.id, broadcasts });
    await ipcMain.invoke("workspace:close", { workspaceId: opened.workspace.id });
  } finally {
    console.error = noise;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
}

async function builtState(ipcMain, id) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const answer = await ipcMain.invoke("graph:snapshot", { workspaceId: id });
    if (answer.ok && answer.state.snapshot !== null && answer.state.building === null) return answer.state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the graph never finished building");
}

test("opening a vault indexes it and tells every window when the graph is ready", async () => {
  const root = await folder({ "Home.md": "[[Plan]]", "Plan.md": "" }, { vault: true });
  await withShell(root, async ({ ipcMain, id, broadcasts }) => {
    const state = await builtState(ipcMain, id);
    assert.ok(state.snapshot.edges.some((edge) => edge.source === `${id}/Home.md` && edge.target === `${id}/Plan.md`));
    assert.ok(broadcasts.some((event) => event.channel === GRAPH_CHANGED_CHANNEL && event.payload.workspaceId === id));
  });
});

test("a successful write updates the graph", async () => {
  const root = await folder({ "Home.md": "" }, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    await builtState(ipcMain, id);
    // `Home.md` already exists, so its write is against the revision already on disk - `null` there
    // means "create new" and the local provider correctly refuses it as a conflict.
    const read = await ipcMain.invoke("file:read", { path: `${id}/Home.md` });
    assert.equal(read.ok, true);
    const written = await ipcMain.invoke("file:write", {
      path: `${id}/Home.md`,
      content: "[[Later]]",
      expectedRevision: read.revision,
    });
    assert.equal(written.ok, true);
    const { snapshot } = (await ipcMain.invoke("graph:snapshot", { workspaceId: id })).state;
    assert.ok(snapshot.nodes.some((node) => node.id === "ghost:later"));
  });
});

test("a failed write leaves the graph alone", async () => {
  const root = await folder({ "Home.md": "" }, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    const before = (await builtState(ipcMain, id)).snapshot;
    const refused = await ipcMain.invoke("file:write", {
      path: `${id}/Home.md`,
      content: "[[Later]]",
      expectedRevision: { id: "not-the-current-revision" },
    });
    assert.equal(refused.ok, false);
    assert.deepEqual((await ipcMain.invoke("graph:snapshot", { workspaceId: id })).state.snapshot, before);
  });
});

test("a renamed note moves in the graph", async () => {
  const root = await folder({ "Home.md": "", "Plan.md": "[[Home]]" }, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    await builtState(ipcMain, id);
    const renamed = await ipcMain.invoke("workspace:rename", { path: `${id}/Home.md`, name: "Start.md" });
    assert.equal(renamed.ok, true);
    const { snapshot } = (await ipcMain.invoke("graph:snapshot", { workspaceId: id })).state;
    assert.ok(snapshot.nodes.some((node) => node.id === `${id}/Start.md`));
    assert.ok(snapshot.nodes.some((node) => node.id === "ghost:home"));
  });
});

// A plain folder used to answer "unsupported". Every local folder has a graph now; what keeps an
// ordinary project checkout from indexing its dependencies is `folderIgnore.js`.
test("a folder that is not a vault has a graph too", async () => {
  const root = await folder({ "Home.md": "[[Plan]]", "Plan.md": "", "node_modules/pkg/README.md": "" }, { vault: false });
  await withShell(root, async ({ ipcMain, id }) => {
    const state = await builtState(ipcMain, id);
    assert.ok(state.snapshot.edges.some((edge) => edge.source === `${id}/Home.md` && edge.target === `${id}/Plan.md`));
    assert.equal(state.snapshot.nodes.some((node) => node.id.includes("node_modules")), false);
    assert.equal(state.snapshot.truncated, false);
  });
});

test("the graph channels take a workspace id and nothing else", async () => {
  const root = await folder({}, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    for (const channel of ["graph:snapshot", "graph:refresh"]) {
      assert.deepEqual(await ipcMain.invoke(channel, { workspaceId: id, path: "/" }), { ok: false, reason: "bad-request" });
      assert.deepEqual(await ipcMain.invoke(channel, undefined), { ok: false, reason: "bad-request" });
      assert.deepEqual(await ipcMain.invoke(channel, { workspaceId: "Nobody" }), { ok: false, reason: "no-workspace" });
    }
  });
});
