"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGoogleAuth, GOOGLE_PROVIDER } = require("../src/googleAuth");

/// Signing in to Google, through a real loopback listener and a fake Google.
///
/// The browser is played by `openExternal`: it reads the consent URL the shell built and makes the
/// request Google would redirect it to - a real HTTP request to the real listener. Google's token and
/// userinfo endpoints are a fake fetch. So what is under test is the order of things and what is
/// stored when, which is where a sign-in goes wrong.

const DRIVE = "https://www.googleapis.com/auth/drive";
const CLIENT = { clientId: "client-1", clientSecret: "invented-secret" };
const REFRESH = "refresh-invented-1";
const ACCESS = "access-invented-1";

function fakeAccounts() {
  const tokens = new Map();
  return {
    tokens,
    setToken: async (provider, token) => (tokens.set(provider, token), { ok: true }),
    getToken: async (provider) => tokens.get(provider) ?? null,
    hasToken: async (provider) => tokens.has(provider),
    deleteToken: async (provider) => void tokens.delete(provider),
  };
}

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/// Google's endpoints. Each can be overridden per test; every call is recorded.
function fakeGoogle(overrides = {}) {
  const calls = [];
  const routes = {
    token: (body) =>
      body.get("grant_type") === "authorization_code"
        ? json(200, { access_token: ACCESS, expires_in: 3600, scope: `openid ${DRIVE}`, token_type: "Bearer", refresh_token: REFRESH })
        : json(200, { access_token: "access-refreshed", expires_in: 3600, scope: DRIVE, token_type: "Bearer" }),
    userinfo: () => json(200, { email: "ada@example.com" }),
    revoke: () => json(200, {}),
    ...overrides,
  };
  const fetch = async (url, init = {}) => {
    const body = new URLSearchParams(init.body ?? "");
    calls.push({ url, body, authorization: init.headers?.Authorization ?? null });
    if (url === "https://oauth2.googleapis.com/token") return routes.token(body);
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") return routes.userinfo();
    if (url === "https://oauth2.googleapis.com/revoke") return routes.revoke(body);
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, calls };
}

/// The browser: follows the consent URL to the redirect Google would make.
function browserThat(answer = (params) => `state=${params.get("state")}&code=code-1&scope=${encodeURIComponent(DRIVE)}`) {
  const opened = [];
  const openExternal = async (url) => {
    opened.push(url);
    const params = new URL(url).searchParams;
    const redirect = `${params.get("redirect_uri")}/?${answer(params)}`;
    // Not awaited by the shell: a browser answers in its own time.
    setImmediate(() => void globalThis.fetch(redirect).then((r) => r.text()));
  };
  return { openExternal, opened };
}

function collectingLogger() {
  const lines = [];
  return { lines, error: (line) => lines.push(String(line)) };
}

function auth(options = {}) {
  const accounts = options.accounts ?? fakeAccounts();
  const google = options.google ?? fakeGoogle();
  const browser = options.browser ?? browserThat();
  const logger = collectingLogger();
  let clock = 1_000_000;
  const instance = createGoogleAuth({
    client: options.client === undefined ? CLIENT : options.client,
    accounts,
    fetch: google.fetch,
    openExternal: browser.openExternal,
    now: () => clock,
    logger,
    listen: options.listen,
    consentTimeoutMs: options.consentTimeoutMs ?? 5_000,
  });
  return { auth: instance, accounts, google, browser, logger, advance: (ms) => (clock += ms) };
}

test("signs in, stores the refresh token, and reports the email", async () => {
  const { auth: google, accounts, browser } = auth();

  assert.deepEqual(await google.connect(), { ok: true, email: "ada@example.com" });
  assert.equal(accounts.tokens.get(GOOGLE_PROVIDER), REFRESH);
  assert.equal(browser.opened.length, 1);

  const consent = new URL(browser.opened[0]).searchParams;
  assert.match(consent.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(consent.get("code_challenge_method"), "S256");
});

test("the code is exchanged with the verifier whose challenge was sent", async () => {
  const crypto = require("node:crypto");
  const { auth: google, google: fake, browser } = auth();
  await google.connect();

  const challenge = new URL(browser.opened[0]).searchParams.get("code_challenge");
  const exchange = fake.calls.find((call) => call.body.get("grant_type") === "authorization_code");
  const verifier = exchange.body.get("code_verifier");
  assert.equal(crypto.createHash("sha256").update(verifier).digest("base64url"), challenge);
  assert.equal(exchange.body.get("code"), "code-1");
});

// The GitHub rule: a credential reaches disk only after it has been shown to work.
test("nothing is stored when the Drive scope was unticked", async () => {
  const google = fakeGoogle({
    token: () => json(200, { access_token: ACCESS, expires_in: 3600, scope: "openid email", token_type: "Bearer", refresh_token: REFRESH }),
  });
  const { auth: signIn, accounts } = auth({ google });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "scope-denied" });
  assert.equal(accounts.tokens.size, 0);
});

test("nothing is stored when Google will not say who the account is", async () => {
  const google = fakeGoogle({ userinfo: () => json(401, { error: "invalid_token" }) });
  const { auth: signIn, accounts } = auth({ google });

  assert.equal((await signIn.connect()).ok, false);
  assert.equal(accounts.tokens.size, 0);
});

test("a declined consent is cancelled and stores nothing", async () => {
  const browser = browserThat((params) => `state=${params.get("state")}&error=access_denied`);
  const { auth: signIn, accounts } = auth({ browser });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "cancelled" });
  assert.equal(accounts.tokens.size, 0);
});

test("a redirect with somebody else's state is refused and the code never exchanged", async () => {
  const browser = browserThat(() => "state=forged&code=code-1");
  const { auth: signIn, google } = auth({ browser });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "bad-request" });
  assert.equal(google.calls.length, 0);
});

test("a consent nobody answers times out", async () => {
  const browser = { opened: [], openExternal: async () => {} };
  const { auth: signIn } = auth({ browser, consentTimeoutMs: 20 });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "timed-out" });
});

/// A browser that opens the consent page and never answers - the user has wandered off.
function silentBrowser() {
  const browser = { opened: [], openExternal: async (url) => void browser.opened.push(url) };
  return browser;
}

/// Waits until a condition holds. The listener starts asynchronously, so "connect has reached the
/// browser" is something to wait for, not something one tick guarantees.
async function until(condition) {
  for (let tries = 0; tries < 200 && !condition(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), "condition never held");
}

test("cancel stops a sign-in that is waiting on the browser", async () => {
  const browser = silentBrowser();
  const { auth: signIn, accounts } = auth({ browser });
  const waiting = signIn.connect();
  await until(() => browser.opened.length === 1);

  signIn.cancelConnect();
  assert.deepEqual(await waiting, { ok: false, reason: "cancelled" });
  assert.equal(accounts.tokens.size, 0);
});

// A user who closed the browser tab and clicks Connect again must not be left with two listeners.
test("a second connect cancels the first", async () => {
  const browser = silentBrowser();
  const { auth: signIn } = auth({ browser });
  const first = signIn.connect();
  await until(() => browser.opened.length === 1);

  const second = signIn.connect();
  assert.deepEqual(await first, { ok: false, reason: "cancelled" });

  await until(() => browser.opened.length === 2);
  signIn.cancelConnect();
  assert.deepEqual(await second, { ok: false, reason: "cancelled" });
});

test("connect before a client exists answers not configured", async () => {
  const { auth: signIn, browser } = auth({ client: null });
  assert.deepEqual(await signIn.connect(), { ok: false, reason: "not-configured" });
  assert.equal(browser.opened.length, 0);
});

test("the access token from sign-in is reused until it nears expiry, then refreshed once", async () => {
  const { auth: signIn, google, advance } = auth();
  await signIn.connect();

  assert.deepEqual(await signIn.accessToken(), { ok: true, token: ACCESS });
  advance(3_600_000 - 30_000); // inside the last minute

  const [one, two] = await Promise.all([signIn.accessToken(), signIn.accessToken()]);
  assert.deepEqual(one, { ok: true, token: "access-refreshed" });
  assert.deepEqual(two, one);
  const refreshes = google.calls.filter((call) => call.body.get("grant_type") === "refresh_token");
  assert.equal(refreshes.length, 1, "concurrent callers share one refresh");
  assert.equal(refreshes[0].body.get("refresh_token"), REFRESH);
});

// A grant revoked in the Google account reads as not connected with the reason, and the stored
// token stays - the same as a revoked GitHub token, so the user sees why rather than a blank slate.
test("a revoked grant reads as not connected and leaves the stored token", async () => {
  const accounts = fakeAccounts();
  await accounts.setToken(GOOGLE_PROVIDER, "refresh-stale");
  const google = fakeGoogle({ token: () => json(400, { error: "invalid_grant" }) });
  const { auth: signIn } = auth({ accounts, google });

  assert.deepEqual(await signIn.status(), {
    ok: true,
    configured: true,
    connected: false,
    email: null,
    reason: "not-connected",
  });
  assert.equal(accounts.tokens.get(GOOGLE_PROVIDER), "refresh-stale");
});

test("status with a stored token asks Google who it is", async () => {
  const accounts = fakeAccounts();
  await accounts.setToken(GOOGLE_PROVIDER, REFRESH);
  const { auth: signIn, google } = auth({ accounts });

  assert.deepEqual(await signIn.status(), { ok: true, configured: true, connected: true, email: "ada@example.com", reason: null });
  assert.equal(google.calls.at(-1).authorization, "Bearer access-refreshed");
});

test("status before any sign-in, and in a build without a client", async () => {
  assert.deepEqual(await auth().auth.status(), { ok: true, configured: true, connected: false, email: null, reason: null });
  assert.deepEqual(await auth({ client: null }).auth.status(), {
    ok: true,
    configured: false,
    connected: false,
    email: null,
    reason: null,
  });
});

test("disconnect revokes at Google, then forgets both tokens", async () => {
  const { auth: signIn, accounts, google } = auth();
  await signIn.connect();

  assert.deepEqual(await signIn.disconnect(), { ok: true });
  const revoke = google.calls.find((call) => call.url === "https://oauth2.googleapis.com/revoke");
  assert.equal(revoke.body.get("token"), REFRESH);
  assert.equal(accounts.tokens.size, 0);
  assert.deepEqual(await signIn.accessToken(), { ok: false, reason: "not-connected" });
});

// Signing out is what the user asked for, and it happens here whether or not Google answers.
test("disconnect still forgets the token when Google's revoke fails", async () => {
  const google = fakeGoogle({ revoke: () => json(503, {}) });
  const { auth: signIn, accounts, logger } = auth({ google });
  await signIn.connect();

  assert.deepEqual(await signIn.disconnect(), { ok: true });
  assert.equal(accounts.tokens.size, 0);
  assert.equal(logger.lines.length, 1);
});

test("an unreachable Google is offline, and nothing secret is logged", async () => {
  const google = {
    calls: [],
    fetch: async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    },
  };
  const { auth: signIn, logger } = auth({ google });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "offline" });
  for (const line of logger.lines) {
    assert.ok(!/code-1|invented-secret|state=|verifier/.test(line), `logged something secret: ${line}`);
  }
});

/// A listener that counts how many it opened and how many were closed.
function countingListen() {
  const { listenOnce } = require("../src/googleAuth");
  const counts = { opened: 0, closed: 0 };
  const listen = async () => {
    const listener = await listenOnce();
    counts.opened += 1;
    return {
      ...listener,
      close: () => {
        counts.closed += 1;
        listener.close();
      },
    };
  };
  return { listen, counts };
}

// connect() has not reached the browser yet while the listener starts; a cancel then must still land.
test("a cancel in the same tick as connect still cancels, and closes the listener", async () => {
  const browser = silentBrowser();
  const { listen, counts } = countingListen();
  const { auth: signIn } = auth({ browser, listen });

  const waiting = signIn.connect();
  signIn.cancelConnect();

  assert.deepEqual(await waiting, { ok: false, reason: "cancelled" });
  assert.equal(browser.opened.length, 0);
  assert.equal(counts.closed, counts.opened);
});

test("two connects in one tick, then a cancel: both settle cancelled and at most one browser opens", async () => {
  const browser = silentBrowser();
  const { listen, counts } = countingListen();
  const { auth: signIn } = auth({ browser, listen });

  const first = signIn.connect();
  const second = signIn.connect();
  signIn.cancelConnect();

  assert.deepEqual(await first, { ok: false, reason: "cancelled" });
  assert.deepEqual(await second, { ok: false, reason: "cancelled" });
  assert.ok(browser.opened.length <= 1);
  assert.equal(counts.closed, counts.opened);
});

/// A promise to hold a fake Google answer open, and the key that releases it.
function gate() {
  let release;
  const open = new Promise((resolve) => (release = resolve));
  return { open, release };
}

// Signing out after the redirect has arrived must not be undone by the sign-in still finishing.
test("disconnect while sign-in is checking the account wins: nothing stored, not connected", async () => {
  const held = gate();
  const google = fakeGoogle({
    userinfo: async () => {
      await held.open;
      return json(200, { email: "ada@example.com" });
    },
  });
  const { auth: signIn, accounts } = auth({ google });

  const connecting = signIn.connect();
  await until(() => google.calls.some((call) => call.url === "https://openidconnect.googleapis.com/v1/userinfo"));
  assert.deepEqual(await signIn.disconnect(), { ok: true });
  held.release();

  assert.deepEqual(await connecting, { ok: false, reason: "cancelled" });
  assert.equal(accounts.tokens.size, 0);
  assert.deepEqual(await signIn.accessToken(), { ok: false, reason: "not-connected" });
});

test("a refresh that finishes after disconnect does not bring the access token back", async () => {
  const accounts = fakeAccounts();
  await accounts.setToken(GOOGLE_PROVIDER, REFRESH);
  const held = gate();
  const google = fakeGoogle({
    token: async () => {
      await held.open;
      return json(200, { access_token: "access-stale", expires_in: 3600, scope: DRIVE, token_type: "Bearer" });
    },
  });
  const { auth: signIn } = auth({ accounts, google });

  const refreshing = signIn.accessToken();
  await until(() => google.calls.some((call) => call.url === "https://oauth2.googleapis.com/token"));
  await signIn.disconnect();
  held.release();

  assert.deepEqual(await refreshing, { ok: false, reason: "not-connected" });
  assert.deepEqual(await signIn.accessToken(), { ok: false, reason: "not-connected" });
});

test("an account store that throws on save fails the sign-in as unknown and closes the listener", async () => {
  const accounts = fakeAccounts();
  accounts.setToken = async () => {
    throw new Error("disk full");
  };
  const { listen, counts } = countingListen();
  const { auth: signIn, logger } = auth({ accounts, listen });

  assert.deepEqual(await signIn.connect(), { ok: false, reason: "unknown" });
  assert.equal(counts.closed, counts.opened);
  assert.ok(logger.lines.every((line) => !line.includes("disk full")));
});

test("a store that cannot delete answers unknown, and the old access token is gone", async () => {
  const { auth: signIn, accounts } = auth();
  await signIn.connect();
  accounts.deleteToken = async () => {
    throw new Error("locked");
  };

  assert.deepEqual(await signIn.disconnect(), { ok: false, reason: "unknown" });
  const after = await signIn.accessToken();
  assert.notDeepEqual(after, { ok: true, token: ACCESS });
});

test("no secret reaches a log line on any failing path", async () => {
  const recording = (route) => {
    const google = fakeGoogle({ token: route });
    return google;
  };
  const offline = fakeGoogle();
  const realFetch = offline.fetch;
  offline.fetch = async (url, init) => {
    await realFetch(url, init); // recorded, answered, then discarded: the line drops
    throw Object.assign(new Error("connection lost"), { code: "ECONNRESET" });
  };
  const paths = [
    { name: "offline", google: offline, run: (s) => s.connect() },
    {
      name: "scope denied",
      google: recording(() => json(200, { access_token: ACCESS, expires_in: 3600, scope: "openid", token_type: "Bearer", refresh_token: REFRESH })),
      run: (s) => s.connect(),
    },
    { name: "revoke 503", google: fakeGoogle({ revoke: () => json(503, {}) }), run: async (s) => (await s.connect(), s.disconnect()) },
    { name: "schema mismatch", google: recording(() => json(200, {})), run: (s) => s.connect() },
  ];

  for (const path of paths) {
    const { auth: signIn, browser, logger } = auth({ google: path.google });
    await path.run(signIn);

    const consent = new URL(browser.opened[0]).searchParams;
    const exchange = path.google.calls.find((call) => call.body.get("grant_type") === "authorization_code");
    const secrets = [consent.get("state"), consent.get("code_challenge"), REFRESH, ACCESS, "code-1", "invented-secret"];
    if (exchange) secrets.push(exchange.body.get("code_verifier"));
    assert.ok(secrets.every((secret) => typeof secret === "string" && secret !== ""), "every secret was captured");
    for (const line of logger.lines) {
      for (const secret of secrets) {
        assert.ok(!line.includes(secret), `${path.name}: logged a secret: ${line}`);
      }
    }
  }
});
