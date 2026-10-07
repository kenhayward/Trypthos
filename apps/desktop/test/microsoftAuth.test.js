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

// ---- Fix round 1: leak guard over the paths that DO log, and the write races ----

/// Wraps a fake Microsoft so a test can intercept calls. `hook(url, init, inner)` answers, or returns
/// undefined to let the inner fake answer.
function intercept(inner, hook) {
  return {
    calls: inner.calls,
    fetch: async (url, init = {}) => {
      const answered = await hook(url, init, inner.fetch);
      return answered === undefined ? inner.fetch(url, init) : answered;
    },
  };
}

function deferred() {
  let release;
  const promise = new Promise((resolve) => (release = resolve));
  return { promise, release };
}

const isGrant = (init, grant) => new URLSearchParams(init.body ?? "").get("grant_type") === grant;
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("log lines from the failing paths carry no token, code, state or verifier", async () => {
  const secrets = new Set(["refresh-invented-0", "access-invented-1", "refresh-invented-1", "c1"]);
  const logged = [];
  const boom = () => Object.assign(new Error("boom refresh-invented-0 c1 access-invented-1"), { code: "ECONNRESET" });

  // 1. connect: the token exchange throws.
  let exchangeBody = null;
  const throwing = harness({
    microsoft: intercept(fakeMicrosoft(), (url, init) => {
      if (url.endsWith("/token") && isGrant(init, "authorization_code")) {
        exchangeBody = new URLSearchParams(init.body);
        throw boom();
      }
    }),
  });
  assert.deepEqual(await throwing.instance.connect(), { ok: false, reason: "offline" });
  secrets.add(throwing.opened().searchParams.get("state"));
  secrets.add(exchangeBody.get("code_verifier"));
  logged.push(...throwing.logged);

  // 2. refresh: the call throws.
  const refreshThrows = harness({
    accounts: fakeAccounts("refresh-invented-0"),
    microsoft: intercept(fakeMicrosoft(), (url, init) => {
      if (url.endsWith("/token") && isGrant(init, "refresh_token")) throw boom();
    }),
  });
  assert.equal((await refreshThrows.instance.accessToken()).ok, false);
  logged.push(...refreshThrows.logged);

  // 3. a malformed token body, on both the exchange and a refresh.
  const malformed = (url) => (url.endsWith("/token") ? json(200, { access_token: "access-invented-1" }) : undefined);
  const badExchange = harness({ microsoft: intercept(fakeMicrosoft(), malformed) });
  assert.equal((await badExchange.instance.connect()).ok, false);
  logged.push(...badExchange.logged);
  const badRefresh = harness({ accounts: fakeAccounts("refresh-invented-0"), microsoft: intercept(fakeMicrosoft(), malformed) });
  assert.equal((await badRefresh.instance.accessToken()).ok, false);
  logged.push(...badRefresh.logged);

  // 4. the account store fails, on read and on save.
  const readFails = fakeAccounts("refresh-invented-0");
  readFails.getToken = async () => {
    throw Object.assign(new Error("refresh-invented-0"), { code: "EIO" });
  };
  const storeRead = harness({ accounts: readFails });
  await storeRead.instance.accessToken();
  logged.push(...storeRead.logged);
  const saveFails = fakeAccounts();
  saveFails.setToken = async () => {
    throw Object.assign(new Error("refresh-invented-1 c1"), { code: "EACCES" });
  };
  const storeSave = harness({ accounts: saveFails });
  assert.deepEqual(await storeSave.instance.connect(), { ok: false, reason: "unknown" });
  logged.push(...storeSave.logged);

  assert.ok(logged.length >= 6, `expected the failing paths to log, got ${logged.length}`);
  const text = logged.join("\n");
  for (const secret of secrets) {
    assert.ok(secret && secret.length > 0);
    assert.equal(text.includes(secret), false, "a log line carried a secret");
  }
});

test("a disconnect while the refresh's token call is pending: not connected, nothing stored", async () => {
  const gate = deferred();
  const reached = deferred();
  const h = harness({
    accounts: fakeAccounts("refresh-invented-0"),
    microsoft: intercept(fakeMicrosoft(), async (url, init, inner) => {
      if (!isGrant(init, "refresh_token")) return undefined;
      reached.release();
      await gate.promise;
      return inner(url, init);
    }),
  });
  const refreshing = h.instance.accessToken();
  await reached.promise;
  await h.instance.disconnect();
  gate.release();

  assert.deepEqual(await refreshing, { ok: false, reason: "not-connected" });
  assert.equal(h.accounts.tokens.has("onedrive"), false);
  assert.deepEqual(await h.instance.accessToken(), { ok: false, reason: "not-connected" });
});

test("a disconnect while the rotated token is being saved still leaves nothing stored", async () => {
  const accounts = fakeAccounts("refresh-invented-0");
  const reached = deferred();
  const gate = deferred();
  accounts.setToken = async (provider, token) => {
    reached.release();
    await gate.promise;
    accounts.tokens.set(provider, token);
    return { ok: true };
  };
  const h = harness({ accounts });
  const refreshing = h.instance.accessToken();
  await reached.promise;
  const disconnecting = h.instance.disconnect();
  await tick();
  gate.release();

  assert.deepEqual(await refreshing, { ok: false, reason: "not-connected" });
  assert.deepEqual(await disconnecting, { ok: true });
  assert.equal(accounts.tokens.has("onedrive"), false);
});

/// An old refresh is held at Microsoft while the user signs in again. `oldAnswer` is what Microsoft
/// then says to the old refresh.
async function reconnectDuringRefresh(oldAnswer) {
  const gate = deferred();
  const reached = deferred();
  const h = harness({
    accounts: fakeAccounts("refresh-invented-0"),
    microsoft: intercept(fakeMicrosoft(), async (url, init, inner) => {
      if (!isGrant(init, "refresh_token")) return undefined;
      reached.release();
      await gate.promise;
      return oldAnswer === null ? inner(url, init) : oldAnswer;
    }),
  });
  const old = h.instance.accessToken();
  await reached.promise;
  assert.deepEqual(await h.instance.connect(), { ok: true, email: "ada@example.com" });
  gate.release();
  return { h, old: await old };
}

test("an old refresh refused as invalid_grant cannot delete the token a reconnect just stored", async () => {
  const { h } = await reconnectDuringRefresh(json(400, { error: "invalid_grant" }));
  assert.equal(h.accounts.tokens.get("onedrive"), "refresh-invented-1");
});

test("an old refresh that succeeds cannot overwrite the reconnected account's tokens", async () => {
  const { h, old } = await reconnectDuringRefresh(null);
  assert.deepEqual(old, { ok: false, reason: "not-connected" });
  assert.equal(h.accounts.tokens.get("onedrive"), "refresh-invented-1");
  assert.deepEqual(await h.instance.accessToken(), { ok: true, token: "access-invented-1" });
});

test("a refresh queued behind another write does not save once a sign-out has happened meanwhile", async () => {
  const accounts = fakeAccounts("refresh-invented-0");
  const realDelete = accounts.deleteToken;
  const gate = deferred();
  let first = true;
  accounts.deleteToken = async (provider) => {
    if (first) {
      first = false;
      await gate.promise;
    }
    return realDelete(provider);
  };
  const saves = [];
  const realSet = accounts.setToken;
  accounts.setToken = async (provider, token) => (saves.push(token), realSet(provider, token));
  const h = harness({ accounts });

  const firstSignOut = h.instance.disconnect(); // holds the lock open
  const refreshing = h.instance.accessToken(); // its token call completes, then it queues for the lock
  for (let i = 0; i < 10; i += 1) await tick();
  const secondSignOut = h.instance.disconnect(); // happens while the refresh waits its turn
  gate.release();
  await Promise.all([firstSignOut, secondSignOut]);

  assert.deepEqual(await refreshing, { ok: false, reason: "not-connected" });
  assert.deepEqual(saves, []);
  assert.equal(accounts.tokens.has("onedrive"), false);
});

test("a client of undefined is not configured rather than a crash", async () => {
  const instance = createMicrosoftAuth({
    client: undefined,
    accounts: fakeAccounts(),
    openExternal: async () => {},
    listen: async () => {
      throw new Error("must not listen");
    },
    logger: { error: () => {} },
  });
  assert.deepEqual(await instance.connect(), { ok: false, reason: "not-configured" });
  assert.deepEqual(await instance.accessToken(), { ok: false, reason: "not-configured" });
  assert.deepEqual(await instance.status(), { ok: true, configured: false, connected: false, email: null, reason: null });
});

test("if the PKCE pair cannot be made, the listener still closes and nothing opens", async () => {
  let closed = false;
  let opened = false;
  const logged = [];
  const instance = createMicrosoftAuth({
    client: CLIENT,
    accounts: fakeAccounts(),
    logger: { error: (line) => logged.push(line) },
    randomBytes: () => {
      throw Object.assign(new Error("entropy"), { code: "ENTROPY" });
    },
    listen: async () => ({ redirectUri: "http://localhost:5050", arrived: new Promise(() => {}), close: () => (closed = true) }),
    openExternal: async () => {
      opened = true;
    },
  });
  assert.deepEqual(await instance.connect(), { ok: false, reason: "unknown" });
  assert.equal(closed, true);
  assert.equal(opened, false);
  assert.deepEqual(logged, ["Could not prepare Microsoft sign-in: ENTROPY"]);
});

// ---- Final review C1: a write is visible only when it lands ----

/// An account store whose writes become visible only when the test lets them land, as the real
/// encrypted store's do (at the rename). `hold(op)` holds the NEXT `op` ("set" or "delete") and
/// answers `{ reached, release }`.
function gatedAccounts(initial = null) {
  const accounts = fakeAccounts(initial);
  const holds = { set: [], delete: [] };
  const held = async (op, apply) => {
    const next = holds[op].shift();
    if (next !== undefined) {
      next.reached.release();
      await next.gate.promise;
    }
    return apply();
  };
  accounts.setToken = (provider, token) => held("set", () => (accounts.tokens.set(provider, token), { ok: true }));
  accounts.deleteToken = (provider) => held("delete", () => void accounts.tokens.delete(provider));
  accounts.hold = (op) => {
    const entry = { reached: deferred(), gate: deferred() };
    holds[op].push(entry);
    return { reached: entry.reached.promise, release: entry.gate.release };
  };
  return accounts;
}

/// A fake Microsoft with two accounts. The sign-in is Grace's; a refresh rotates whichever account's
/// refresh token it is given, so a token in the store always says whose it is.
function twoAccountMicrosoft() {
  const calls = [];
  const token = (who, n) => ({
    access_token: `access-${who}-${n}`,
    expires_in: 3599,
    scope: GRANTED,
    token_type: "Bearer",
    refresh_token: `refresh-${who}-${n}`,
  });
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/token")) {
      const body = new URLSearchParams(init.body);
      if (body.get("grant_type") === "authorization_code") return json(200, token("grace", 1));
      const [, who, n] = body.get("refresh_token").split("-");
      return json(200, token(who, Number(n) + 1));
    }
    if (url.includes("graph.microsoft.com/v1.0/me")) {
      const who = init.headers.Authorization.split("-")[1];
      return json(200, { mail: `${who}@example.com` });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, calls };
}

test("a refresh begun while a reconnect's save is landing refreshes the new account, not the old", async () => {
  const accounts = gatedAccounts("refresh-ada-0");
  const save = accounts.hold("set");
  const h = harness({ accounts, microsoft: twoAccountMicrosoft() });

  const connecting = h.instance.connect();
  await save.reached; // the generation has moved on; Grace's token is not on disk yet
  const refreshing = h.instance.accessToken();
  for (let i = 0; i < 10; i += 1) await tick();
  save.release();

  assert.deepEqual(await connecting, { ok: true, email: "grace@example.com" });
  await refreshing;
  assert.match(accounts.tokens.get("onedrive"), /^refresh-grace-/);
  const now = await h.instance.accessToken();
  assert.equal(now.ok, true);
  assert.match(now.token, /^access-grace-/);
});

test("a refresh begun while a cancelled sign-in's token is being deleted cannot bring it back", async () => {
  const accounts = gatedAccounts();
  const save = accounts.hold("set");
  const removal = accounts.hold("delete");
  const h = harness({ accounts, microsoft: twoAccountMicrosoft() });

  const connecting = h.instance.connect();
  await save.reached;
  h.instance.cancelConnect(); // too late to stop the save; connect deletes what it stored
  save.release();
  await removal.reached;
  const refreshing = h.instance.accessToken();
  for (let i = 0; i < 10; i += 1) await tick();
  removal.release();

  assert.deepEqual(await connecting, { ok: false, reason: "cancelled" });
  await refreshing;
  assert.equal(accounts.tokens.has("onedrive"), false);
  assert.deepEqual(await h.instance.accessToken(), { ok: false, reason: "not-connected" });
});
