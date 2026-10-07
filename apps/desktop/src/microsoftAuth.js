"use strict";

const nodeCrypto = require("node:crypto");
const {
  GRAPH_ME_URL,
  GraphMeSchema,
  MICROSOFT_TOKEN_URL,
  MicrosoftTokenSchema,
  ONEDRIVE_PROVIDER,
  accountEmail,
  grantsOneDrive,
  microsoftAuthErrorFor,
  microsoftAuthorizationUrl,
  microsoftRefreshRequestBody,
  microsoftTokenRequestBody,
  readRedirect,
} = require("@trypthos/domain");
const { listenOnce, pkcePair } = require("./loopbackOAuth");

/// A personal Microsoft account, for OneDrive: signing in, staying signed in, and signing out.
///
/// **This lives in the main process and cannot move.** The refresh token is read from the encrypted
/// account store here and never leaves; the access token exists only in this closure. No IPC channel
/// answers with either, and no log line carries a URL, a body, a code, the state or the verifier.
///
/// Google's flow (googleAuth.js) with Microsoft's differences, from the spike in
/// docs/specs/onedrive-workspace.md:
/// - a public client: no secret anywhere;
/// - the redirect is `http://localhost:<port>`, because that is what the registration lists;
/// - **the refresh token rotates on every refresh**, so each refresh stores the new one before it
///   answers, and only one refresh runs at a time - two would race to store, and the loser's token
///   could be the one kept;
/// - there is no revoke endpoint for a personal account's token, so disconnect forgets it here.
///
/// **Nothing here throws outward.** Every path answers `{ ok: false, reason }`.

const MICROSOFT_PROVIDER = ONEDRIVE_PROVIDER;
const DEFAULT_TIMEOUT_MS = 30_000;
const CONSENT_TIMEOUT_MS = 5 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;

function failure(reason) {
  return { ok: false, reason };
}

function createMicrosoftAuth({
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
  let access = null;
  let refreshing = null;
  let pending = null;
  /// Bumped by every sign-out, so work begun before one cannot bring a token back after it.
  let generation = 0;

  async function safely(step, operation) {
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      logger.error?.(`Account store ${step} failed: ${error?.code ?? error?.name}`);
      return failure("unknown");
    }
  }

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
      logger.error?.(`Microsoft ${step} did not complete: ${error?.code ?? error?.name}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function tokenCall(body, step) {
    const answer = await call(MICROSOFT_TOKEN_URL, { method: "POST", body }, step);
    if (answer === null) return failure("offline");
    if (!answer.ok) return failure(microsoftAuthErrorFor(answer.status, answer.body));
    const parsed = MicrosoftTokenSchema.safeParse(answer.body);
    if (!parsed.success) {
      logger.error?.(`Microsoft answered the ${step} in a shape this build does not recognise.`);
      return failure("offline");
    }
    return { ok: true, token: parsed.data };
  }

  async function whoami(accessToken) {
    const answer = await call(GRAPH_ME_URL, { bearer: accessToken }, "account lookup");
    if (answer === null) return failure("offline");
    if (!answer.ok) return failure(microsoftAuthErrorFor(answer.status, answer.body));
    const parsed = GraphMeSchema.safeParse(answer.body);
    if (!parsed.success) {
      logger.error?.("Microsoft answered the account lookup in a shape this build does not recognise.");
      return failure("offline");
    }
    return { ok: true, email: accountEmail(parsed.data) };
  }

  function remember(token) {
    access = { token: token.access_token, expiresAt: now() + token.expires_in * 1000 };
  }

  async function connect() {
    if (client === null) return failure("not-configured");
    pending?.cancel("cancelled");

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
      listener = await listen({ redirectHost: "localhost" });
    } catch (error) {
      logger.error?.(`Could not listen for Microsoft's answer: ${error?.code ?? error?.name}`);
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
          microsoftAuthorizationUrl({ clientId: client.clientId, redirectUri: listener.redirectUri, state, codeChallenge: challenge }),
        );
      } catch (error) {
        logger.error?.(`Could not open the browser for Microsoft sign-in: ${error?.code ?? error?.name}`);
        return failure("unknown");
      }

      const outcome = await Promise.race([listener.arrived.then((url) => ({ url })), stopped]);
      if (outcome.stopped !== undefined) return failure(outcome.stopped);
      clearTimeout(timer);

      const redirect = readRedirect(outcome.url, state);
      if (!redirect.ok) return redirect;

      const exchanged = await tokenCall(
        microsoftTokenRequestBody({
          clientId: client.clientId,
          code: redirect.code,
          codeVerifier: verifier,
          redirectUri: listener.redirectUri,
        }),
        "sign-in",
      );
      if (!exchanged.ok) return exchanged;

      const token = exchanged.token;
      if (!grantsOneDrive(token.scope)) return failure("scope-denied");

      const who = await whoami(token.access_token);
      if (!who.ok) return who;
      if (mine.reason !== undefined) return failure(mine.reason);

      // Stored last: a credential reaches disk only once it has been shown to work.
      const saved = await safely("save", () => accounts.setToken(MICROSOFT_PROVIDER, token.refresh_token));
      if (!saved.ok) return saved;
      if (saved.value && saved.value.ok === false) return saved.value;

      if (mine.reason !== undefined) {
        await safely("delete", () => accounts.deleteToken(MICROSOFT_PROVIDER));
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
    const read = await safely("read", () => accounts.getToken(MICROSOFT_PROVIDER));
    if (!read.ok) return read;
    const refreshToken = read.value;
    if (typeof refreshToken !== "string" || refreshToken === "") return failure("not-connected");

    const refreshed = await tokenCall(microsoftRefreshRequestBody({ clientId: client.clientId, refreshToken }), "refresh");
    if (!refreshed.ok) {
      // Microsoft will not take this token again: keeping it would make every launch ask and fail.
      if (refreshed.reason === "not-connected" && generation === began) {
        await safely("delete", () => accounts.deleteToken(MICROSOFT_PROVIDER));
      }
      return refreshed;
    }
    if (generation !== began) return failure("not-connected");

    // The new refresh token is stored BEFORE the access token is handed out. If it cannot be, the
    // refresh fails: carrying on would leave the store holding a token Microsoft may have retired.
    const saved = await safely("save", () => accounts.setToken(MICROSOFT_PROVIDER, refreshed.token.refresh_token));
    if (!saved.ok) return saved;
    if (saved.value && saved.value.ok === false) return saved.value;
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
    const has = await safely("check", () => accounts.hasToken(MICROSOFT_PROVIDER));
    if (!has.ok) return answer({ reason: has.reason });
    if (!has.value) return answer({});

    const token = await accessToken();
    if (!token.ok) return answer({ reason: token.reason === "not-connected" ? null : token.reason });
    const who = await whoami(token.token);
    return who.ok ? answer({ connected: true, email: who.email }) : answer({ reason: who.reason });
  }

  async function disconnect() {
    pending?.cancel("cancelled");
    generation += 1;
    access = null;
    refreshing = null;
    const deleted = await safely("delete", () => accounts.deleteToken(MICROSOFT_PROVIDER));
    if (!deleted.ok) return deleted;
    return { ok: true };
  }

  return { connect, cancelConnect, accessToken, status, disconnect };
}

module.exports = { createMicrosoftAuth, MICROSOFT_PROVIDER };
