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

function setup({ routes = [], tokens = [{ ok: true, token: ACCESS }], timeoutMs, accessToken, boundary } = {}) {
  const calls = [];
  const tokenCalls = [];
  const logs = [];
  const slept = [];
  let tokenIndex = 0;
  const api = createGoogleDriveApi({
    timeoutMs,
    boundary,
    accessToken: accessToken ?? (async (options = {}) => {
      tokenCalls.push(options);
      const next = tokens[Math.min(tokenIndex, tokens.length - 1)];
      tokenIndex += 1;
      return next;
    }),
    fetch: async (url, init) => {
      calls.push({ signal: init.signal, url, authorization: init.headers.Authorization, method: init.method, headers: init.headers, body: init.body });
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

test("reads one shared drive by id, with the token", async () => {
  const { api, calls } = setup({ routes: [answer(200, { id: "0AbcDEF", name: "Team Drive Now" })] });
  assert.deepEqual(await api.sharedDrive("0AbcDEF"), { ok: true, drive: { id: "0AbcDEF", name: "Team Drive Now" } });
  assert.equal(new URL(calls[0].url).pathname, "/drive/v3/drives/0AbcDEF");
  assert.equal(calls[0].authorization, `Bearer ${ACCESS}`);
});

test("a shared drive id that is not a Drive id is refused without a request", async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.sharedDrive("a/../b"), { ok: false, reason: "not-found" });
  assert.equal(calls.length, 0);
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

test("uploads new content to a file with PATCH, its type, and the bytes", async () => {
  const { api, calls } = setup({ routes: [answer(200, { id: "f1", name: "a.md", mimeType: "text/markdown", headRevisionId: "r2" })] });
  const bytes = new TextEncoder().encode("# Hi");

  const uploaded = await api.uploadContent("f1", bytes, "text/markdown");
  assert.deepEqual(uploaded, { ok: true, file: { id: "f1", name: "a.md", mimeType: "text/markdown", headRevisionId: "r2" } });
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].headers["Content-Type"], "text/markdown");
  assert.equal(calls[0].headers.Authorization, `Bearer ${ACCESS}`);
  assert.equal(new URL(calls[0].url).searchParams.get("uploadType"), "media");
  assert.deepEqual([...calls[0].body], [...bytes]);
});

test("creates a file with one multipart POST into its folder", async () => {
  const { api, calls } = setup({
    routes: [answer(200, { id: "n1", name: "new.md", mimeType: "text/markdown", headRevisionId: "r1" })],
    boundary: () => "B0UND",
  });

  const created = await api.createFile("folderAAA111", "new.md", new TextEncoder().encode("x"), "text/markdown");
  assert.equal(created.ok, true);
  assert.equal(created.file.id, "n1");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers["Content-Type"], "multipart/related; boundary=trypthos-B0UND");
  const body = new TextDecoder().decode(calls[0].body);
  assert.match(body, /"name":"new\.md"/);
  assert.match(body, /"parents":\["folderAAA111"\]/);
});

test("refuses a write to an id that is not a Drive id, without a request", async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.uploadContent("a' or 'b", new Uint8Array(), "text/plain"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.createFile("../x", "a.md", new Uint8Array(), "text/plain"), { ok: false, reason: "not-found" });
  assert.equal(calls.length, 0);
});

// 401 and 429 mean Drive did not process the request, so the write is repeated once.
test("a write is repeated after an expired token, with the same body", async () => {
  const { api, calls } = setup({
    tokens: [{ ok: true, token: "stale" }, { ok: true, token: ACCESS }],
    routes: [answer(401, {}), answer(200, { id: "f1", name: "a.md", mimeType: "text/plain", headRevisionId: "r2" })],
  });
  assert.equal((await api.uploadContent("f1", new TextEncoder().encode("x"), "text/plain")).ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual([...calls[1].body], [...new TextEncoder().encode("x")]);
});

// A timed-out write may have landed. It is not repeated; the next save's check reports what Drive has.
test("a write that times out is not repeated, and answers offline", async () => {
  const { api, calls } = setup({ routes: [() => new Promise(() => {})], timeoutMs: 20 });
  assert.deepEqual(await api.uploadContent("f1", new Uint8Array([1]), "text/plain"), { ok: false, reason: "offline" });
  assert.equal(calls.length, 1);
});

// A ranged read hands the body back unread: the player pulls it as it plays.
function streamed(status, { pulls = { count: 0 }, cancelled = { value: false }, stall = false } = {}) {
  const body = new ReadableStream({
    pull(controller) {
      pulls.count += 1;
      if (stall) return new Promise(() => {});
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
    cancel() {
      cancelled.value = true;
    },
  }, { highWaterMark: 0 });
  return new Response(body, { status });
}

test("a byte range is asked for with the token and answered as an unread stream", async () => {
  const pulls = { count: 0 };
  const { api, calls } = setup({ routes: [streamed(206, { pulls })] });
  const got = await api.downloadRange("f1", 100, 199);
  assert.equal(got.ok, true);
  assert.equal(got.status, 206);
  assert.equal(calls[0].headers.Range, "bytes=100-199");
  assert.equal(calls[0].authorization, `Bearer ${ACCESS}`);
  assert.equal(new URL(calls[0].url).pathname.endsWith("/f1"), true);
  assert.equal(new URL(calls[0].url).searchParams.get("alt"), "media");
  assert.equal(pulls.count, 0);
  assert.deepEqual([...new Uint8Array(await new Response(got.body).arrayBuffer())], [1, 2, 3]);
});

test("an open-ended range omits the end", async () => {
  const { api, calls } = setup({ routes: [streamed(206)] });
  await api.downloadRange("f1", 5, null);
  assert.equal(calls[0].headers.Range, "bytes=5-");
});

test("the deadline covers the headers only, not a body that stalls", async () => {
  const { api } = setup({ routes: [streamed(206, { stall: true })], timeoutMs: 20 });
  const got = await api.downloadRange("f1", 0, 9);
  assert.equal(got.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(got.body.locked, false);
});

test("headers that never arrive answer offline and abort the request", async () => {
  const { api, calls } = setup({ routes: [() => new Promise(() => {})], timeoutMs: 20 });
  assert.deepEqual(await api.downloadRange("f1", 0, 9), { ok: false, reason: "offline" });
  assert.equal(calls[0].signal.aborted, true);
});

test("an expired token is refreshed once for a range, and the 401 body is released", async () => {
  const cancelled = { value: false };
  const { api, calls, tokenCalls } = setup({
    tokens: [{ ok: true, token: "stale" }, { ok: true, token: ACCESS }],
    routes: [new Response(JSON.stringify({}), { status: 401 }), streamed(206, { cancelled })],
  });
  const got = await api.downloadRange("f1", 0, 9);
  assert.equal(got.status, 206);
  assert.deepEqual(tokenCalls, [{}, { force: true }]);
  assert.equal(calls[1].authorization, `Bearer ${ACCESS}`);
});

test("a rate limit is waited out once for a range", async () => {
  const { api, slept } = setup({ routes: [new Response("{}", { status: 429 }), streamed(206)] });
  assert.equal((await api.downloadRange("f1", 0, 9)).status, 206);
  assert.equal(slept.length, 1);
});

test("a range failure is named: 416, 404 and 403", async () => {
  for (const [status, reason] of [[416, "unsatisfiable"], [404, "not-found"], [403, "permission-denied"]]) {
    const { api } = setup({ routes: [new Response("{}", { status })] });
    assert.deepEqual(await api.downloadRange("f1", 0, 9), { ok: false, reason });
  }
});

test("a 200 answers a range only from the start; otherwise it is refused and released", async () => {
  const whole = setup({ routes: [streamed(200)] });
  const ok = await whole.api.downloadRange("f1", 0, 9);
  assert.equal(ok.ok, true);
  assert.equal(ok.status, 200);

  const cancelled = { value: false };
  const middle = setup({ routes: [streamed(200, { cancelled })] });
  assert.deepEqual(await middle.api.downloadRange("f1", 10, 19), { ok: false, reason: "offline" });
  assert.equal(cancelled.value, true);
});

test("a range of an id that is not a Drive id never reaches a request", async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.downloadRange("../x", 0, 9), { ok: false, reason: "not-found" });
  assert.equal(calls.length, 0);
});

test("a range failure logs no URL, id or token", async () => {
  const { api, logs } = setup({ routes: [() => new Promise(() => {})], timeoutMs: 20 });
  await api.downloadRange("f1", 0, 9);
  assert.ok(logs.length > 0);
  for (const line of logs) assert.doesNotMatch(line, /f1|https?:|access-invented/);
});
