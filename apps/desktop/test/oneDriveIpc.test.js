"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");
const { createMicrosoftAuth } = require("../src/microsoftAuth");

/// The OneDrive account through the real handlers, with a real `microsoftAuth` over a fake Microsoft.

const REFRESH = "refresh-invented-onedrive-ipc";
const ROTATED = "refresh-rotated-onedrive-ipc";
const ACCESS = "access-invented-onedrive-ipc";

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
    handlers,
  };
}

function fakeAccounts() {
  const tokens = new Map();
  return {
    tokens,
    setToken: async (provider, token) => (tokens.set(provider, token), { ok: true }),
    getToken: async (provider) => tokens.get(provider) ?? null,
    hasToken: async (provider) => tokens.has(provider),
    deleteToken: async (provider) => void tokens.delete(provider),
    connectedProviders: async () => [...tokens.keys()],
  };
}

const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

function microsoftOver(accounts, authLog = { error: () => {} }) {
  return createMicrosoftAuth({
    client: { clientId: "00000000-1111-2222-3333-444444444444" },
    accounts,
    logger: authLog,
    fetch: async (url, init = {}) => {
      if (url.endsWith("/token")) {
        const grant = new URLSearchParams(init.body).get("grant_type");
        return json(200, {
          access_token: ACCESS,
          expires_in: 3599,
          scope: "Files.ReadWrite.All User.Read",
          token_type: "Bearer",
          refresh_token: grant === "refresh_token" ? ROTATED : REFRESH,
        });
      }
      if (url.includes("/v1.0/me")) return json(200, { mail: "ada@example.com" });
      throw new Error(`unexpected ${url}`);
    },
    openExternal: async (url) => {
      const params = new URL(url).searchParams;
      const port = new URL(params.get("redirect_uri")).port;
      setImmediate(() => void globalThis.fetch(`http://127.0.0.1:${port}/?state=${params.get("state")}&code=c1`).then((r) => r.text()));
    },
  });
}

async function withHandlers(body, { microsoft = "real", createOneDrive = null, openExternal } = {}) {
  const authLogged = [];
  const authLog = { error: (...args) => void authLogged.push(args.map(String).join(" ")) };
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-onedrive-ipc-"));
  try {
    const ipcMain = fakeIpcMain();
    const accounts = fakeAccounts();
    const auth = microsoft === "none" ? null : microsoftOver(accounts, authLog);
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
      getWindow: () => null,
      userDataDir: userData,
      secrets: { endpointsWithKeys: async () => [], setKey: async () => ({ ok: true }), deleteKey: async () => {}, retainOnly: async () => {} },
      accounts,
      microsoft: auth,
      createOneDrive,
      openExternal,
      explorerIntegration: { supported: () => false, isRegistered: async () => false },
    });
    await body({ ipcMain, accounts, auth, authLogged });
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
}

test("connects, reports the account by email, and disconnects", async () => {
  await withHandlers(async ({ ipcMain, accounts }) => {
    assert.deepEqual(await ipcMain.invoke("onedrive:status"), { ok: true, configured: true, connected: false, email: null, reason: null });
    assert.deepEqual(await ipcMain.invoke("onedrive:connect"), { ok: true, email: "ada@example.com" });
    assert.equal(accounts.tokens.get("onedrive"), REFRESH);
    assert.deepEqual(await ipcMain.invoke("onedrive:disconnect"), { ok: true });
    assert.equal(accounts.tokens.has("onedrive"), false);
  });
});

test("a build without a client says so on every channel", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("onedrive:status"), { ok: true, configured: false, connected: false, email: null, reason: null });
      assert.deepEqual(await ipcMain.invoke("onedrive:connect"), { ok: false, reason: "not-configured" });
      assert.deepEqual(await ipcMain.invoke("onedrive:cancelConnect"), { ok: true });
      assert.deepEqual(await ipcMain.invoke("onedrive:disconnect"), { ok: true });
    },
    { microsoft: "none" },
  );
});

// The leak guard. Every channel, with an empty payload, after a connect and a FORCED refresh - connect
// caches the access token, so only a forced refresh issues the refresh_token grant and rotates the
// stored token - so the first refresh token, the rotated one and the access token have all existed.
// No answer, thrown error or log line (the console's, or microsoftAuth's own logger) may carry one.
test("no channel answers with a Microsoft token", async () => {
  await withHandlers(async ({ ipcMain, accounts, auth, authLogged }) => {
    await ipcMain.invoke("onedrive:connect");
    await auth.accessToken({ force: true });
    assert.equal(accounts.tokens.get("onedrive"), ROTATED, "the refresh did not rotate the stored token");
    const logged = [];
    const realConsoleError = console.error;
    console.error = (...args) => void logged.push(args.map(String).join(" "));
    try {
      for (const [channel, handler] of ipcMain.handlers) {
        if (channel === "onedrive:disconnect") continue; // walked last, so the others see a connected account
        let text;
        try {
          text = JSON.stringify((await handler(null, {})) ?? null);
        } catch (error) {
          text = `${String(error)} ${error?.stack ?? ""}`;
        }
        for (const token of [REFRESH, ROTATED, ACCESS]) assert.ok(!text.includes(token), `${channel} answered with a Microsoft token`);
      }
    } finally {
      console.error = realConsoleError;
    }
    const leaked = [...logged, ...authLogged].join(" ");
    for (const token of [REFRESH, ROTATED, ACCESS]) assert.ok(!leaked.includes(token), "a log line carried a Microsoft token");
    const last = JSON.stringify(await ipcMain.invoke("onedrive:disconnect"));
    for (const token of [REFRESH, ROTATED, ACCESS]) assert.ok(!last.includes(token));
  });
});

/// The OneDrive client factory, as `main.js` passes it: built over an access-token supplier. `seen`
/// records the supplier, so a test can check whose token it is.
function fakeOneDriveFactory({ myDrive = "d0c0ffee", seen = {} } = {}) {
  return (accessToken) => {
    seen.accessToken = accessToken;
    const plan = { id: "ITEM!1", name: "Plan.md", size: 5, cTag: "ctag-1", file: {}, webUrl: "https://onedrive.live.com/?id=ITEM!1" };
    return {
      drive: async () => ({ ok: true, drive: { id: myDrive } }),
      item: async (_driveId, itemId, filePath) => {
        if (filePath === "") return { ok: true, item: { id: itemId, name: "Notes now", folder: {} } };
        return filePath === "Plan.md" ? { ok: true, item: plan } : { ok: false, reason: "not-found" };
      },
      children: async (_driveId, _itemId, folderPath) => (folderPath === "" ? { ok: true, items: [plan] } : { ok: false, reason: "not-found" }),
      download: async () => ({ ok: true, bytes: Buffer.from("hello") }),
    };
  };
}

// Each test opens its own item id: the registry of open workspaces is module-level, so a reference an
// earlier test opened would answer the workspace already open rather than reaching the opener.
test("opens a OneDrive folder by reference and reads it read-only, like any other workspace", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const ref = { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!10", name: "Notes then" };
      const opened = await ipcMain.invoke("workspace:openRef", { ref });
      assert.equal(opened.ok, true);
      assert.equal(opened.workspace.name, "Notes now");
      assert.deepEqual(opened.workspace.ref, ref);
      assert.equal("driveVariant" in opened.workspace, false);

      const listed = await ipcMain.invoke("workspace:list", { path: opened.workspace.id });
      assert.deepEqual(listed.nodes.map((node) => node.id), [`${opened.workspace.id}/Plan.md`]);

      const read = await ipcMain.invoke("file:read", { path: `${opened.workspace.id}/Plan.md` });
      assert.deepEqual(read, { ok: true, content: "hello", revision: { id: "ctag-1" }, readOnly: true });
    },
    { createOneDrive: fakeOneDriveFactory() },
  );
});

test("a save into a OneDrive folder answers read-only in this release", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!11", name: "Notes" } });
      const written = await ipcMain.invoke("file:write", {
        path: `${opened.workspace.id}/Plan.md`,
        content: "changed",
        expectedRevision: { id: "ctag-1" },
        message: null,
      });
      assert.deepEqual(written, { ok: false, reason: "read-only" });
    },
    { createOneDrive: fakeOneDriveFactory() },
  );
});

test("an own-drive folder of another Microsoft account is not opened under this one", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!12", name: "Notes" } });
      assert.deepEqual(opened, { ok: false, reason: "other-account" });
    },
    { createOneDrive: fakeOneDriveFactory({ myDrive: "beefcafe" }) },
  );
});

test("a folder shared with the user lives in another drive by design, and opens", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const ref = { kind: "onedrive", driveId: "beefcafe", itemId: "SHARED!7", shared: true, name: "Joint" };
      const opened = await ipcMain.invoke("workspace:openRef", { ref });
      assert.equal(opened.ok, true);
      assert.deepEqual(opened.workspace.ref, ref);
    },
    { createOneDrive: fakeOneDriveFactory() },
  );
});

// Connected first, so the supplier answers with a token: only the account's own supplier can hand
// back the token the account was connected with. The token is compared, never printed - a failing
// assertion names the shape, not the value.
test("the OneDrive client is built over the Microsoft account's access token", async () => {
  const seen = {};
  await withHandlers(
    async ({ ipcMain }) => {
      assert.equal(typeof seen.accessToken, "function");
      await ipcMain.invoke("onedrive:connect");
      const answer = await seen.accessToken();
      assert.ok(answer.ok === true && answer.token === ACCESS, "the supplier did not answer with the account's access token");
    },
    { createOneDrive: fakeOneDriveFactory({ seen }) },
  );
});

test("a build without a OneDrive client cannot open a OneDrive folder", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!13", name: "Notes" } });
      assert.deepEqual(opened, { ok: false, reason: "not-configured" });
    },
    { microsoft: "none", createOneDrive: fakeOneDriveFactory() },
  );
});

test("Open in OneDrive shows the item's page in the browser, and answers no address", async () => {
  const shown = [];
  await withHandlers(
    async ({ ipcMain }) => {
      const workspace = (await ipcMain.invoke("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!14", name: "Notes" } })).workspace;
      assert.deepEqual(await ipcMain.invoke("workspace:reveal", { path: `${workspace.id}/Plan.md` }), { ok: true });
      assert.deepEqual(shown, ["https://onedrive.live.com/?id=ITEM!1"]);
    },
    { createOneDrive: fakeOneDriveFactory(), openExternal: async (url) => void shown.push(url) },
  );
});
