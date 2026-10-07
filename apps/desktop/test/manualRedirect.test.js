"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createManualFetch } = require("../src/manualRedirect");

/// A fetch that never follows a redirect, over a `net.request`-shaped function, against a
/// hand-written fake. What is under test is what keeps the token off the redirect: the request is
/// made with `redirect: "manual"`, it is sent (`end()`), and it is aborted INSIDE the `redirect`
/// listener - Electron cancels the request once that listener returns, and aborting there is what
/// stops it contacting the target. A fake records all three.

const URL_ = "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/ITEM!1/content";
const PRESIGNED = "https://download.invented.example/presigned-manual-redirect";
const ACCESS = "access-invented-manual-redirect";

class FakeRequest extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.headers = {};
    this.ends = 0;
    this.aborts = 0;
    this.abortedInsideRedirect = null;
  }
  setHeader(name, value) {
    this.headers[name] = value;
  }
  end() {
    this.ends += 1;
  }
  abort() {
    this.aborts += 1;
  }
  /// Emits the redirect and records whether the listener aborted before it returned.
  redirect(status, location, headers = {}) {
    this.emit("redirect", status, "GET", location, headers);
    this.abortedInsideRedirect = this.aborts > 0;
  }
  respond(statusCode, headers, chunks = []) {
    const message = new EventEmitter();
    message.statusCode = statusCode;
    message.headers = headers;
    this.emit("response", message);
    for (const chunk of chunks) message.emit("data", Buffer.from(chunk));
    message.emit("end");
  }
}

function setup() {
  const made = [];
  const fetchManual = createManualFetch((options) => {
    const request = new FakeRequest(options);
    made.push(request);
    return request;
  });
  return { fetchManual, made };
}

const init = (extra = {}) => ({ method: "GET", headers: { Authorization: `Bearer ${ACCESS}` }, ...extra });

test("a redirect answers its status and location, aborted inside the listener, never followed", async () => {
  const { fetchManual, made } = setup();
  const pending = fetchManual(URL_, init());
  const request = made[0];
  request.redirect(302, PRESIGNED);
  const response = await pending;

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), PRESIGNED);
  assert.equal(response.headers.get("content-type"), null);
  assert.equal(response.body, null);
  assert.equal(await response.json(), null);

  assert.equal(request.options.url, URL_);
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.redirect, "manual");
  assert.equal(request.ends, 1);
  assert.equal(request.abortedInsideRedirect, true);
  assert.equal(request.aborts, 1);
});

test("the request's headers are set on it, the Authorization header included", async () => {
  const { fetchManual, made } = setup();
  const pending = fetchManual(URL_, init());
  made[0].redirect(302, PRESIGNED);
  await pending;
  assert.deepEqual(made[0].headers, { Authorization: `Bearer ${ACCESS}` });
});

test("an answer that is not a redirect resolves with its status, headers and body", async () => {
  const { fetchManual, made } = setup();
  const pending = fetchManual(URL_, init());
  made[0].respond(404, { "content-type": "application/json" }, ['{"error":{"code":', '"itemNotFound"}}']);
  const response = await pending;
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { error: { code: "itemNotFound" } });
  assert.equal(made[0].aborts, 0);
});

test("a header sent more than once is joined, as fetch joins it", async () => {
  const { fetchManual, made } = setup();
  const pending = fetchManual(URL_, init());
  made[0].respond(403, { "x-invented": ["one", "two"] }, ["no"]);
  const response = await pending;
  assert.equal(response.headers.get("x-invented"), "one, two");
  assert.equal(await response.text(), "no");
});

// `/content` answering 2xx is the file itself rather than an address: the caller refuses it without
// reading a byte, so the whole file is never buffered into memory.
test("a success answers at once with a null body, and the request is aborted", async () => {
  const { fetchManual, made } = setup();
  const pending = fetchManual(URL_, init());
  const message = new EventEmitter();
  message.statusCode = 200;
  message.headers = { "content-type": "text/markdown" };
  made[0].emit("response", message);
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/markdown");
  assert.equal(response.body, null);
  assert.equal(made[0].aborts, 1);
  // Bytes that still arrive are not collected, and a late error changes nothing.
  message.emit("data", Buffer.from("# Plan"));
  message.emit("error", new Error("late"));
  assert.equal(made[0].aborts, 1);
});

// An error body is read for Graph's error code, which is small; a body past 64 KB is not an error
// body worth holding, so collection stops there, the request is aborted, and what arrived is answered.
test("an error body is collected only up to 64 KB, then the request is aborted", async () => {
  const { fetchManual, made } = setup();
  const pending = fetchManual(URL_, init());
  const message = new EventEmitter();
  message.statusCode = 500;
  message.headers = {};
  made[0].emit("response", message);
  const kb = Buffer.alloc(1024, 0x61);
  for (let i = 0; i < 70; i += 1) message.emit("data", kb);
  const response = await pending;
  assert.equal(response.status, 500);
  assert.equal(made[0].aborts, 1);
  assert.equal((await response.arrayBuffer()).byteLength, 64 * 1024);
  message.emit("end");
  assert.equal(made[0].aborts, 1);
});

test("an error body of exactly 64 KB is answered whole, without an abort", async () => {
  const { fetchManual, made } = setup();
  const pending = fetchManual(URL_, init());
  made[0].respond(500, {}, [Buffer.alloc(64 * 1024, 0x62)]);
  const response = await pending;
  assert.equal((await response.arrayBuffer()).byteLength, 64 * 1024);
  assert.equal(made[0].aborts, 0);
});

test("a status that carries no body answers a null body rather than failing", async () => {
  for (const status of [204, 205, 304]) {
    const { fetchManual, made } = setup();
    const pending = fetchManual(URL_, init());
    made[0].respond(status, {});
    const response = await pending;
    assert.equal(response.status, status);
    assert.equal(response.body, null);
  }
});

test("an abort rejects as an AbortError and aborts the request", async () => {
  const { fetchManual, made } = setup();
  const controller = new AbortController();
  const pending = fetchManual(URL_, init({ signal: controller.signal }));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(made[0].aborts, 1);
});

test("a signal already aborted makes no request", async () => {
  const { fetchManual, made } = setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchManual(URL_, init({ signal: controller.signal })), { name: "AbortError" });
  assert.equal(made.length, 0);
});

test("a request that fails rejects with its error", async () => {
  const { fetchManual, made } = setup();
  const pending = fetchManual(URL_, init());
  made[0].emit("error", Object.assign(new Error("net::ERR_INVENTED"), { code: "ECONNRESET" }));
  await assert.rejects(pending, { code: "ECONNRESET" });
});

test("a response that fails while its body arrives rejects", async () => {
  const { fetchManual, made } = setup();
  const pending = fetchManual(URL_, init());
  const message = new EventEmitter();
  message.statusCode = 404;
  message.headers = {};
  made[0].emit("response", message);
  message.emit("error", Object.assign(new Error("cut"), { code: "ECONNRESET" }));
  await assert.rejects(pending, { code: "ECONNRESET" });
});
