"use strict";

const {
  ONEDRIVE_MY_DRIVE_URL,
  OneDriveDriveSchema,
  OneDriveItemSchema,
  OneDrivePageSchema,
  contentRangeMatches,
  graphErrorCode,
  isGraphUrl,
  isHttpsUrl,
  isOneDriveId,
  oneDriveChildrenUrl,
  oneDriveContentUrl,
  oneDriveFailure,
  oneDriveMetaUrl,
  oneDriveSharedWithMeUrl,
  retryAfterMs,
} = require("@trypthos/domain");

/// The calls to OneDrive (Microsoft Graph), read side, and nothing else. PR 3 adds the writes.
///
/// **Main process only.** The access token comes from `microsoftAuth.js` and never leaves this
/// process; neither does a pre-authenticated download address, which is a credential in all but name
/// for as long as it lives. Addresses, schemas and what a status means are in the domain's
/// `oneDrive.ts`; what is here is the request, the token, the retries, and turning exceptions into
/// results.
///
/// **Two fetches.** `fetch` (Electron's `net.fetch`) for Graph's JSON and for the pre-authenticated
/// address; `fetchManual` (`manualRedirect.js`, over `net.request`) for `/content`, whose 302 must be
/// read and never followed - a followed redirect carries the `Authorization` header to the target,
/// and `net.fetch` cannot read a 302 without following it. The default `fetchManual` throws, so a
/// build that forgets to wire it fails as `offline` rather than following the redirect.
///
/// **Nothing here throws outward**, and no log line carries an address (it holds a path, an id or a
/// signature), a token or an error's message - only what failed and an error code.

const DEFAULT_TIMEOUT_MS = 30_000;
/// A bound on effort, as Drive's: 50 pages of 200 is far past what a tree can usefully show.
const MAX_PAGES = 50;

function failure(reason) {
  return { ok: false, reason };
}

async function noManualFetch() {
  throw Object.assign(new Error("no manual fetch"), { code: "ENOMANUAL" });
}

/// A Graph address from one of the domain's builders, or null: they throw on a path with an empty,
/// `.` or `..` segment, and a path that cannot be addressed is an item that is not there.
function addressOf(build) {
  try {
    return build();
  } catch {
    return null;
  }
}

function createOneDriveApi({
  accessToken,
  fetch = globalThis.fetch,
  fetchManual = noManualFetch,
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  function codeOf(error) {
    return error?.code ?? error?.name ?? "error";
  }

  /// One attempt under the deadline. `work(signal)` makes the request and reads what it needs, and is
  /// raced against the deadline as well as aborted by it: a fake, or a stalled socket, may never
  /// settle. `outer` is the caller's own signal - the window's request for a range - and aborting it
  /// aborts the request at once. Once `work` has answered the deadline stands down, so a body that is
  /// streamed afterwards is never cut off by it. Answers what `work` answered, or null.
  async function deadlined(work, outer = null) {
    const controller = new AbortController();
    let timer;
    let onAbort = null;
    const stop = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
        controller.abort(error);
        reject(error);
      }, timeoutMs);
      if (outer !== null) {
        onAbort = () => {
          const error = Object.assign(new Error("aborted"), { name: "AbortError", abandoned: true });
          controller.abort(error);
          reject(error);
        };
        outer.addEventListener("abort", onAbort, { once: true });
      }
    });
    try {
      return await Promise.race([work(controller.signal), stop]);
    } catch (error) {
      // A caller that gave up is not a failure worth an error line; it is logged quietly, by its code.
      if (error?.abandoned === true) logger.info?.(`A request to OneDrive was abandoned: ${codeOf(error)}`);
      else logger.error?.(`A request to OneDrive did not complete: ${codeOf(error)}`);
      return null;
    } finally {
      clearTimeout(timer);
      if (onAbort !== null) outer.removeEventListener("abort", onAbort);
    }
  }

  async function tokenFrom(options) {
    try {
      return await accessToken(options);
    } catch (error) {
      logger.error?.(`The OneDrive access token could not be obtained: ${codeOf(error)}`);
      return failure("not-connected");
    }
  }

  /// One Graph request with the token. At most one retry after a 401, with a token refreshed for it,
  /// and one after a 429 or 503, waiting what `Retry-After` asks up to ten seconds. `read(response)`
  /// makes the value of an answer below 400 - a 302 included, when `manual` sent the request through
  /// the fetch that never follows one. Answers `{ ok: true, value }` or a failure.
  async function send(url, read, { manual = false } = {}) {
    let token = await tokenFrom();
    if (!token.ok) return token;

    const request = manual ? fetchManual : fetch;
    let refreshed = false;
    let waited = false;
    for (;;) {
      const bearer = token.token;
      const got = await deadlined(async (signal) => {
        const response = await request(url, { method: "GET", signal, headers: { Authorization: `Bearer ${bearer}` } });
        if (response.status < 400) return { response, value: await read(response) };
        return { response, value: await response.json().catch(() => null) };
      });
      if (got === null) return failure("offline");
      const { response } = got;
      if (response.status < 400) return { ok: true, value: got.value };

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        token = await tokenFrom({ force: true });
        if (!token.ok) return token;
        continue;
      }
      const reason = oneDriveFailure(response.status, graphErrorCode(got.value));
      if (reason === "rate-limited" && !waited) {
        waited = true;
        await sleep(retryAfterMs(response.headers?.get("retry-after") ?? null));
        continue;
      }
      return failure(reason);
    }
  }

  async function getJson(url, schema) {
    const got = await send(url, (response) => response.json());
    if (!got.ok) return got;
    const parsed = schema.safeParse(got.value);
    if (!parsed.success) {
      logger.error?.("OneDrive answered in a shape this build does not recognise.");
      return failure("offline");
    }
    return { ok: true, value: parsed.data };
  }

  /// Every page of a listing, following `@odata.nextLink`. The next address comes from Graph's answer
  /// and the token goes with it, so one that is not on Graph is refused rather than followed. This is
  /// the one check: the page schema accepts any string there.
  async function allPages(first) {
    const items = [];
    let url = first;
    for (let page = 0; page < MAX_PAGES && url !== null; page += 1) {
      const answer = await getJson(url, OneDrivePageSchema);
      if (!answer.ok) return answer;
      items.push(...answer.value.value);
      const next = answer.value["@odata.nextLink"] ?? null;
      if (next !== null && !isGraphUrl(next)) {
        logger.error?.("OneDrive named a next page somewhere other than Graph; it was not followed.");
        return failure("unknown");
      }
      url = next;
    }
    return { ok: true, items };
  }

  const ids = (...values) => values.every((value) => typeof value === "string" && isOneDriveId(value));

  async function drive() {
    const answer = await getJson(ONEDRIVE_MY_DRIVE_URL, OneDriveDriveSchema);
    return answer.ok ? { ok: true, drive: answer.value } : answer;
  }

  /// A folder's children, every page, by its path below `itemId` ("" is `itemId` itself).
  async function children(driveId, itemId, path) {
    if (!ids(driveId, itemId)) return failure("not-found");
    const url = addressOf(() => oneDriveChildrenUrl(driveId, itemId, path));
    if (url === null) return failure("not-found");
    return allPages(url);
  }

  async function item(driveId, itemId, path) {
    if (!ids(driveId, itemId)) return failure("not-found");
    const url = addressOf(() => oneDriveMetaUrl(driveId, itemId, path));
    if (url === null) return failure("not-found");
    const answer = await getJson(url, OneDriveItemSchema);
    return answer.ok ? { ok: true, item: answer.value } : answer;
  }

  async function sharedWithMe() {
    return allPages(oneDriveSharedWithMeUrl());
  }

  /// Where a file's bytes can be fetched from: the address Graph's 302 names, asked for through
  /// `fetchManual`, which never follows it, so the token never travels to another host. The address
  /// is pre-authenticated and short-lived, and it never leaves this process.
  async function downloadLocation(driveId, itemId) {
    if (!ids(driveId, itemId)) return failure("not-found");
    const url = addressOf(() => oneDriveContentUrl(driveId, itemId));
    if (url === null) return failure("not-found");
    const got = await send(
      url,
      async (response) => {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        return response.status >= 300 ? location : null;
      },
      { manual: true },
    );
    if (!got.ok) return got;
    if (typeof got.value !== "string" || !isHttpsUrl(got.value)) {
      logger.error?.("OneDrive answered a download without an address this build can use.");
      return failure("unknown");
    }
    return { ok: true, url: got.value };
  }

  /// A file's bytes, refused above `limitBytes` by the length the answer declares or, failing that, by
  /// what arrived. Fetched from the pre-authenticated address with no token at all.
  async function download(driveId, itemId, limitBytes) {
    const where = await downloadLocation(driveId, itemId);
    if (!where.ok) return where;
    const got = await deadlined(async (signal) => {
      const response = await fetch(where.url, { method: "GET", signal, headers: {} });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return { status: response.status };
      }
      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > limitBytes) {
        await response.body?.cancel().catch(() => {});
        return { status: response.status, tooLarge: declared };
      }
      return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
    });
    if (got === null) return failure("offline");
    if (got.tooLarge !== undefined) return { ok: false, reason: "too-large", sizeBytes: got.tooLarge, limitBytes };
    if (got.bytes === undefined) return failure(oneDriveFailure(got.status, null));
    if (got.bytes.length > limitBytes) return { ok: false, reason: "too-large", sizeBytes: got.bytes.length, limitBytes };
    return { ok: true, bytes: got.bytes };
  }

  /// Bytes `start` to `end` (inclusive) from a pre-authenticated address, as the response's own stream
  /// and unread: the caller pulls it as a player plays. No token goes with it. The deadline covers the
  /// headers only, and `signal` - the window's request - aborts it at once.
  ///
  /// Accepted: a 206 whose `Content-Range` is exactly the range asked for, or a 200 for a range that
  /// starts at 0 (the provider checks that it is the whole file). Anything else is released and
  /// refused. A 401 or 403 is the address having expired, which the provider answers by asking once
  /// for a new one.
  async function rangeFrom(url, start, end, { signal } = {}) {
    if (!isHttpsUrl(url)) return failure("unknown");
    if (signal?.aborted) return failure("offline");
    const response = await deadlined(
      (inner) => fetch(url, { method: "GET", signal: inner, headers: { Range: `bytes=${start}-${end}` } }),
      signal ?? null,
    );
    if (response === null) return failure("offline");
    if (response.status === 206 && contentRangeMatches(response.headers.get("content-range"), start, end)) {
      return { ok: true, status: 206, body: response.body };
    }
    if (response.status === 200 && start === 0) return { ok: true, status: 200, body: response.body };
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) return failure("expired");
    if (response.status === 416) return failure("unsatisfiable");
    if (response.ok) {
      logger.error?.("OneDrive answered a range with other bytes than were asked for.");
      return failure("offline");
    }
    return failure(oneDriveFailure(response.status, null));
  }

  return { drive, children, item, sharedWithMe, downloadLocation, download, rangeFrom };
}

module.exports = { createOneDriveApi };
