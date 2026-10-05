"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");
const { createGoogleAuth, GOOGLE_PROVIDER } = require("../src/googleAuth");

/// The Google account through the real handlers, with a real `googleAuth` over a fake Google.

const DRIVE = "https://www.googleapis.com/auth/drive";
const REFRESH = "refresh-invented-ipc";
const ACCESS = "access-invented-ipc";

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

function googleOver(accounts) {
  return createGoogleAuth({
    client: { clientId: "client-1", clientSecret: "invented-secret" },
    accounts,
    logger: { error: () => {} },
    fetch: async (url, init = {}) => {
      if (url.endsWith("/token")) {
        return json(200, { access_token: ACCESS, expires_in: 3600, scope: DRIVE, token_type: "Bearer", refresh_token: REFRESH });
      }
      if (url.endsWith("/userinfo")) return json(200, { email: "ada@example.com" });
      if (url.endsWith("/revoke")) return json(200, {});
      throw new Error(`unexpected ${url} ${init.method}`);
    },
    openExternal: async (url) => {
      const params = new URL(url).searchParams;
      setImmediate(() => void globalThis.fetch(`${params.get("redirect_uri")}/?state=${params.get("state")}&code=c1`).then((r) => r.text()));
    },
  });
}

async function withHandlers(body, { google = "real" } = {}) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-google-ipc-"));
  try {
    const ipcMain = fakeIpcMain();
    const accounts = fakeAccounts();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
      getWindow: () => null,
      userDataDir: userData,
      secrets: { endpointsWithKeys: async () => [], setKey: async () => ({ ok: true }), deleteKey: async () => {}, retainOnly: async () => {} },
      accounts,
      google: google === "real" ? googleOver(accounts) : google,
      explorerIntegration: { supported: () => false, isRegistered: async () => false },
    });
    await body({ ipcMain, accounts });
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
}

test("a build without a Google client says so, and offers nothing", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("google:status"), { ok: true, configured: false, connected: false, email: null, reason: null });
      assert.deepEqual(await ipcMain.invoke("google:connect"), { ok: false, reason: "not-configured" });
      assert.deepEqual(await ipcMain.invoke("google:cancelConnect"), { ok: true });
      assert.deepEqual(await ipcMain.invoke("google:disconnect"), { ok: true });
    },
    { google: null },
  );
});

test("connect, status and disconnect go through to the account", async () => {
  await withHandlers(async ({ ipcMain, accounts }) => {
    assert.deepEqual(await ipcMain.invoke("google:connect"), { ok: true, email: "ada@example.com" });
    assert.equal(accounts.tokens.get(GOOGLE_PROVIDER), REFRESH);

    const status = await ipcMain.invoke("google:status");
    assert.equal(status.connected, true);
    assert.equal(status.email, "ada@example.com");

    assert.deepEqual(await ipcMain.invoke("google:disconnect"), { ok: true });
    assert.equal(accounts.tokens.size, 0);
  });
});

/// The security property, asserted rather than assumed: after signing in, no channel the shell
/// registered answers with the refresh token or the access token.
test("no channel answers with a Google token", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("google:connect");

    // Unrelated handlers log "Rejected malformed IPC payload" for `{}`; collect rather than print.
    const logged = [];
    const realConsoleError = console.error;
    console.error = (...args) => void logged.push(args.map(String).join(" "));
    try {
      for (const [channel, handler] of ipcMain.handlers) {
        if (channel === "google:disconnect") continue; // walked last, below, so the others see a signed-in account
        let text;
        try {
          text = JSON.stringify((await handler(null, {})) ?? null);
        } catch (error) {
          text = `${String(error)} ${error?.stack ?? ""}`;
        }
        assert.ok(!text.includes(REFRESH), `${channel} answered with the refresh token`);
        assert.ok(!text.includes(ACCESS), `${channel} answered with the access token`);
      }
    } finally {
      console.error = realConsoleError;
    }
    const leaked = logged.join("\n");
    assert.ok(!leaked.includes(REFRESH) && !leaked.includes(ACCESS), "a log line carried a Google token");
    const last = JSON.stringify(await ipcMain.invoke("google:disconnect"));
    assert.ok(!last.includes(REFRESH) && !last.includes(ACCESS));
  });
});
