"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { mediaUrl } = require("@trypthos/domain");
const { registerIpcHandlers, locateMedia } = require("../src/ipcHandlers");
const { createMediaHandler } = require("../src/mediaProtocol");

/// A Drive folder through the real handlers: opened by reference, listed and read through the same
/// channels as every other workspace, and saved through the same check-write-confirm a save expects.

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
  });
});

/// A Drive whose files can change behind the app's back: `fileMeta` answers each file's current
/// revision, and an upload moves it on.
function savingDriveFactory(log) {
  const meta = {
    rootSAV: { id: "rootSAV", name: "Saved", mimeType: FOLDER },
    mdSAV: { id: "mdSAV", name: "Plan.md", mimeType: "text/markdown", headRevisionId: "rev1" },
  };
  return () => ({
    fileMeta: async (id) => (meta[id] === undefined ? { ok: false, reason: "not-found" } : { ok: true, file: { ...meta[id] } }),
    listChildren: async (id) =>
      id === "rootSAV"
        ? {
            ok: true,
            files: [
              { id: "mdSAV", name: "Plan.md", mimeType: "text/markdown", size: "5", headRevisionId: meta.mdSAV.headRevisionId },
              { id: "docSAV", name: "Minutes", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-10-01T00:00:00Z" },
            ],
          }
        : { ok: false, reason: "not-found" },
    download: async () => ({ ok: true, bytes: Buffer.from("hello") }),
    exportMarkdown: async () => ({ ok: true, bytes: Buffer.from("# Minutes") }),
    uploadContent: async (id, bytes, mimeType) => {
      log.push({ id, content: Buffer.from(bytes).toString("utf8"), mimeType });
      meta[id].headRevisionId = `rev${log.length + 1}`;
      return { ok: true, file: { ...meta[id] } };
    },
    createFile: async () => ({ ok: false, reason: "offline" }),
  });
}

test("a Drive file saves through file:write with the revision its read gave, and a stale one conflicts", async () => {
  const uploads = [];
  await withHandlers(async ({ ipcMain }) => {
    const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "google-drive", folderId: "rootSAV", name: "Saved" } });
    assert.equal(opened.ok, true);
    const file = `${opened.workspace.id}/Plan.md`;

    const read = await ipcMain.invoke("file:read", { path: file });
    assert.deepEqual(read, { ok: true, content: "hello", revision: { id: "rev1" } });

    const written = await ipcMain.invoke("file:write", { path: file, content: "changed", expectedRevision: read.revision, message: null });
    assert.deepEqual(written, { ok: true, revision: { id: "rev2" } });
    assert.deepEqual(uploads, [{ id: "mdSAV", content: "changed", mimeType: "text/markdown" }]);

    const stale = await ipcMain.invoke("file:write", { path: file, content: "again", expectedRevision: { id: "rev1" }, message: null });
    assert.deepEqual(stale, { ok: false, reason: "conflict", theirs: { id: "rev2" } });
    assert.equal(uploads.length, 1);

    const doc = await ipcMain.invoke("file:read", { path: `${opened.workspace.id}/Minutes.md` });
    assert.deepEqual(doc, { ok: true, content: "# Minutes", revision: { id: "modified:2026-10-01T00:00:00Z" }, readOnly: true });
  }, { createGoogleDrive: savingDriveFactory(uploads) });
});

test("a shared drive opens under its own name and says it is one", async () => {
  const factory = () => ({
    fileMeta: async (id) => ({ ok: true, file: { id, name: "Drive", mimeType: FOLDER } }),
    sharedDrive: async (id) => ({ ok: true, drive: { id, name: "Team Drive Now" } }),
    listChildren: async () => ({ ok: true, files: [] }),
  });
  await withHandlers(async ({ ipcMain }) => {
    const opened = await ipcMain.invoke("workspace:openRef", {
      ref: { kind: "google-drive", folderId: "0AbcDEF", driveId: "0AbcDEF", name: "Test Drive" },
    });
    assert.equal(opened.ok, true);
    assert.equal(opened.workspace.name, "Team Drive Now");
    assert.equal(opened.workspace.driveVariant, "shared-drive");
  }, { createGoogleDrive: factory });
});

test("a local workspace's answer carries no Drive variant", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-drive-local-"));
  try {
    await withHandlers(async ({ ipcMain }) => {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "local", root: dir } });
      assert.equal(opened.ok, true);
      assert.equal("driveVariant" in opened.workspace, false);
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
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

test("a Drive clip streams in ranges through locateMedia, and neither the token nor the URL is logged", async () => {
  const logged = [];
  const originals = { error: console.error, warn: console.warn, log: console.log };
  for (const name of Object.keys(originals)) console[name] = (...args) => logged.push(args);
  const asked = [];
  const factory = () => ({
    fileMeta: async () => ({ ok: true, file: { id: "rootMED", name: "Media", mimeType: FOLDER } }),
    listChildren: async () => ({ ok: true, files: [{ id: "vidMED", name: "clip.mp4", mimeType: "video/mp4", size: "20" }] }),
    downloadRange: async (id, start, end) => {
      asked.push([id, start, end]);
      return { ok: true, status: 206, body: new Blob([Buffer.from("0123456789ABCDEFGHIJ").subarray(start, end + 1)]).stream() };
    },
  });
  try {
    await withHandlers(
      async ({ ipcMain }) => {
        const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "google-drive", folderId: "rootMED", name: "Media" } });
        assert.equal(opened.ok, true);

        const found = await locateMedia(`${opened.workspace.id}/clip.mp4`);
        assert.equal(found.ok, true);
        assert.equal(found.size, 20);

        const range = await found.open(5, 9);
        assert.equal(range.ok, true);
        assert.equal(await new Response(range.body).text(), "56789");
        assert.deepEqual(asked, [["vidMED", 5, 9]]);

        // Through the protocol too: the window sees bytes and headers, nothing of Drive.
        const handle = createMediaHandler({ locate: locateMedia });
        const response = await handle(new Request(mediaUrl(`${opened.workspace.id}/clip.mp4`), { headers: { Range: "bytes=0-3" } }));
        assert.equal(response.status, 206);
        assert.equal(await response.text(), "0123");
      },
      { google: { accessToken: async () => ({ ok: true, token: "SECRET-TOKEN-VALUE" }) }, createGoogleDrive: factory },
    );
  } finally {
    Object.assign(console, originals);
  }
  const text = JSON.stringify(logged);
  assert.equal(text.includes("SECRET-TOKEN-VALUE"), false);
  assert.equal(text.includes("googleapis.com"), false);
});
