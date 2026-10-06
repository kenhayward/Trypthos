"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGoogleDriveApi } = require("../src/googleDriveApi");

/// The Drive calls against a fake fetch. What is under test is the request itself: the token on it,
/// the one retry for an expired token and the one for a rate limit, the schema check, and that
/// nothing throws or logs a URL.

const ACCESS = "access-invented-drive";
const FOLDER = "folderAAA111";

function answer(status, body, { bytes = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (typeof body === "string") throw new SyntaxError("not json");
      return body;
    },
    // Sliced to the bytes themselves: a small Buffer is a view into a shared pool, and `.buffer`
    // alone would hand back the whole pool.
    arrayBuffer: async () => {
      const source = bytes ?? Buffer.from(JSON.stringify(body));
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    },
  };
}

function setup({ routes = [], tokens = [{ ok: true, token: ACCESS }], timeoutMs, accessToken } = {}) {
  const calls = [];
  const tokenCalls = [];
  const logs = [];
  const slept = [];
  let tokenIndex = 0;
  const api = createGoogleDriveApi({
    timeoutMs,
    accessToken: accessToken ?? (async (options = {}) => {
      tokenCalls.push(options);
      const next = tokens[Math.min(tokenIndex, tokens.length - 1)];
      tokenIndex += 1;
      return next;
    }),
    fetch: async (url, init) => {
      calls.push({ url, authorization: init.headers.Authorization });
      const route = routes.shift();
      if (route === undefined) throw new Error(`no route for call ${calls.length}`);
      return typeof route === "function" ? route(url) : route;
    },
    logger: { error: (line) => logs.push(String(line)) },
    sleep: async (ms) => void slept.push(ms),
    random: () => 0.5,
  });
  return { api, calls, tokenCalls, logs, slept };
}

test("lists a folder with the token on the request", async () => {
  const { api, calls } = setup({
    routes: [answer(200, { files: [{ id: "f1", name: "a.md", mimeType: "text/markdown" }] })],
  });

  const listed = await api.listChildren(FOLDER);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.files.map((file) => file.id), ["f1"]);
  assert.equal(calls[0].authorization, `Bearer ${ACCESS}`);
  assert.equal(new URL(calls[0].url).searchParams.get("q"), `'${FOLDER}' in parents and trashed = false`);
});

test("follows every page of a listing", async () => {
  const { api, calls } = setup({
    routes: [
      answer(200, { nextPageToken: "p2", files: [{ id: "f1", name: "a.md", mimeType: "text/markdown" }] }),
      answer(200, { files: [{ id: "f2", name: "b.md", mimeType: "text/markdown" }] }),
    ],
  });

  const listed = await api.listChildren(FOLDER);
  assert.deepEqual(listed.files.map((file) => file.id), ["f1", "f2"]);
  assert.equal(new URL(calls[1].url).searchParams.get("pageToken"), "p2");
});

test("asks for folders only when told to", async () => {
  const { api, calls } = setup({ routes: [answer(200, { files: [] })] });
  await api.listChildren(FOLDER, { foldersOnly: true });
  assert.match(new URL(calls[0].url).searchParams.get("q"), /mimeType = 'application\/vnd\.google-apps\.folder'/);
});

// An id is spliced into a query. One outside Drive's alphabet never reaches a request.
test("refuses an id that is not a Drive id, without a request", async () => {
  const { api, calls } = setup();
  for (const call of [() => api.listChildren("a' or 'b"), () => api.fileMeta("../x"), () => api.download(""), () => api.exportMarkdown("a b")]) {
    assert.deepEqual(await call(), { ok: false, reason: "not-found" });
  }
  assert.equal(calls.length, 0);
});

test("an expired token is refreshed once and the request repeated", async () => {
  const { api, calls, tokenCalls } = setup({
    tokens: [{ ok: true, token: "stale" }, { ok: true, token: ACCESS }],
    routes: [answer(401, { error: { code: 401 } }), answer(200, { files: [] })],
  });

  assert.equal((await api.listChildren(FOLDER)).ok, true);
  assert.deepEqual(tokenCalls, [{}, { force: true }]);
  assert.deepEqual(calls.map((call) => call.authorization), ["Bearer stale", `Bearer ${ACCESS}`]);
});

test("a second 401 is not connected, and no third request is made", async () => {
  const { api, calls } = setup({
    routes: [answer(401, {}), answer(401, {})],
  });
  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "not-connected" });
  assert.equal(calls.length, 2);
});

test("a rate limit is waited out once, then reported", async () => {
  const limited = () => answer(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } });
  const { api, calls, slept } = setup({ routes: [limited(), limited()] });

  assert.deepEqual(await api.fileMeta("f1"), { ok: false, reason: "rate-limited" });
  assert.equal(calls.length, 2);
  assert.deepEqual(slept, [1500]);
});

test("a rate limit that clears on the retry succeeds", async () => {
  const { api } = setup({
    routes: [answer(429, {}), answer(200, { id: "f1", name: "a.md", mimeType: "text/markdown", headRevisionId: "r1" })],
  });
  const meta = await api.fileMeta("f1");
  assert.equal(meta.ok, true);
  assert.equal(meta.file.headRevisionId, "r1");
});

test("no token is not connected, with no request", async () => {
  const { api, calls } = setup({ tokens: [{ ok: false, reason: "not-connected" }] });
  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "not-connected" });
  assert.equal(calls.length, 0);
});

test("downloads and exports bytes", async () => {
  const { api, calls } = setup({
    routes: [answer(200, null, { bytes: Buffer.from("hello") }), answer(200, null, { bytes: Buffer.from("# Doc") })],
  });

  const downloaded = await api.download("f1");
  assert.equal(Buffer.isBuffer(downloaded.bytes), true);
  assert.equal(downloaded.bytes.toString(), "hello");
  assert.equal((await api.exportMarkdown("g1")).bytes.toString(), "# Doc");
  assert.equal(new URL(calls[0].url).searchParams.get("alt"), "media");
  assert.match(calls[1].url, /\/files\/g1\/export\?/);
});

test("lists every Shared Drive", async () => {
  const { api } = setup({
    routes: [answer(200, { nextPageToken: "p2", drives: [{ id: "d1", name: "Team" }] }), answer(200, { drives: [{ id: "d2", name: "Ops" }] })],
  });
  assert.deepEqual(await api.sharedDrives(), { ok: true, drives: [{ id: "d1", name: "Team" }, { id: "d2", name: "Ops" }] });
});

test("lists every folder shared with the user, across pages", async () => {
  const { api, calls } = setup({
    routes: [
      answer(200, { nextPageToken: "p2", files: [{ id: "s1", name: "Team plan", mimeType: "application/vnd.google-apps.folder", shared: true }] }),
      answer(200, { files: [{ id: "s2", name: "Notes", mimeType: "application/vnd.google-apps.folder" }] }),
    ],
  });
  const listed = await api.sharedWithMeFolders();
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.files.map((file) => file.id), ["s1", "s2"]);
  assert.match(new URL(calls[0].url).searchParams.get("q"), /^sharedWithMe = true/);
  assert.equal(new URL(calls[1].url).searchParams.get("pageToken"), "p2");
});

test("an answer in an unknown shape is offline, logged without the URL", async () => {
  const { api, logs } = setup({ routes: [answer(200, { files: "nope" })] });
  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "offline" });
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes(FOLDER));
});

test("an unreachable Drive is offline, logged with no URL, token or message", async () => {
  const { api, logs } = setup({
    routes: [
      () => {
        throw Object.assign(new Error(`failed https://www.googleapis.com/drive/v3/files?q=${FOLDER} ${ACCESS}`), {
          code: "ERR_INTERNET_DISCONNECTED",
        });
      },
    ],
  });

  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "offline" });
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes(FOLDER) && !logs[0].includes(ACCESS) && !logs[0].includes("googleapis"));
  assert.match(logs[0], /ERR_INTERNET_DISCONNECTED/);
});

test("statuses map through driveErrorFor", async () => {
  const { api } = setup({ routes: [answer(404, {})] });
  assert.deepEqual(await api.download("f1"), { ok: false, reason: "not-found" });
});

const never = () => new Promise(() => {});

test("a body that never arrives is offline once the deadline passes", async () => {
  const stalled = { ok: true, status: 200, json: never, arrayBuffer: never };
  const { api, logs } = setup({ timeoutMs: 20, routes: [stalled, stalled] });
  assert.deepEqual(await api.download("f1"), { ok: false, reason: "offline" });
  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "offline" });
  assert.equal(logs.length, 2);
  assert.ok(logs.every((line) => !line.includes(FOLDER) && !line.includes("googleapis")));
});

test("an error body that never arrives is offline", async () => {
  const stalled = { ok: false, status: 500, json: never, arrayBuffer: never };
  const { api } = setup({ timeoutMs: 20, routes: [stalled] });
  assert.deepEqual(await api.fileMeta("f1"), { ok: false, reason: "offline" });
});

test("a request that never answers is offline", async () => {
  const { api } = setup({ timeoutMs: 20, routes: [never] });
  assert.deepEqual(await api.fileMeta("f1"), { ok: false, reason: "offline" });
});

test("a token supplier that throws is not connected, with no request", async () => {
  const logs = [];
  const calls = [];
  const api = createGoogleDriveApi({
    accessToken: async () => {
      throw new Error(`boom ${ACCESS}`);
    },
    fetch: async (url) => void calls.push(url),
    logger: { error: (line) => logs.push(String(line)) },
  });
  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "not-connected" });
  assert.equal(calls.length, 0);
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes(ACCESS));
});

test("a token supplier that throws on the forced refresh is not connected", async () => {
  let n = 0;
  const api = createGoogleDriveApi({
    accessToken: async () => {
      n += 1;
      if (n > 1) throw new Error("boom");
      return { ok: true, token: "stale" };
    },
    fetch: async () => answer(401, {}),
    logger: { error: () => {} },
  });
  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "not-connected" });
});
