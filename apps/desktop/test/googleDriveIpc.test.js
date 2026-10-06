"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// A Drive folder through the real handlers: opened by reference, listed and read through the same
/// channels as every other workspace, and refused a write.

const FOLDER = "application/vnd.google-apps.folder";

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
    handlers,
  };
}

/// The Drive client factory, as `main.js` passes it: built over an access-token supplier.
function fakeDriveFactory(seen = {}) {
  return (accessToken) => {
    seen.accessToken = accessToken;
    return {
      fileMeta: async () => ({ ok: true, file: { id: "rootAAA", name: "Notes", mimeType: FOLDER } }),
      listChildren: async (id) =>
        id === "rootAAA"
          ? { ok: true, files: [{ id: "mdCCC", name: "Plan.md", mimeType: "text/markdown", size: "5", headRevisionId: "rev1" }] }
          : { ok: false, reason: "not-found" },
      download: async () => ({ ok: true, bytes: Buffer.from("hello") }),
      exportMarkdown: async () => ({ ok: false, reason: "not-found" }),
      sharedDrives: async () => ({ ok: true, drives: [] }),
      sharedWithMeFolders: async () => ({ ok: true, files: [] }),
    };
  };
}

async function withHandlers(body, { google = { accessToken: async () => ({ ok: true, token: "t" }) }, createGoogleDrive = fakeDriveFactory() } = {}) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-drive-ipc-"));
  try {
    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
      getWindow: () => null,
      userDataDir: userData,
      secrets: { endpointsWithKeys: async () => [], setKey: async () => ({ ok: true }), deleteKey: async () => {}, retainOnly: async () => {} },
      accounts: null,
      google,
      createGoogleDrive,
      explorerIntegration: { supported: () => false, isRegistered: async () => false },
    });
    await body({ ipcMain });
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
}

test("opens a Drive folder by reference and reads it like any other workspace", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "google-drive", folderId: "rootAAA", name: "Notes" } });
    assert.equal(opened.ok, true);
    assert.equal(opened.workspace.name, "Notes");
    assert.deepEqual(opened.workspace.ref, { kind: "google-drive", folderId: "rootAAA", name: "Notes" });

    const listed = await ipcMain.invoke("workspace:list", { path: opened.workspace.id });
    assert.deepEqual(listed.nodes.map((node) => node.id), [`${opened.workspace.id}/Plan.md`]);

    const read = await ipcMain.invoke("file:read", { path: `${opened.workspace.id}/Plan.md` });
    assert.equal(read.content, "hello");

    const written = await ipcMain.invoke("file:write", {
      path: `${opened.workspace.id}/Plan.md`,
      content: "changed",
      expectedRevision: { id: "rev1" },
      message: null,
    });
    assert.deepEqual(written, { ok: false, reason: "read-only" });
  });
});

test("the Drive client is built over the Google account's access token", async () => {
  const seen = {};
  const google = { accessToken: async (options) => ({ ok: true, token: options?.force ? "forced" : "plain" }) };
  await withHandlers(async () => {
    assert.equal(typeof seen.accessToken, "function");
    assert.deepEqual(await seen.accessToken(), { ok: true, token: "plain" });
    assert.deepEqual(await seen.accessToken({ force: true }), { ok: true, token: "forced" });
  }, { google, createGoogleDrive: fakeDriveFactory(seen) });
});

// A different folder id from the first test's: the registry of open workspaces is module-level, so
// the same reference would answer the workspace already open rather than reaching the opener.
test("a build without Google cannot open a Drive folder", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "google-drive", folderId: "rootBBB", name: "Notes" } });
      assert.deepEqual(opened, { ok: false, reason: "not-configured" });
    },
    { google: null },
  );
});

test("google:folders routes each place to the right Drive call", async () => {
  const calls = [];
  const FOLDER = "application/vnd.google-apps.folder";
  const factory = () => ({
    listChildren: async (id, options) => {
      calls.push(["children", id, options]);
      return { ok: true, files: [
        { id: "dirBBB", name: "Projects", mimeType: FOLDER, shared: true },
        { id: "dirFFF", name: "Archive", mimeType: FOLDER },
        { id: "mdCCC", name: "Plan.md", mimeType: "text/markdown" },
      ] };
    },
    sharedWithMeFolders: async () => {
      calls.push(["shared-with-me"]);
      return { ok: true, files: [{ id: "dirGGG", name: "Handbook", mimeType: FOLDER }] };
    },
    sharedDrives: async () => {
      calls.push(["drives"]);
      return { ok: true, drives: [{ id: "sharedDDD", name: "Team" }] };
    },
  });

  await withHandlers(async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("google:folders", { in: "drives" }), {
      ok: true,
      folders: [{ id: "sharedDDD", name: "Team", shared: true }],
    });
    assert.deepEqual(await ipcMain.invoke("google:folders", { in: "shared-with-me" }), {
      ok: true,
      folders: [{ id: "dirGGG", name: "Handbook", shared: false }],
    });
    assert.deepEqual(await ipcMain.invoke("google:folders", { in: "folder", id: "root" }), {
      ok: true,
      folders: [
        { id: "dirBBB", name: "Projects", shared: true },
        { id: "dirFFF", name: "Archive", shared: false },
      ],
    });
    assert.deepEqual(calls, [["drives"], ["shared-with-me"], ["children", "root", { foldersOnly: true }]]);
  }, { createGoogleDrive: factory });
});

test("google:folders passes a failed listing on as its reason", async () => {
  const factory = () => ({
    listChildren: async () => ({ ok: false, reason: "offline" }),
    sharedWithMeFolders: async () => ({ ok: false, reason: "rate-limited" }),
    sharedDrives: async () => ({ ok: false, reason: "not-connected" }),
  });
  await withHandlers(async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("google:folders", { in: "folder", id: "dirBBB" }), { ok: false, reason: "offline" });
    assert.deepEqual(await ipcMain.invoke("google:folders", { in: "shared-with-me" }), { ok: false, reason: "rate-limited" });
    assert.deepEqual(await ipcMain.invoke("google:folders", { in: "drives" }), { ok: false, reason: "not-connected" });
  }, { createGoogleDrive: factory });
});

test("google:folders refuses a malformed request and answers not configured without Google", async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    await withHandlers(async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("google:folders", { in: "folder", id: "a' or 'b" }), { ok: false, reason: "bad-request" });
    });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);

  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("google:folders", { in: "drives" }), { ok: false, reason: "not-configured" });
    },
    { google: null },
  );
});
