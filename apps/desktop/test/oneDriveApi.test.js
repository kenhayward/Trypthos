"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOneDriveApi } = require("../src/oneDriveApi");

/// The OneDrive reads against a fake fetch and a fake manual fetch. What is under test is the request:
/// the token on every Graph request and never on a pre-authenticated address, `/content` asked only
/// through the fetch that never follows a redirect, the one retry after a 401 and the one after a 429
/// or 503, the paging, the schema check, the ranged-read rule, and that nothing throws or logs an
/// address, an id or a token.

const ACCESS = "access-invented-onedrive-api";
const DRIVE = "d0c0ffee";
const PRESIGNED = "https://download.invented.example/presigned-onedrive-api";

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const redirect = (location = PRESIGNED) => new Response(null, { status: 302, headers: { Location: location } });

const PLAN = { id: "ITEM!1", name: "Plan.md", size: 5, eTag: "etag-1", cTag: "ctag-1", file: { mimeType: "text/markdown" } };
const ARCHIVE = { id: "ITEM!2", name: "Archive", folder: { childCount: 1 } };

/// `routes` answer `fetch`, `manualRoutes` answer `fetchManual`; both record into one `calls`, each
/// tagged with the fetch it went through. `withoutManual` builds the client as a build that forgot to
/// wire `fetchManual` would.
function setup({ routes = [], manualRoutes = [], tokens = [{ ok: true, token: ACCESS }], timeoutMs, withoutManual = false } = {}) {
  const calls = [];
  const tokenCalls = [];
  const logs = [];
  const slept = [];
  let tokenIndex = 0;
  const answer = (queue, via) => async (url, init) => {
    calls.push({ via, url, init, authorization: init.headers?.Authorization ?? null });
    const route = queue.shift();
    if (route === undefined) throw new Error(`no ${via} route for call ${calls.length}`);
    return typeof route === "function" ? route(url, init) : route;
  };
  const api = createOneDriveApi({
    timeoutMs,
    accessToken: async (options = {}) => {
      tokenCalls.push(options);
      const next = tokens[Math.min(tokenIndex, tokens.length - 1)];
      tokenIndex += 1;
      return next;
    },
    fetch: answer(routes, "fetch"),
    ...(withoutManual ? {} : { fetchManual: answer(manualRoutes, "manual") }),
    logger: { error: (line) => logs.push(String(line)), info: (line) => logs.push(String(line)) },
    sleep: async (ms) => void slept.push(ms),
  });
  return { api, calls, tokenCalls, logs, slept };
}

test("asks which drive is the connected account's, with the token", async () => {
  const { api, calls } = setup({ routes: [json(200, { id: DRIVE, driveType: "personal" })] });
  assert.deepEqual(await api.drive(), { ok: true, drive: { id: DRIVE, driveType: "personal" } });
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/me/drive?$select=id,driveType");
  assert.equal(calls[0].authorization, `Bearer ${ACCESS}`);
  assert.equal(calls[0].via, "fetch");
});

test("reads one item by its path below the workspace root", async () => {
  const { api, calls } = setup({ routes: [json(200, PLAN)] });
  const answer = await api.item(DRIVE, "root", "Notes/Plan.md");
  assert.equal(answer.ok, true);
  assert.equal(answer.item.cTag, "ctag-1");
  assert.ok(calls[0].url.startsWith("https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes/Plan.md:?$select="));
});

test("lists a folder by path, following every page Graph names on Graph", async () => {
  const next = "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes:/children?$skiptoken=p2";
  const { api, calls } = setup({ routes: [json(200, { value: [PLAN], "@odata.nextLink": next }), json(200, { value: [ARCHIVE] })] });
  const listed = await api.children(DRIVE, "root", "Notes");
  assert.deepEqual(listed.items.map((item) => item.id), ["ITEM!1", "ITEM!2"]);
  assert.ok(calls[0].url.startsWith("https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes:/children?$top=200&"));
  assert.equal(calls[1].url, next);
  assert.ok(calls.every((call) => call.authorization === `Bearer ${ACCESS}`));
});

// The next page's address comes from the answer, and the token would go with it.
test("refuses a next page that is not on Graph, and sends it nothing", async () => {
  const { api, calls, logs } = setup({ routes: [json(200, { value: [PLAN], "@odata.nextLink": "https://elsewhere.example/steal" })] });
  assert.deepEqual(await api.children(DRIVE, "root", ""), { ok: false, reason: "unknown" });
  assert.equal(calls.length, 1);
  // The whole log, exactly: the one fixed line, with no address in it.
  assert.deepEqual(logs, ["OneDrive named a next page somewhere other than Graph; it was not followed."]);
});

test("lists what is shared with the user, across pages", async () => {
  const shared = (n) => ({ id: `S!${n}`, name: `Shared ${n}`, remoteItem: { id: `SHARED!${n}`, folder: {}, parentReference: { driveId: "beefcafe" } } });
  const { api, calls } = setup({
    routes: [
      json(200, { value: [shared(1)], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/sharedWithMe?$skiptoken=2" }),
      json(200, { value: [shared(2)] }),
    ],
  });
  const answer = await api.sharedWithMe();
  assert.deepEqual(answer.items.map((item) => item.remoteItem.id), ["SHARED!1", "SHARED!2"]);
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/me/drive/sharedWithMe");
});

test("refuses an id that is not a OneDrive id, without a request", async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.children("../x", "root", ""), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.item(DRIVE, "a/b", ""), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.item(DRIVE, "..", ""), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.downloadLocation(DRIVE, "a?b"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.download(DRIVE, "a#b", 10), { ok: false, reason: "not-found" });
  assert.equal(calls.length, 0);
});

// The domain's builders throw on an empty, `.` or `..` segment; the client answers, never rejects.
test("refuses a path with a dot or empty segment, without a request", async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.children(DRIVE, "root", "a/../b"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.children(DRIVE, "root", "./a"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.item(DRIVE, "root", "a//b"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.item(DRIVE, "root", ".."), { ok: false, reason: "not-found" });
  assert.equal(calls.length, 0);
});

test("an expired token is refreshed once and the request repeated", async () => {
  const { api, calls, tokenCalls } = setup({
    routes: [json(401, { error: { code: "InvalidAuthenticationToken" } }), json(200, { id: DRIVE })],
    tokens: [{ ok: true, token: "access-old" }, { ok: true, token: ACCESS }],
  });
  assert.deepEqual(await api.drive(), { ok: true, drive: { id: DRIVE } });
  assert.deepEqual(tokenCalls, [{}, { force: true }]);
  assert.equal(calls[1].authorization, `Bearer ${ACCESS}`);
});

test("a second 401 is not connected, and no third request is made", async () => {
  const { api, calls } = setup({ routes: [json(401, {}), json(401, {})] });
  assert.deepEqual(await api.drive(), { ok: false, reason: "not-connected" });
  assert.equal(calls.length, 2);
});

test("no token is not connected, with no request", async () => {
  const { api, calls } = setup({ tokens: [{ ok: false, reason: "not-connected" }] });
  assert.deepEqual(await api.drive(), { ok: false, reason: "not-connected" });
  assert.equal(calls.length, 0);
});

test("a rate limit waits what Retry-After asks, at most ten seconds, then retries once", async () => {
  const { api, slept } = setup({
    routes: [json(429, { error: { code: "activityLimitReached" } }, { "Retry-After": "60" }), json(200, { id: DRIVE })],
  });
  assert.deepEqual(await api.drive(), { ok: true, drive: { id: DRIVE } });
  assert.deepEqual(slept, [10_000]);
});

test("a 503 that does not clear is rate-limited after one wait", async () => {
  const { api, slept, calls } = setup({ routes: [json(503, {}, { "Retry-After": "2" }), json(503, {})] });
  assert.deepEqual(await api.drive(), { ok: false, reason: "rate-limited" });
  assert.deepEqual(slept, [2_000]);
  assert.equal(calls.length, 2);
});

test("Graph's refusals are named through oneDriveFailure", async () => {
  const { api } = setup({
    routes: [json(403, { error: { code: "accessDenied" } }), json(404, { error: { code: "itemNotFound" } }), json(400, { error: { code: "invalidRequest" } })],
  });
  assert.deepEqual(await api.item(DRIVE, "root", "Plan.md"), { ok: false, reason: "permission-denied" });
  assert.deepEqual(await api.item(DRIVE, "root", "Gone.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.children(DRIVE, "root", "x"), { ok: false, reason: "unknown" });
});

test("an answer in a shape this build does not know is offline, logged without the address", async () => {
  const { api, logs } = setup({ routes: [json(200, { value: "nope" })] });
  assert.deepEqual(await api.children(DRIVE, "root", "Notes"), { ok: false, reason: "offline" });
  assert.deepEqual(logs, ["OneDrive answered in a shape this build does not recognise."]);
});

test("an unreachable Graph is offline, logged by its code alone", async () => {
  const { api, logs } = setup({
    routes: [(url) => { throw Object.assign(new Error(`connect failed for ${url}`), { code: "ECONNRESET" }); }],
  });
  assert.deepEqual(await api.drive(), { ok: false, reason: "offline" });
  assert.deepEqual(logs, ["A request to OneDrive did not complete: ECONNRESET"]);
});

test("headers that never arrive answer offline, and the request is aborted", async () => {
  let aborted = false;
  const { api, logs } = setup({
    timeoutMs: 10,
    routes: [(url, init) => new Promise(() => init.signal.addEventListener("abort", () => (aborted = true)))],
  });
  assert.deepEqual(await api.drive(), { ok: false, reason: "offline" });
  assert.equal(aborted, true);
  assert.deepEqual(logs, ["A request to OneDrive did not complete: ETIMEDOUT"]);
});

// Measured with this repo's Electron: `net.fetch` in its default `follow` mode delivers the
// Authorization header to a redirect's target, and `redirect: "error"` rejects without contacting it.
// A 3xx check after the fact cannot help - follow mode has already sent the token - so every Graph
// request that carries the token through `fetch` refuses redirects up front.
test("every request carrying the token through fetch refuses redirects", async () => {
  const { api, calls } = setup({
    routes: [
      json(200, { id: DRIVE, driveType: "personal" }),
      json(401, {}),
      json(200, PLAN),
      json(200, { value: [PLAN], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next-page" }),
      json(200, { value: [ARCHIVE] }),
      json(200, { value: [] }),
    ],
    tokens: [{ ok: true, token: ACCESS }],
  });
  await api.drive();
  await api.item(DRIVE, "root", "Plan.md");
  await api.children(DRIVE, "root", "Notes");
  await api.sharedWithMe();
  const bearing = calls.filter((call) => call.via === "fetch" && call.authorization !== null);
  assert.equal(bearing.length, 6);
  for (const call of bearing) assert.equal(call.init.redirect, "error", call.url);
});

test("a redirect on a Graph JSON request is unknown, and is not followed", async () => {
  const { api, calls } = setup({ routes: [redirect("https://elsewhere.invented.example/x")] });
  assert.deepEqual(await api.drive(), { ok: false, reason: "unknown" });
  assert.equal(calls.length, 1);
});

test("a redirect refused by the fetch itself is offline", async () => {
  const { api, logs } = setup({
    routes: [() => { throw new TypeError("Attempted to redirect, but redirect policy was 'error'"); }],
  });
  assert.deepEqual(await api.drive(), { ok: false, reason: "offline" });
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes("elsewhere"));
});

// The spec: the 302 is never followed with the Authorization header. `/content` goes through the
// fetch that never follows a redirect, and is told nothing about redirects itself.
test("the download address is the 302's, asked for through the fetch that never follows it", async () => {
  const { api, calls } = setup({ manualRoutes: [redirect()] });
  assert.deepEqual(await api.downloadLocation(DRIVE, "ITEM!1"), { ok: true, url: PRESIGNED });
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/ITEM!1/content");
  assert.equal(calls[0].via, "manual");
  assert.equal("redirect" in calls[0].init, false);
  assert.equal(calls[0].authorization, `Bearer ${ACCESS}`);
});

test("/content is never requested through the fetch that follows redirects", async () => {
  const { api, calls } = setup({
    manualRoutes: [json(401, {}), redirect(), redirect()],
    routes: [new Response("hello", { status: 200 })],
    tokens: [{ ok: true, token: "access-old" }, { ok: true, token: ACCESS }],
  });
  assert.equal((await api.downloadLocation(DRIVE, "ITEM!1")).ok, true);
  assert.equal((await api.download(DRIVE, "ITEM!1", 100)).ok, true);
  const content = calls.filter((call) => call.url.endsWith("/content"));
  assert.equal(content.length, 3);
  assert.ok(content.every((call) => call.via === "manual"));
  assert.ok(calls.filter((call) => call.via === "fetch").every((call) => call.url === PRESIGNED));
});

// A build that forgot to wire the manual fetch fails loudly, never by following the redirect.
test("with no manual fetch wired, a download address is offline and nothing is fetched", async () => {
  const { api, calls, logs } = setup({ withoutManual: true });
  assert.deepEqual(await api.downloadLocation(DRIVE, "ITEM!1"), { ok: false, reason: "offline" });
  assert.equal(calls.length, 0);
  assert.deepEqual(logs, ["A request to OneDrive did not complete: ENOMANUAL"]);
});

test("a download answer with no address, or one that is not https, is refused", async () => {
  const { api } = setup({ manualRoutes: [redirect("http://download.invented.example/x"), new Response("bytes", { status: 200 })] });
  assert.deepEqual(await api.downloadLocation(DRIVE, "ITEM!1"), { ok: false, reason: "unknown" });
  assert.deepEqual(await api.downloadLocation(DRIVE, "ITEM!1"), { ok: false, reason: "unknown" });
});

test("downloads from the pre-authenticated address with no token on the request", async () => {
  const { api, calls } = setup({ manualRoutes: [redirect()], routes: [new Response("hello", { status: 200 })] });
  const answer = await api.download(DRIVE, "ITEM!1", 100);
  assert.equal(answer.ok, true);
  assert.equal(answer.bytes.toString("utf8"), "hello");
  assert.equal(calls[1].url, PRESIGNED);
  assert.equal(calls[1].via, "fetch");
  assert.equal(calls[1].authorization, null);
  assert.equal("Authorization" in calls[1].init.headers, false);
});

test("a download over the limit is too large, by the length it declares or by what arrives", async () => {
  const { api } = setup({
    manualRoutes: [redirect(), redirect()],
    routes: [new Response("hello", { status: 200, headers: { "Content-Length": "5" } }), new Response("hello", { status: 200 })],
  });
  assert.deepEqual(await api.download(DRIVE, "ITEM!1", 4), { ok: false, reason: "too-large", sizeBytes: 5, limitBytes: 4 });
  assert.deepEqual(await api.download(DRIVE, "ITEM!1", 4), { ok: false, reason: "too-large", sizeBytes: 5, limitBytes: 4 });
});

test("a range is asked of the address with no token, and a 206 for exactly that range is accepted", async () => {
  const { api, calls } = setup({ routes: [new Response("56789", { status: 206, headers: { "Content-Range": "bytes 5-9/20" } })] });
  const range = await api.rangeFrom(PRESIGNED, 5, 9);
  assert.equal(range.ok, true);
  assert.equal(range.status, 206);
  assert.equal(await new Response(range.body).text(), "56789");
  assert.equal(calls[0].init.headers.Range, "bytes=5-9");
  assert.equal(calls[0].authorization, null);
});

test("a 206 for other bytes than were asked is refused, and its body released", async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const { api } = setup({ routes: [new Response(body, { status: 206, headers: { "Content-Range": "bytes 0-4/20" } })] });
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 5, 9), { ok: false, reason: "offline" });
  assert.equal(cancelled, true);
});

test("a 200 answers a range only from the start", async () => {
  const { api } = setup({ routes: [new Response("0123456789", { status: 200 }), new Response("0123456789", { status: 200 })] });
  const whole = await api.rangeFrom(PRESIGNED, 0, 9);
  assert.equal(whole.ok, true);
  assert.equal(whole.status, 200);
  await whole.body.cancel();
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 5, 9), { ok: false, reason: "offline" });
});

test("a refused address has expired; a range past the end is unsatisfiable", async () => {
  const { api } = setup({ routes: [new Response(null, { status: 403 }), new Response(null, { status: 401 }), new Response(null, { status: 416 })] });
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 0, 1), { ok: false, reason: "expired" });
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 0, 1), { ok: false, reason: "expired" });
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 90, 99), { ok: false, reason: "unsatisfiable" });
});

test("an address that is not https is never fetched", async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.rangeFrom("http://download.invented.example/x", 0, 1), { ok: false, reason: "unknown" });
  assert.equal(calls.length, 0);
});

test("the deadline covers the headers only, not a body that arrives after it", async () => {
  const { api } = setup({
    timeoutMs: 20,
    routes: [
      (url, init) => {
        const body = new ReadableStream({
          start(controller) {
            init.signal.addEventListener("abort", () => controller.error(init.signal.reason));
            setTimeout(() => {
              try {
                controller.enqueue(new TextEncoder().encode("late"));
                controller.close();
              } catch {
                // Errored by an abort: the assertion below says so.
              }
            }, 60);
          },
        });
        return new Response(body, { status: 206, headers: { "Content-Range": "bytes 0-3/4" } });
      },
    ],
  });
  const range = await api.rangeFrom(PRESIGNED, 0, 3);
  assert.equal(range.ok, true);
  assert.equal(await new Response(range.body).text(), "late");
});

test("a range the window gives up on before its headers is aborted and answers at once", async () => {
  let fetchAborted = false;
  const controller = new AbortController();
  const { api } = setup({
    timeoutMs: 60_000,
    routes: [
      (url, init) =>
        new Promise((_, reject) =>
          init.signal.addEventListener("abort", () => {
            fetchAborted = true;
            reject(init.signal.reason);
          }),
        ),
    ],
  });
  const pending = api.rangeFrom(PRESIGNED, 0, 1, { signal: controller.signal });
  controller.abort();
  assert.deepEqual(await pending, { ok: false, reason: "offline" });
  assert.equal(fetchAborted, true);
});

test("a range asked for under a signal already aborted asks nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  const { api, calls } = setup();
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 0, 1, { signal: controller.signal }), { ok: false, reason: "offline" });
  assert.equal(calls.length, 0);
});

test("no log line holds an address, an id, a path, the token or an error's message", async () => {
  const fail = (url) => {
    throw Object.assign(new Error(`connect failed for ${url}`), { code: "ECONNRESET" });
  };
  const INSECURE = "http://insecure.example/ITEM!1";
  const FOREIGN = "https://elsewhere.example/Notes/next";
  const { api, logs } = setup({
    routes: [fail, fail, json(200, { value: [], "@odata.nextLink": FOREIGN })],
    manualRoutes: [redirect(INSECURE)],
  });
  await api.item(DRIVE, "ITEM!1", "Notes/Plan.md");
  await api.downloadLocation(DRIVE, "ITEM!1");
  await api.rangeFrom(PRESIGNED, 0, 1);
  await api.children(DRIVE, "root", "Notes");
  assert.equal(logs.length, 4);
  const text = logs.join(" ");
  for (const secret of [ACCESS, PRESIGNED, "ITEM!1", DRIVE, "Notes", INSECURE, FOREIGN, "connect failed"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.ok(text.includes("ECONNRESET"));
});

// ---- The writes (PR 3) ----

const { ONEDRIVE_UPLOAD_LIMIT_BYTES } = require("@trypthos/domain");

const headerNames = (call) => Object.keys(call.init.headers).map((name) => name.toLowerCase());

test("a save is one PUT by path with If-Match, answering the item as Graph now has it", async () => {
  const { api, calls } = setup({ routes: [json(200, { ...PLAN, cTag: "ctag-2" })] });
  const bytes = Buffer.from("new text");
  const answer = await api.writeContent(DRIVE, "root", "Notes/Plan.md", bytes, "ctag-1");
  assert.equal(answer.ok, true);
  assert.equal(answer.item.cTag, "ctag-2");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes/Plan.md:/content");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.headers["If-Match"], "ctag-1");
  assert.equal(calls[0].init.headers["Content-Type"], "application/octet-stream");
  assert.equal(calls[0].init.body, bytes);
  assert.equal(calls[0].authorization, `Bearer ${ACCESS}`);
});

test("a stale content tag is a conflict, asked once", async () => {
  const { api, calls } = setup({ routes: [json(412, { error: { code: "resourceModified" } })] });
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-old"), { ok: false, reason: "conflict" });
  assert.equal(calls.length, 1);
});

// The spike: `If-None-Match: *` was ignored and overwrote a file. A create fails on a taken name by
// the query, and carries neither conditional header.
test("a create PUTs by path asking Graph to fail on a taken name, with no If-None-Match and no If-Match", async () => {
  const { api, calls } = setup({ routes: [json(201, { ...PLAN, id: "ITEM!9", cTag: "ctag-new" })] });
  const answer = await api.createContent(DRIVE, "root", "Notes/New.md", Buffer.from("made"));
  assert.equal(answer.ok, true);
  assert.equal(answer.item.cTag, "ctag-new");
  assert.equal(
    calls[0].url,
    "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes/New.md:/content?@microsoft.graph.conflictBehavior=fail",
  );
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(headerNames(calls[0]).includes("if-none-match"), false);
  assert.equal(headerNames(calls[0]).includes("if-match"), false);
});

test("a name Graph says is taken is exists, asked once", async () => {
  const { api, calls } = setup({ routes: [json(409, { error: { code: "nameAlreadyExists" } })] });
  assert.deepEqual(await api.createContent(DRIVE, "root", "plan.MD", Buffer.from("x")), { ok: false, reason: "exists" });
  assert.equal(calls.length, 1);
});

test("New Folder POSTs to the parent's children, asking Graph to fail on a taken name", async () => {
  const { api, calls } = setup({ routes: [json(201, ARCHIVE), json(201, ARCHIVE)] });
  assert.equal((await api.createFolder(DRIVE, "root", "", "Archive")).ok, true);
  assert.equal((await api.createFolder(DRIVE, "root", "Notes", "Archive")).ok, true);
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root/children");
  assert.equal(calls[1].url, "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes:/children");
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(call.init.body), { name: "Archive", folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
  }
});

test("rename PATCHes the name alone, by path; a taken name is exists", async () => {
  const { api, calls } = setup({ routes: [json(200, { ...PLAN, name: "plan.md" }), json(409, { error: { code: "nameAlreadyExists" } })] });
  assert.equal((await api.rename(DRIVE, "root", "Notes/Plan.md", "plan.md")).ok, true);
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes/Plan.md:");
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: "plan.md" });
  assert.deepEqual(await api.rename(DRIVE, "root", "Notes/Plan.md", "Other.md"), { ok: false, reason: "exists" });
});

// The carry-over from PR 2's review: `send()` takes bodies now, and must not lose the redirect refusal
// on the way. Electron's net.fetch in `follow` mode hands the Authorization header to the redirect's
// target - and a body with it.
test("every write carries the token through fetch, refuses redirects, and never goes through the manual fetch", async () => {
  const { api, calls } = setup({ routes: [json(200, PLAN), json(201, PLAN), json(201, ARCHIVE), json(200, PLAN)] });
  await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1");
  await api.createContent(DRIVE, "root", "New.md", Buffer.from("x"));
  await api.createFolder(DRIVE, "root", "", "Archive");
  await api.rename(DRIVE, "root", "Plan.md", "plan.md");
  assert.deepEqual(calls.map((call) => call.init.method), ["PUT", "PUT", "POST", "PATCH"]);
  for (const call of calls) {
    assert.equal(call.via, "fetch", call.init.method);
    assert.equal(call.authorization, `Bearer ${ACCESS}`, call.init.method);
    assert.equal(call.init.redirect, "error", call.init.method);
  }
});

test("a redirect answering a write is unknown, and is not followed", async () => {
  const { api, calls } = setup({ routes: [redirect("https://elsewhere.invented.example/x")] });
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "unknown" });
  assert.equal(calls.length, 1);
});

// A 401 is refused before anything is processed, so the same request goes again - If-Match and all.
test("a write is repeated once after a 401, with a token refreshed for it", async () => {
  const { api, calls, tokenCalls } = setup({
    routes: [json(401, { error: { code: "InvalidAuthenticationToken" } }), json(200, PLAN)],
    tokens: [{ ok: true, token: "access-old" }, { ok: true, token: ACCESS }],
  });
  assert.equal((await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1")).ok, true);
  assert.deepEqual(tokenCalls, [{}, { force: true }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].authorization, `Bearer ${ACCESS}`);
  assert.equal(calls[1].init.headers["If-Match"], "ctag-1");
});

// A 429 with Retry-After says the request was not processed: one repeat is safe.
test("a write is repeated once after a 429, waiting what Retry-After asks, then rate-limited", async () => {
  const { api, calls, slept } = setup({
    routes: [json(429, {}, { "Retry-After": "3" }), json(201, PLAN), json(429, {}, { "Retry-After": "2" }), json(429, {})],
  });
  assert.equal((await api.createContent(DRIVE, "root", "New.md", Buffer.from("x"))).ok, true);
  assert.deepEqual(await api.createContent(DRIVE, "root", "Other.md", Buffer.from("x")), { ok: false, reason: "rate-limited" });
  assert.deepEqual(slept, [3_000, 2_000]);
  assert.equal(calls.length, 4);
});

// A 503 promises nothing about whether the write landed. Repeating a create that did would answer
// "exists"; repeating a save that did would answer "conflict" against its own write.
test("a write is never repeated after a 503: it may have landed", async () => {
  const { api, calls, slept } = setup({ routes: [json(503, {}, { "Retry-After": "1" }), json(503, {})] });
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", Buffer.from("x")), { ok: false, reason: "unknown" });
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "unknown" });
  assert.equal(calls.length, 2);
  assert.deepEqual(slept, []);
});

test("a write is never repeated after another 5xx or a network rejection", async () => {
  const reject = () => {
    throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
  };
  const { api, calls, slept } = setup({ routes: [json(500, {}), json(502, {}, { "Retry-After": "1" }), reject, reject] });
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "offline" });
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", Buffer.from("x")), { ok: false, reason: "offline" });
  assert.equal(calls.length, 2);
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "offline" });
  assert.deepEqual(await api.rename(DRIVE, "root", "Plan.md", "plan.md"), { ok: false, reason: "offline" });
  assert.equal(calls.length, 4);
  assert.deepEqual(slept, []);
});

test("a write whose answer never arrives is offline, and is never sent again", async () => {
  const { api, calls, logs } = setup({ timeoutMs: 10, routes: [() => new Promise(() => {})] });
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", Buffer.from("x")), { ok: false, reason: "offline" });
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, ["A request to OneDrive did not complete: ETIMEDOUT"]);
});

test("a body over four megabytes is too large with nothing sent, and a 413 names the sizes", async () => {
  const { api, calls } = setup({ routes: [json(413, {})] });
  const big = Buffer.alloc(ONEDRIVE_UPLOAD_LIMIT_BYTES + 1);
  const refused = { ok: false, reason: "too-large", sizeBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES + 1, limitBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES };
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", big, "ctag-1"), refused);
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", big), refused);
  assert.equal(calls.length, 0);
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", Buffer.from("abc")), {
    ok: false,
    reason: "too-large",
    sizeBytes: 3,
    limitBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES,
  });
});

// The carry-over from PR 2's review: the tag comes from the renderer, and goes into a header.
test("a content tag that is not one is bad-request, with nothing sent", async () => {
  const { api, calls } = setup();
  for (const tag of ["a\r\nX-Injected: 1", "", null, undefined, { id: "ctag-1" }]) {
    assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), tag), { ok: false, reason: "bad-request" }, String(tag));
  }
  assert.equal(calls.length, 0);
});

test("a write to an address that cannot be made is refused, with nothing sent", async () => {
  const { api, calls } = setup();
  for (const path of ["", "a/../b", "a//b", "."]) {
    assert.deepEqual(await api.writeContent(DRIVE, "root", path, Buffer.from("x"), "ctag-1"), { ok: false, reason: "not-found" }, path);
    assert.deepEqual(await api.createContent(DRIVE, "root", path, Buffer.from("x")), { ok: false, reason: "not-found" }, path);
    assert.deepEqual(await api.rename(DRIVE, "root", path, "x.md"), { ok: false, reason: "not-found" }, path);
  }
  assert.deepEqual(await api.createFolder(DRIVE, "root", "a//b", "x"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.createFolder(DRIVE, "root", "", ""), { ok: false, reason: "bad-request" });
  assert.deepEqual(await api.rename(DRIVE, "root", "Plan.md", ""), { ok: false, reason: "bad-request" });
  assert.deepEqual(await api.writeContent("../x", "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.createFolder(DRIVE, "a/b", "", "x"), { ok: false, reason: "not-found" });
  assert.equal(calls.length, 0);
});

test("Graph refusing a write: 403 permission-denied, 400 bad-request, 404 not-found, 500 offline", async () => {
  const { api } = setup({
    routes: [
      json(403, { error: { code: "accessDenied" } }),
      json(400, { error: { code: "invalidRequest" } }),
      json(404, { error: { code: "itemNotFound" } }),
      json(500, {}),
    ],
  });
  assert.deepEqual(await api.writeContent(DRIVE, "SHARED!7", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "permission-denied" });
  assert.deepEqual(await api.createFolder(DRIVE, "root", "", "bad:name"), { ok: false, reason: "bad-request" });
  assert.deepEqual(await api.rename(DRIVE, "root", "Gone.md", "x.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", Buffer.from("x")), { ok: false, reason: "offline" });
});

// The write landed; only what it made is not known. `offline` would invite a retry of a write that
// is already there.
test("an answer to a write in a shape this build does not know is unknown, logged without the address", async () => {
  const { api, logs } = setup({ routes: [json(200, { nope: true })] });
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "unknown" });
  assert.deepEqual(logs, ["OneDrive answered a write in a shape this build does not recognise."]);
});

// Pre-flight F3: a body that is not JSON at all is the same case - the write landed - and must not
// fall through to `offline`, which reads as "try again".
test("a write answered 200 with a body that is not JSON is unknown, and is not sent again", async () => {
  const { api, calls, logs } = setup({ routes: [new Response("<html>not json</html>", { status: 200 })] });
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "unknown" });
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, ["OneDrive answered a write in a shape this build does not recognise."]);
});

test("no write logs the token, a path, a name, the content tag or an error's message", async () => {
  const fail = (url, init) => {
    throw Object.assign(new Error(`connect failed for ${url} ${init.headers["If-Match"] ?? ""} ${init.body ?? ""}`), { code: "ECONNRESET" });
  };
  const { api, logs } = setup({ routes: [fail, fail, fail, fail, json(200, { nope: true })] });
  await api.writeContent(DRIVE, "root", "Secret/Plan.md", Buffer.from("private words"), "ctag-secret");
  await api.createContent(DRIVE, "root", "Secret/New.md", Buffer.from("private words"));
  await api.createFolder(DRIVE, "root", "Secret", "Hidden");
  await api.rename(DRIVE, "root", "Secret/Plan.md", "Renamed.md");
  await api.rename(DRIVE, "root", "Secret/Plan.md", "Renamed.md");
  assert.equal(logs.length, 5);
  const text = logs.join(" ");
  for (const secret of [ACCESS, DRIVE, "Secret", "Hidden", "Renamed", "ctag-secret", "private words", "connect failed"]) {
    assert.equal(text.includes(secret), false, secret);
  }
});
