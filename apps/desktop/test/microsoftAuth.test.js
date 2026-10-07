"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMicrosoftAuth, MICROSOFT_PROVIDER } = require("../src/microsoftAuth");

const CLIENT = { clientId: "00000000-1111-2222-3333-444444444444" };
const GRANTED = "Files.ReadWrite.All User.Read";

function fakeAccounts(initial = null) {
  const tokens = new Map(initial === null ? [] : [[MICROSOFT_PROVIDER, initial]]);
  return {
    tokens,
    setToken: async (provider, token) => (tokens.set(provider, token), { ok: true }),
    getToken: async (provider) => tokens.get(provider) ?? null,
    hasToken: async (provider) => tokens.has(provider),
    deleteToken: async (provider) => void tokens.delete(provider),
  };
}

const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

/// A fake Microsoft. `token` answers the token endpoint; each refresh hands out a NEW refresh token,
/// as the spike showed Microsoft does.
function fakeMicrosoft({ scope = GRANTED, me = { mail: "ada@example.com" }, refreshAnswer = null } = {}) {
  const calls = [];
  let issued = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/token")) {
      const body = new URLSearchParams(init.body);
      if (body.get("grant_type") === "refresh_token" && refreshAnswer !== null) return refreshAnswer(body);
      issued += 1;
      return json(200, {
        access_token: `access-invented-${issued}`,
        expires_in: 3599,
        scope,
        token_type: "Bearer",
        refresh_token: `refresh-invented-${issued}`,
      });
    }
    if (url.includes("graph.microsoft.com/v1.0/me")) return json(200, me);
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, calls };
}

function harness({ accounts = fakeAccounts(), microsoft = fakeMicrosoft(), answer = (state) => `code=c1&state=${state}`, now = () => 0 } = {}) {
  const logged = [];
  let settle = null;
  let listenOptions = null;
  let opened = null;
  const instance = createMicrosoftAuth({
    client: CLIENT,
    accounts,
    fetch: microsoft.fetch,
    now,
    logger: { error: (line) => logged.push(line) },
    listen: async (options) => {
      listenOptions = options;
      const arrived = new Promise((done) => (settle = done));
      return { redirectUri: "http://localhost:5050", arrived, close: () => {} };
    },
    openExternal: async (url) => {
      opened = new URL(url);
      const query = answer(opened.searchParams.get("state"));
      if (query !== null) setImmediate(() => settle(`http://localhost:5050/?${query}`));
    },
  });
  return { instance, accounts, microsoft, logged, listenOptions: () => listenOptions, opened: () => opened };
}

test("connects: opens Microsoft's page, exchanges the code, stores the refresh token, names the account", async () => {
  const h = harness();
  const result = await h.instance.connect();

  assert.deepEqual(result, { ok: true, email: "ada@example.com" });
  assert.deepEqual(h.listenOptions(), { redirectHost: "localhost" });
  assert.equal(h.opened().origin + h.opened().pathname, "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
  assert.equal(h.accounts.tokens.get("onedrive"), "refresh-invented-1");
  const exchange = new URLSearchParams(h.microsoft.calls[0].init.body);
  assert.equal(exchange.get("code"), "c1");
  assert.equal(exchange.has("client_secret"), false);
});

test("a redirect without our state is not Microsoft's answer, and nothing is stored", async () => {
  const h = harness({ answer: () => "code=c1&state=forged" });
  assert.deepEqual(await h.instance.connect(), { ok: false, reason: "bad-request" });
  assert.equal(h.accounts.tokens.size, 0);
  assert.equal(h.microsoft.calls.length, 0);
});

test("closing the consent page with access_denied is cancelled", async () => {
  const h = harness({ answer: (state) => `error=access_denied&state=${state}` });
  assert.deepEqual(await h.instance.connect(), { ok: false, reason: "cancelled" });
});

test("Cancel while the browser is open answers cancelled", async () => {
  const h = harness({ answer: () => null });
  const pending = h.instance.connect();
  await new Promise((resolve) => setImmediate(resolve));
  h.instance.cancelConnect();
  assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
});

test("a grant without Files.ReadWrite.All is refused and not stored", async () => {
  const h = harness({ microsoft: fakeMicrosoft({ scope: "User.Read" }) });
  assert.deepEqual(await h.instance.connect(), { ok: false, reason: "scope-denied" });
  assert.equal(h.accounts.tokens.size, 0);
});

// The spike: every refresh hands back a new refresh token. Keeping the old one would leave the app
// holding a token Microsoft may already have retired.
test("stores the rotated refresh token on every refresh", async () => {
  let clock = 0;
  const h = harness({ accounts: fakeAccounts("refresh-invented-0"), now: () => clock });
  const first = await h.instance.accessToken();
  assert.deepEqual(first, { ok: true, token: "access-invented-1" });
  assert.equal(h.accounts.tokens.get("onedrive"), "refresh-invented-1");
  assert.equal(new URLSearchParams(h.microsoft.calls[0].init.body).get("refresh_token"), "refresh-invented-0");

  clock += 3_600_000;
  const second = await h.instance.accessToken();
  assert.deepEqual(second, { ok: true, token: "access-invented-2" });
  assert.equal(h.accounts.tokens.get("onedrive"), "refresh-invented-2");
  assert.equal(new URLSearchParams(h.microsoft.calls[1].init.body).get("refresh_token"), "refresh-invented-1");
});

test("two callers at once share one refresh", async () => {
  const h = harness({ accounts: fakeAccounts("refresh-invented-0") });
  const [one, two] = await Promise.all([h.instance.accessToken(), h.instance.accessToken()]);
  assert.deepEqual(one, two);
  assert.equal(h.microsoft.calls.filter((call) => call.url.endsWith("/token")).length, 1);
});

test("an access token is reused until a minute before it expires", async () => {
  let clock = 0;
  const h = harness({ accounts: fakeAccounts("refresh-invented-0"), now: () => clock });
  await h.instance.accessToken();
  clock = (3599 - 61) * 1000;
  await h.instance.accessToken();
  assert.equal(h.microsoft.calls.length, 1);
  clock = (3599 - 59) * 1000;
  await h.instance.accessToken();
  assert.equal(h.microsoft.calls.length, 2);
});

test("a refresh Microsoft refuses as invalid_grant forgets the stored token", async () => {
  const h = harness({
    accounts: fakeAccounts("refresh-invented-0"),
    microsoft: fakeMicrosoft({ refreshAnswer: () => json(400, { error: "invalid_grant" }) }),
  });
  assert.deepEqual(await h.instance.accessToken(), { ok: false, reason: "not-connected" });
  assert.equal(h.accounts.tokens.has("onedrive"), false);
});

test("a refresh whose new token cannot be stored fails rather than carrying on with the old one", async () => {
  const accounts = fakeAccounts("refresh-invented-0");
  accounts.setToken = async () => {
    throw Object.assign(new Error("disk"), { code: "EACCES" });
  };
  const h = harness({ accounts });
  assert.deepEqual(await h.instance.accessToken(), { ok: false, reason: "unknown" });
  assert.deepEqual(h.logged, ["Account store save failed: EACCES"]);
});

test("status asks Microsoft who the account is", async () => {
  const h = harness({ accounts: fakeAccounts("refresh-invented-0"), microsoft: fakeMicrosoft({ me: { mail: null, userPrincipalName: "ada@outlook.com" } }) });
  assert.deepEqual(await h.instance.status(), {
    ok: true,
    configured: true,
    connected: true,
    email: "ada@outlook.com",
    reason: null,
  });
});

test("status with nothing stored is not connected, and asks nobody", async () => {
  const h = harness();
  assert.deepEqual(await h.instance.status(), { ok: true, configured: true, connected: false, email: null, reason: null });
  assert.equal(h.microsoft.calls.length, 0);
});

test("status after Microsoft refused the stored token is simply not connected", async () => {
  const h = harness({
    accounts: fakeAccounts("refresh-invented-0"),
    microsoft: fakeMicrosoft({ refreshAnswer: () => json(400, { error: "invalid_grant" }) }),
  });
  assert.deepEqual(await h.instance.status(), { ok: true, configured: true, connected: false, email: null, reason: null });
});

test("a build without a client is not configured", async () => {
  const instance = createMicrosoftAuth({ client: null, accounts: fakeAccounts(), openExternal: async () => {} });
  assert.deepEqual(await instance.connect(), { ok: false, reason: "not-configured" });
  assert.deepEqual(await instance.status(), { ok: true, configured: false, connected: false, email: null, reason: null });
});

// Microsoft has no revoke endpoint for a personal account's token. Disconnect forgets it here.
test("disconnect forgets the token locally, without calling Microsoft", async () => {
  const h = harness({ accounts: fakeAccounts("refresh-invented-0") });
  await h.instance.accessToken();
  const before = h.microsoft.calls.length;
  assert.deepEqual(await h.instance.disconnect(), { ok: true });
  assert.equal(h.accounts.tokens.has("onedrive"), false);
  assert.equal(h.microsoft.calls.length, before);
  assert.deepEqual(await h.instance.status(), { ok: true, configured: true, connected: false, email: null, reason: null });
});

test("no log line carries a token, a code or the state", async () => {
  const h = harness({
    accounts: fakeAccounts("refresh-invented-0"),
    microsoft: fakeMicrosoft({ refreshAnswer: () => json(500, { error: "server_error" }) }),
  });
  await h.instance.accessToken();
  await h.instance.disconnect();
  const text = h.logged.join("\n");
  for (const secret of ["refresh-invented-0", "access-invented", "c1"]) assert.equal(text.includes(secret), false);
});
