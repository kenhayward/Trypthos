"use strict";

const {
  DriveFileListSchema,
  DriveFileSchema,
  SharedDriveListSchema,
  childrenUrl,
  driveErrorFor,
  driveMediaUrl,
  exportUrl,
  fileUrl,
  isDriveId,
  sharedDrivesUrl,
} = require("@trypthos/domain");

/// The calls to Google Drive, and nothing else.
///
/// **Main process only**, like the GitHub client: the access token comes from `googleAuth.js` and
/// never leaves this process. Addresses, schemas and what a status means are in the domain; what is
/// here is the request, the token, the retries, and turning exceptions into results.
///
/// **Nothing here throws outward**, and no log line carries a URL (it holds a folder id), a token or
/// an error's message - only what failed and an error code.

const DEFAULT_TIMEOUT_MS = 30_000;
/// A bound on effort, not a belief about folder sizes: 50 pages of 1000 is far past what a tree can
/// usefully show.
const MAX_PAGES = 50;
const RETRY_DELAY_MS = 1_000;

function failure(reason) {
  return { ok: false, reason };
}

function createGoogleDriveApi({
  accessToken,
  fetch = globalThis.fetch,
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
}) {
  function codeOf(error) {
    return error?.code ?? error?.name ?? "error";
  }

  async function send(url, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timed out")), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      logger.error?.(`A request to Google Drive did not complete: ${codeOf(error)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /// One GET, with at most one retry after refreshing an expired token and one after waiting out a
  /// rate limit. Answers `{ ok: true, response }` or a failure.
  async function get(url) {
    let token = await accessToken();
    if (!token.ok) return token;

    let refreshed = false;
    let waited = false;
    for (;;) {
      const response = await send(url, token.token);
      if (response === null) return failure("offline");
      if (response.ok) return { ok: true, response };

      const body = await response.json().catch(() => null);
      const reason = driveErrorFor(response.status, body);
      if (reason === "not-connected" && !refreshed) {
        refreshed = true;
        token = await accessToken({ force: true });
        if (!token.ok) return token;
        continue;
      }
      if (reason === "rate-limited" && !waited) {
        waited = true;
        await sleep(RETRY_DELAY_MS + Math.floor(random() * RETRY_DELAY_MS));
        continue;
      }
      return failure(reason);
    }
  }

  async function getJson(url, schema) {
    const got = await get(url);
    if (!got.ok) return got;

    let body;
    try {
      body = await got.response.json();
    } catch {
      logger.error?.("Google Drive answered with something that is not JSON.");
      return failure("offline");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      logger.error?.("Google Drive answered in a shape this build does not recognise.");
      return failure("offline");
    }
    return { ok: true, value: parsed.data };
  }

  async function getBytes(url) {
    const got = await get(url);
    if (!got.ok) return got;
    try {
      return { ok: true, bytes: Buffer.from(await got.response.arrayBuffer()) };
    } catch (error) {
      logger.error?.(`A download from Google Drive did not complete: ${codeOf(error)}`);
      return failure("offline");
    }
  }

  async function listChildren(folderId, { foldersOnly = false } = {}) {
    if (!isDriveId(folderId)) return failure("not-found");
    const files = [];
    let pageToken = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await getJson(childrenUrl(folderId, pageToken, foldersOnly), DriveFileListSchema);
      if (!answer.ok) return answer;
      files.push(...answer.value.files);
      pageToken = answer.value.nextPageToken ?? null;
      if (pageToken === null) break;
    }
    return { ok: true, files };
  }

  async function fileMeta(id) {
    if (!isDriveId(id)) return failure("not-found");
    const answer = await getJson(fileUrl(id), DriveFileSchema);
    return answer.ok ? { ok: true, file: answer.value } : answer;
  }

  async function download(id) {
    if (!isDriveId(id)) return failure("not-found");
    return getBytes(driveMediaUrl(id));
  }

  async function exportMarkdown(id) {
    if (!isDriveId(id)) return failure("not-found");
    return getBytes(exportUrl(id));
  }

  async function sharedDrives() {
    const drives = [];
    let pageToken = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await getJson(sharedDrivesUrl(pageToken), SharedDriveListSchema);
      if (!answer.ok) return answer;
      drives.push(...answer.value.drives.map((drive) => ({ id: drive.id, name: drive.name })));
      pageToken = answer.value.nextPageToken ?? null;
      if (pageToken === null) break;
    }
    return { ok: true, drives };
  }

  return { listChildren, fileMeta, download, exportMarkdown, sharedDrives };
}

module.exports = { createGoogleDriveApi };
