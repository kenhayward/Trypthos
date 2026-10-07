"use strict";

const nodeCrypto = require("node:crypto");
const {
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  GoogleTokenSchema,
  GoogleUserInfoSchema,
  authorizationUrl,
  googleAuthErrorFor,
  grantsDrive,
  readRedirect,
  refreshRequestBody,
  revokeRequestBody,
  tokenRequestBody,
} = require("@trypthos/domain");
const { listenOnce, pkcePair } = require("./loopbackOAuth");

/// A Google account: signing in, staying signed in, and signing out.
///
/// **This lives in the main process and cannot move.** The refresh token is read from the encrypted
/// account store here and never leaves; the access token exists only in this closure. No IPC channel
/// answers with either, and nothing here logs a URL, a body, a code, a state or a verifier - error
/// lines name the step that failed and nothing else.
///
/// Sign-in is Google's flow for desktop apps: the consent page opens in the user's own browser, and
/// Google redirects to a listener on 127.0.0.1 on a port the OS chose, carrying a code that is only
/// worth anything with the PKCE verifier held here. See docs/specs/google-drive-workspace.md.
///
/// **Nothing here throws outward.** Every path answers `{ ok: false, reason }`.

const GOOGLE_PROVIDER = "google-drive";
const DEFAULT_TIMEOUT_MS = 30_000;
/// How long the consent page may stay open before the sign-in is abandoned.
const CONSENT_TIMEOUT_MS = 5 * 60_000;
/// An access token this close to expiry is refreshed rather than used.
const EXPIRY_MARGIN_MS = 60_000;

function failure(reason) {
  return { ok: false, reason };
}

function createGoogleAuth({
  client,
  accounts,
  fetch = globalThis.fetch,
  openExternal,
  listen = listenOnce,
  randomBytes = nodeCrypto.randomBytes,
  now = Date.now,
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  consentTimeoutMs = CONSENT_TIMEOUT_MS,
}) {
  /// `{ token, expiresAt }` while signed in, null otherwise. Memory only.
  let access = null;
  /// The refresh in flight, shared by every caller that arrives while it runs.
  let refreshing = null;
  /// The sign-in waiting on the browser, so a second Connect or a Cancel can stop it.
  let pending = null;
  /// Bumped by every sign-out. Work that began before one must not outlive it: a refresh that lands
  /// afterwards would bring back an access token the user just signed out of.
  let generation = 0;

  /// An account-store call that cannot throw outward. A failed store is `unknown`, and the log line
  /// names the step and the error's code or name - never its message.
  async function safely(step, operation) {
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      logger.error?.(`Account store ${step} failed: ${error?.code ?? error?.name}`);
      return failure("unknown");
    }
  }

  /// One request to Google, with a timeout. Answers `{ status, ok, body }` or null when it never
  /// arrived. `step` is the only thing a log line says about it.
  async function call(url, { method = "GET", body = null, bearer = null }, step) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timed out")), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          ...(body === null ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
          ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
        },
        ...(body === null ? {} : { body }),
      });
      const parsed = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, body: parsed };
    } catch (error) {
      logger.error?.(`Google ${step} did not complete: ${error?.code ?? error?.name}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function tokenCall(body, step) {
    const answer = await call(GOOGLE_TOKEN_URL, { method: "POST", body }, step);
    if (answer === null) return failure("offline");
    if (!answer.ok) return failure(googleAuthErrorFor(answer.status, answer.body));
    const parsed = GoogleTokenSchema.safeParse(answer.body);
    if (!parsed.success) {
      logger.error?.(`Google answered the ${step} in a shape this build does not recognise.`);
      return failure("offline");
    }
    return { ok: true, token: parsed.data };
  }

  async function whoami(accessToken) {
    const answer = await call(GOOGLE_USERINFO_URL, { bearer: accessToken }, "account lookup");
    if (answer === null) return failure("offline");
    if (!answer.ok) return failure(googleAuthErrorFor(answer.status, answer.body));
    const parsed = GoogleUserInfoSchema.safeParse(answer.body);
    if (!parsed.success) {
      logger.error?.("Google answered the account lookup in a shape this build does not recognise.");
      return failure("offline");
    }
    return { ok: true, email: parsed.data.email };
  }

  function remember(token) {
    access = { token: token.access_token, expiresAt: now() + token.expires_in * 1000 };
  }

  async function connect() {
    if (client === null) return failure("not-configured");
    pending?.cancel("cancelled");

    // Registered before the listener starts, so a Cancel or a second Connect arriving while it
    // starts still finds this sign-in.
    let resolveStopped;
    const stopped = new Promise((resolve) => (resolveStopped = resolve));
    const mine = {
      reason: undefined,
      cancel: (reason) => {
        if (mine.reason !== undefined) return;
        mine.reason = reason;
        resolveStopped({ stopped: reason });
      },
    };
    pending = mine;

    let listener;
    try {
      listener = await listen();
    } catch (error) {
      logger.error?.(`Could not listen for Google's answer: ${error?.code ?? error?.name}`);
      if (pending === mine) pending = null;
      return failure(mine.reason ?? "offline");
    }
    if (mine.reason !== undefined) {
      listener.close();
      if (pending === mine) pending = null;
      return failure(mine.reason);
    }

    const { verifier, challenge, state } = pkcePair(randomBytes);

    const timer = setTimeout(() => mine.cancel("timed-out"), consentTimeoutMs);

    try {
      try {
        await openExternal(
          authorizationUrl({ clientId: client.clientId, redirectUri: listener.redirectUri, state, codeChallenge: challenge }),
        );
      } catch (error) {
        logger.error?.(`Could not open the browser for Google sign-in: ${error?.code ?? error?.name}`);
        return failure("unknown");
      }

      const outcome = await Promise.race([listener.arrived.then((url) => ({ url })), stopped]);
      if (outcome.stopped !== undefined) return failure(outcome.stopped);
      // The answer is in: a late timeout or cancel timer is no longer what ends this.
      clearTimeout(timer);

      const redirect = readRedirect(outcome.url, state);
      if (!redirect.ok) return redirect;

      const exchanged = await tokenCall(
        tokenRequestBody({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          code: redirect.code,
          codeVerifier: verifier,
          redirectUri: listener.redirectUri,
        }),
        "sign-in",
      );
      if (!exchanged.ok) return exchanged;

      const token = exchanged.token;
      if (!grantsDrive(token.scope)) return failure("scope-denied");
      if (token.refresh_token === undefined) {
        logger.error?.("Google granted access without a refresh token.");
        return failure("offline");
      }

      const who = await whoami(token.access_token);
      if (!who.ok) return who;

      // A sign-out or cancel during the exchange wins: nothing is stored.
      if (mine.reason !== undefined) return failure(mine.reason);

      // Stored last: a credential reaches disk only once it has been shown to work.
      const saved = await safely("save", () => accounts.setToken(GOOGLE_PROVIDER, token.refresh_token));
      if (!saved.ok) return saved;
      if (!saved.value.ok) return saved.value;

      if (mine.reason !== undefined) {
        await safely("delete", () => accounts.deleteToken(GOOGLE_PROVIDER));
        return failure(mine.reason);
      }
      remember(token);
      return { ok: true, email: who.email };
    } finally {
      clearTimeout(timer);
      listener.close();
      if (pending === mine) pending = null;
    }
  }

  function cancelConnect() {
    pending?.cancel("cancelled");
  }

  async function refresh() {
    const began = generation;
    const read = await safely("read", () => accounts.getToken(GOOGLE_PROVIDER));
    if (!read.ok) return read;
    const refreshToken = read.value;
    if (typeof refreshToken !== "string" || refreshToken === "") return failure("not-connected");

    const refreshed = await tokenCall(
      refreshRequestBody({ clientId: client.clientId, clientSecret: client.clientSecret, refreshToken }),
      "refresh",
    );
    if (!refreshed.ok) return refreshed;
    if (generation !== began) return failure("not-connected");
    remember(refreshed.token);
    return { ok: true, token: refreshed.token.access_token };
  }

  async function accessToken({ force = false } = {}) {
    if (client === null) return failure("not-configured");
    if (!force && access !== null && access.expiresAt - now() > EXPIRY_MARGIN_MS) {
      return { ok: true, token: access.token };
    }
    if (refreshing === null) {
      const mineRefresh = refresh().finally(() => {
        if (refreshing === mineRefresh) refreshing = null;
      });
      refreshing = mineRefresh;
    }
    return refreshing;
  }

  async function status() {
    const answer = (fields) => ({ ok: true, configured: client !== null, connected: false, email: null, reason: null, ...fields });
    if (client === null) return answer({});
    const has = await safely("check", () => accounts.hasToken(GOOGLE_PROVIDER));
    if (!has.ok) return answer({ reason: has.reason });
    if (!has.value) return answer({});

    // Asked of Google rather than answered from a stored name: a grant can be revoked from the
    // Google account, and an indicator naming an account the app cannot reach would be a lie.
    const token = await accessToken();
    if (!token.ok) return answer({ reason: token.reason });
    const who = await whoami(token.token);
    return who.ok ? answer({ connected: true, email: who.email }) : answer({ reason: who.reason });
  }

  async function disconnect() {
    pending?.cancel("cancelled");
    // Forgotten in memory first, before anything is awaited: whatever the store does next, this
    // process no longer holds an access token for the account the user signed out of.
    generation += 1;
    access = null;
    refreshing = null;

    const read = await safely("read", () => accounts.getToken(GOOGLE_PROVIDER));
    const refreshToken = read.ok ? read.value : null;
    if (typeof refreshToken === "string" && refreshToken !== "") {
      const answer = await call(GOOGLE_REVOKE_URL, { method: "POST", body: revokeRequestBody(refreshToken) }, "sign-out");
      // Signing out is what the user asked for, and it happens here regardless. Google forgets the
      // grant on its own side when the token is never used again.
      if (answer !== null && !answer.ok) logger.error?.("Google did not confirm the sign-out. It is forgotten here regardless.");
    }
    const deleted = await safely("delete", () => accounts.deleteToken(GOOGLE_PROVIDER));
    if (!deleted.ok) return deleted;
    // The store's own refusal (a newer build's file, or one it could not open - issue #235) is the
    // answer: the token is still on disk, and saying otherwise would be a sign-out that did not happen.
    if (deleted.value?.ok === false) return deleted.value;
    return { ok: true };
  }

  return { connect, cancelConnect, accessToken, status, disconnect };
}

module.exports = { createGoogleAuth, GOOGLE_PROVIDER };
