"use strict";

const {
  DriveFileListSchema,
  DriveFileSchema,
  SharedDriveListSchema,
  SharedDriveSchema,
  childrenUrl,
  driveErrorFor,
  driveMediaUrl,
  exportUrl,
  fileUrl,
  isDriveId,
  sharedDriveUrl,
  sharedDrivesUrl,
  sharedWithMeUrl,
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

  /// One attempt: the request AND the reading of its body under a single deadline. Aborting alone
  /// is not enough (a fake, or a stalled socket, may never settle), so the work is raced against the
  /// deadline as well. Answers `{ response, value }` - `value` is what `read` made of the body - or
  /// `null` when the attempt did not complete.
  async function attempt(url, token, read) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });
    const work = (async () => {
      const response = await fetch(url, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
      const value = response.ok ? await read(response) : await response.json().catch(() => null);
      return { response, value };
    })();
    try {
      return await Promise.race([work, deadline]);
    } catch (error) {
      logger.error?.(`A request to Google Drive did not complete: ${codeOf(error)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function tokenFrom(options) {
    try {
      return await accessToken(options);
    } catch (error) {
      logger.error?.(`The Google Drive access token could not be obtained: ${codeOf(error)}`);
      return failure("not-connected");
    }
  }

  /// One GET, with at most one retry after refreshing an expired token and one after waiting out a
  /// rate limit. Answers `{ ok: true, value }` (the body as `read` made it) or a failure.
  async function get(url, read) {
    let token = await tokenFrom();
    if (!token.ok) return token;

    let refreshed = false;
    let waited = false;
    for (;;) {
      const got = await attempt(url, token.token, read);
      if (got === null) return failure("offline");
      if (got.response.ok) return { ok: true, value: got.value };

      const reason = driveErrorFor(got.response.status, got.value);
      if (reason === "not-connected" && !refreshed) {
        refreshed = true;
        token = await tokenFrom({ force: true });
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
    const got = await get(url, (response) => response.json());
    if (!got.ok) return got;
    const parsed = schema.safeParse(got.value);
    if (!parsed.success) {
      logger.error?.("Google Drive answered in a shape this build does not recognise.");
      return failure("offline");
    }
    return { ok: true, value: parsed.data };
  }

  async function getBytes(url) {
    const got = await get(url, async (response) => Buffer.from(await response.arrayBuffer()));
    return got.ok ? { ok: true, bytes: got.value } : got;
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

  async function sharedDrive(id) {
    if (!isDriveId(id)) return failure("not-found");
    const answer = await getJson(sharedDriveUrl(id), SharedDriveSchema);
    return answer.ok ? { ok: true, drive: { id: answer.value.id, name: answer.value.name } } : answer;
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

  async function sharedWithMeFolders() {
    const files = [];
    let pageToken = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await getJson(sharedWithMeUrl(pageToken), DriveFileListSchema);
      if (!answer.ok) return answer;
      files.push(...answer.value.files);
      pageToken = answer.value.nextPageToken ?? null;
      if (pageToken === null) break;
    }
    return { ok: true, files };
  }

  return { listChildren, fileMeta, download, exportMarkdown, sharedDrive, sharedDrives, sharedWithMeFolders };
}

module.exports = { createGoogleDriveApi };
