"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers, locateMedia } = require("../src/ipcHandlers");
const { createMicrosoftAuth } = require("../src/microsoftAuth");
const { createOneDriveApi } = require("../src/oneDriveApi");

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
test("opens a OneDrive folder by reference and reads it, like any other workspace", async () => {
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
      assert.deepEqual(read, { ok: true, content: "hello", revision: { id: "ctag-1" } });
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

/// A OneDrive client whose places hold folders, files and shared folders, recording each call.
function foldersFactory(calls, overrides = {}) {
  return () => ({
    drive: async () => {
      calls.push(["drive"]);
      return { ok: true, drive: { id: "d0c0ffee" } };
    },
    children: async (driveId, itemId, folderPath) => {
      calls.push(["children", driveId, itemId, folderPath]);
      return {
        ok: true,
        items: [
          { id: "ITEM!2", name: "Projects", folder: {} },
          { id: "ITEM!1", name: "Plan.md", file: {} },
          { id: "LINK!9", name: "Joint", remoteItem: { id: "SHARED!7", folder: {}, parentReference: { driveId: "beefcafe" } } },
        ],
      };
    },
    sharedWithMe: async () => {
      calls.push(["shared"]);
      return {
        ok: true,
        items: [
          { id: "S!1", name: "Handbook", remoteItem: { id: "SHARED!8", folder: {}, parentReference: { driveId: "beefcafe" } } },
          { id: "S!2", name: "notes.md", remoteItem: { id: "SHARED!9", parentReference: { driveId: "beefcafe" } } },
        ],
      };
    },
    ...overrides,
  });
}

test("onedrive:folders lists My files, Shared with me and one folder - folders only, each in its own drive", async () => {
  const calls = [];
  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "my-files" }), {
        ok: true,
        driveId: "d0c0ffee",
        folders: [
          { driveId: "beefcafe", itemId: "SHARED!7", name: "Joint", shared: true },
          { driveId: "d0c0ffee", itemId: "ITEM!2", name: "Projects", shared: false },
        ],
      });
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "shared-with-me" }), {
        ok: true,
        folders: [{ driveId: "beefcafe", itemId: "SHARED!8", name: "Handbook", shared: true }],
      });
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "folder", driveId: "beefcafe", itemId: "SHARED!8" }), {
        ok: true,
        folders: [
          { driveId: "beefcafe", itemId: "SHARED!7", name: "Joint", shared: true },
          { driveId: "beefcafe", itemId: "ITEM!2", name: "Projects", shared: false },
        ],
      });
      assert.deepEqual(calls, [
        ["drive"],
        ["children", "d0c0ffee", "root", ""],
        ["shared"],
        ["children", "beefcafe", "SHARED!8", ""],
      ]);
    },
    { createOneDrive: foldersFactory(calls) },
  );
});

// Spec, open questions: an error from sharedWithMe is "nothing shared" in the picker.
test("Shared with me that cannot be listed is nothing shared, logged by its reason alone", async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => void logged.push(args.map(String).join(" "));
  try {
    await withHandlers(
      async ({ ipcMain }) => {
        assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "shared-with-me" }), { ok: true, folders: [] });
      },
      { createOneDrive: foldersFactory([], { sharedWithMe: async () => ({ ok: false, reason: "unknown" }) }) },
    );
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, ["OneDrive's shared folders could not be listed: unknown"]);
});

test("onedrive:folders passes a failed My files or folder listing on as its reason", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "my-files" }), { ok: false, reason: "offline" });
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "folder", driveId: "beefcafe", itemId: "SHARED!8" }), {
        ok: false,
        reason: "rate-limited",
      });
    },
    {
      createOneDrive: foldersFactory([], {
        drive: async () => ({ ok: false, reason: "offline" }),
        children: async () => ({ ok: false, reason: "rate-limited" }),
      }),
    },
  );
});

test("onedrive:folders refuses a malformed request, and answers not configured without Microsoft", async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => void logged.push(args.map(String).join(" "));
  try {
    await withHandlers(
      async ({ ipcMain }) => {
        assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "folder", driveId: "../x", itemId: "root" }), {
          ok: false,
          reason: "bad-request",
        });
      },
      { createOneDrive: foldersFactory([]) },
    );
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, ["Rejected a malformed OneDrive folder request."]);

  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "my-files" }), { ok: false, reason: "not-configured" });
    },
    { microsoft: "none", createOneDrive: foldersFactory([]) },
  );
});

const PRESIGNED = "https://download.invented.example/presigned-onedrive-ipc";

/// Graph, scripted, for the REAL client. `seen` records every request: its address, whether it carried
/// the token, and which of the client's two fetches sent it - `via: "fetch"` (follows redirects) or
/// `via: "manual"` (never follows one; `manualRedirect.js` in the app).
function scriptedGraph(seen) {
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const file = (id, name, extra = {}) => ({ id, name, size: 7, cTag: `ctag-${id}`, file: {}, webUrl: `https://onedrive.live.com/?id=${id}`, ...extra });
  return async (url, init = {}) => {
    seen.push({ url, authorization: init.headers?.Authorization ?? null, via: init.via, redirect: init.redirect });
    if (url === PRESIGNED) {
      const range = init.headers?.Range;
      if (range === undefined) return new Response("# Plan\n", { status: 200 });
      const [start, end] = range.replace("bytes=", "").split("-").map(Number);
      return new Response(Buffer.from("0123456789").subarray(start, end + 1), {
        status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/10` },
      });
    }
    if (url.endsWith("/content")) return new Response(null, { status: 302, headers: { Location: PRESIGNED } });
    if (url.startsWith("https://graph.microsoft.com/v1.0/me/drive?")) return json({ id: "d0c0ffee", driveType: "personal" });
    if (url.startsWith("https://graph.microsoft.com/v1.0/me/drive/sharedWithMe")) {
      return json({ value: [{ id: "S!1", name: "Handbook", remoteItem: { id: "SHARED!8", folder: {}, parentReference: { driveId: "beefcafe" } } }] });
    }
    if (url.includes("/children?")) {
      return json({
        value: [file("ITEM!1", "Plan.md"), file("ITEM!4", "chart.png"), file("ITEM!2", "clip.mp4", { size: 10 }), { id: "ITEM!3", name: "Archive", folder: {} }],
      });
    }
    if (url.includes(":/Plan.md:?")) return json(file("ITEM!1", "Plan.md"));
    if (url.includes(":/chart.png:?")) return json(file("ITEM!4", "chart.png"));
    if (url.includes("/items/root?")) return json({ id: "ROOT!0", name: "root", folder: { childCount: 4 }, webUrl: "https://onedrive.live.com/" });
    throw new Error(`unexpected ${url}`);
  };
}

// The leak guard, extended to what PR 2 adds: every OneDrive channel and the media byte source, over
// the REAL client and the REAL account, after a connect - so the access token, the refresh token and a
// pre-authenticated download address have all existed. None may appear in an answer or a log line.
test("no OneDrive channel answers with a token or a pre-authenticated download address", async () => {
  const seen = [];
  const logged = [];
  const record = (...args) => void logged.push(args.map(String).join(" "));
  const originals = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  for (const name of Object.keys(originals)) console[name] = record;
  const browser = [];
  try {
    await withHandlers(
      async ({ ipcMain, accounts, auth, authLogged }) => {
        await ipcMain.invoke("onedrive:connect");
        await auth.accessToken({ force: true });
        const answers = [];
        const ask = async (channel, payload) => {
          const answer = await ipcMain.invoke(channel, payload);
          answers.push(JSON.stringify(answer ?? null));
          return answer;
        };

        // Rotated before the walk, so ROTATED has really existed and its absence below means something.
        assert.equal(accounts.tokens.get("onedrive"), ROTATED, "the refresh did not rotate the stored token");

        const opened = await ask("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "root", name: "My files" } });
        assert.equal(opened.ok, true);
        const id = opened.workspace.id;
        assert.equal((await ask("workspace:list", { path: id })).ok, true);
        assert.equal((await ask("file:read", { path: `${id}/Plan.md` })).content, "# Plan\n");
        assert.equal((await ask("file:readImage", { path: `${id}/chart.png` })).ok, true);
        assert.deepEqual(await ask("workspace:reveal", { path: `${id}/Plan.md` }), { ok: true });
        assert.equal((await ask("onedrive:folders", { in: "my-files" })).ok, true);
        assert.equal((await ask("onedrive:folders", { in: "shared-with-me" })).ok, true);
        assert.equal((await ask("onedrive:folders", { in: "folder", driveId: "beefcafe", itemId: "SHARED!8" })).ok, true);
        assert.equal((await ask("workspace:refresh", { workspaceId: id })).ok, true);

        // The byte source is what the tp-media protocol hands the window: bytes, and a size.
        const media = await locateMedia(`${id}/clip.mp4`);
        assert.equal(media.ok, true);
        const range = await media.open(2, 5);
        assert.equal(await new Response(range.body).text(), "2345");
        answers.push(JSON.stringify({ ok: media.ok, size: media.size }));

        const text = [...answers, ...logged, ...authLogged].join(" ");
        for (const secret of [ACCESS, REFRESH, ROTATED, PRESIGNED]) assert.ok(!text.includes(secret), `leaked ${secret}`);
      },
      {
        createOneDrive: (accessToken) => {
          const graph = scriptedGraph(seen);
          return createOneDriveApi({
            accessToken,
            fetch: (url, init) => graph(url, { ...init, via: "fetch" }),
            fetchManual: (url, init) => graph(url, { ...init, via: "manual" }),
            logger: { error: record, info: record },
          });
        },
        openExternal: async (url) => void browser.push(url),
      },
    );
  } finally {
    Object.assign(console, originals);
  }

  // Only meaningful if the token and the address were really used. Graph saw the token; every
  // `/content` request - and there were some - went through the fetch that never follows a redirect,
  // with the token; and the pre-authenticated address was fetched without one.
  assert.ok(seen.some((request) => request.authorization === `Bearer ${ACCESS}`));
  const content = seen.filter((request) => request.url.endsWith("/content"));
  assert.ok(content.length > 0, "no /content request was made, so the redirect was never exercised");
  assert.ok(content.every((request) => request.via === "manual" && request.authorization === `Bearer ${ACCESS}`));
  const presigned = seen.filter((request) => request.url === PRESIGNED);
  assert.ok(presigned.length >= 3);
  assert.ok(presigned.every((request) => request.via === "fetch" && request.authorization === null));
  assert.deepEqual(browser, ["https://onedrive.live.com/?id=ITEM!1"]);
  // Every token-carrying request through the following fetch refuses redirects: in `follow` mode
  // Electron's net.fetch hands the Authorization header to the redirect's target.
  const bearing = seen.filter((request) => request.via === "fetch" && request.authorization !== null);
  assert.ok(bearing.length > 0);
  for (const request of bearing) assert.equal(request.redirect, "error", "a token-carrying request would follow a redirect");
});
