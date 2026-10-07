"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createSafeFetch } = require("../src/manualRedirect");

/// The fetch every token-carrying provider call goes through (issue #237), against a hand-written
/// `net.request`-shaped fake. `net.fetch` follows a redirect with the `Authorization` header on it,
/// to any host; this one applies the fetch spec's browser rules instead: a same-origin hop keeps the
/// header, a cross-origin hop is re-issued without it (or Cookie), and anything not https, past five
/// hops, or a body that would be resent to another origin answers a failure.

const API = "https://www.googleapis.com/drive/v3/files/INVENTED1?alt=media";
const SAME = "https://www.googleapis.com/drive/v3/files/INVENTED1/moved?alt=media";
const OTHER = "https://content.invented.example/presigned-safe-fetch";
const ACCESS = "access-invented-safe-fetch";

class FakeRequest extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.headers = {};
    this.ended = 0;
    this.sent = null;
    this.aborts = 0;
    this.followed = 0;
    this.abortedInsideRedirect = null;
  }
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }
  end(chunk) {
    this.ended += 1;
    if (chunk !== undefined) this.sent = Buffer.from(chunk);
  }
  abort() {
    this.aborts += 1;
  }
  followRedirect() {
    this.followed += 1;
  }
  redirect(status, location) {
    this.emit("redirect", status, "GET", location, {});
    this.abortedInsideRedirect = this.aborts > 0;
  }
  /// Answers with a live stream the test writes to and ends, as Electron's IncomingMessage is.
  respond(statusCode, headers = {}) {
    const message = new PassThrough();
    message.statusCode = statusCode;
    message.headers = headers;
    this.emit("response", message);
    return message;
  }
}

function setup() {
  const made = [];
  const fetch = createSafeFetch((options) => {
    const request = new FakeRequest(options);
    made.push(request);
    return request;
  });
  return { fetch, made };
}

const bearer = { Authorization: `Bearer ${ACCESS}` };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a request is made manual, carries its headers, and answers status, headers and body", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: { ...bearer, Range: "bytes=0-3" } });
  assert.equal(made.length, 1);
  assert.equal(made[0].options.url, API);
  assert.equal(made[0].options.method, "GET");
  assert.equal(made[0].options.redirect, "manual");
  assert.equal(made[0].headers.authorization, `Bearer ${ACCESS}`);
  assert.equal(made[0].headers.range, "bytes=0-3");
  assert.equal(made[0].ended, 1);
  const message = made[0].respond(206, { "content-range": "bytes 0-3/10", "x-invented": ["a", "b"] });
  message.end("abcd");
  const response = await pending;
  assert.equal(response.status, 206);
  assert.equal(response.ok, true);
  assert.equal(response.headers.get("content-range"), "bytes 0-3/10");
  assert.equal(response.headers.get("x-invented"), "a, b");
  assert.equal(await response.text(), "abcd");
});

test("a same-origin redirect is followed with the Authorization header kept", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  made[0].redirect(302, SAME);
  assert.equal(made[0].abortedInsideRedirect, true);
  assert.equal(made.length, 2);
  assert.equal(made[1].options.url, SAME);
  assert.equal(made[1].options.redirect, "manual");
  assert.equal(made[1].headers.authorization, `Bearer ${ACCESS}`);
  made[1].respond(200).end("ok");
  assert.equal(await (await pending).text(), "ok");
});

test("a cross-origin redirect is re-issued without Authorization or Cookie, the target never sent the token", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: { ...bearer, Cookie: "c=invented", Accept: "application/json" } });
  made[0].redirect(302, OTHER);
  // Aborted inside the listener: Electron would otherwise follow with every header on it.
  assert.equal(made[0].abortedInsideRedirect, true);
  assert.equal(made[0].followed, 0);
  assert.equal(made[1].options.url, OTHER);
  assert.equal(made[1].headers.authorization, undefined);
  assert.equal(made[1].headers.cookie, undefined);
  assert.equal(made[1].headers.accept, "application/json");
  made[1].respond(200).end("bytes");
  assert.equal(await (await pending).text(), "bytes");
});

test("once stripped the token stays stripped, even on a hop back to the first origin", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  made[0].redirect(302, OTHER);
  made[1].redirect(302, SAME);
  assert.equal(made[2].headers.authorization, undefined);
  made[2].respond(200).end();
  await pending;
});

test("a relative Location resolves against the address that answered it", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  made[0].redirect(301, "/drive/v3/elsewhere");
  assert.equal(made[1].options.url, "https://www.googleapis.com/drive/v3/elsewhere");
  assert.equal(made[1].headers.authorization, `Bearer ${ACCESS}`);
  made[1].respond(200).end();
  await pending;
});

test("a redirect to http is refused without contacting it", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  made[0].redirect(302, "http://content.invented.example/plain");
  await assert.rejects(pending, { code: "ERR_REDIRECT_INSECURE" });
  assert.equal(made.length, 1);
  assert.equal(made[0].aborts, 1);
});

test("a same-host redirect to http is refused too", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  made[0].redirect(302, "http://www.googleapis.com/drive/v3/files/INVENTED1");
  await assert.rejects(pending, { code: "ERR_REDIRECT_INSECURE" });
  assert.equal(made.length, 1);
});

test("five redirects are followed and a sixth is refused", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  for (let hop = 0; hop < 5; hop += 1) made[hop].redirect(302, `${SAME}&hop=${hop}`);
  assert.equal(made.length, 6);
  made[5].redirect(302, `${SAME}&hop=5`);
  await assert.rejects(pending, { code: "ERR_TOO_MANY_REDIRECTS" });
  assert.equal(made.length, 6);
  assert.equal(made[5].aborts, 1);
});

test("a 303 becomes a GET with no body and no body headers", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, {
    method: "PATCH",
    headers: { ...bearer, "Content-Type": "text/markdown" },
    body: "# Plan",
  });
  assert.equal(made[0].options.method, "PATCH");
  assert.equal(made[0].sent.toString(), "# Plan");
  made[0].redirect(303, OTHER);
  assert.equal(made[1].options.method, "GET");
  assert.equal(made[1].sent, null);
  assert.equal(made[1].headers["content-type"], undefined);
  assert.equal(made[1].headers.authorization, undefined);
  made[1].respond(200).end();
  await pending;
});

test("a 302 after a POST becomes a GET, as fetch does", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "a=1" });
  made[0].redirect(302, SAME);
  assert.equal(made[1].options.method, "GET");
  assert.equal(made[1].sent, null);
  made[1].respond(200).end();
  await pending;
});

test("a same-origin 307 resends the method and the body", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { method: "PATCH", headers: { ...bearer, "Content-Type": "text/markdown" }, body: Buffer.from("# Plan") });
  made[0].redirect(307, SAME);
  assert.equal(made[1].options.method, "PATCH");
  assert.equal(made[1].sent.toString(), "# Plan");
  assert.equal(made[1].headers["content-type"], "text/markdown");
  assert.equal(made[1].headers.authorization, `Bearer ${ACCESS}`);
  made[1].respond(200).end();
  await pending;
});

test("a cross-origin 307 or 308 with a body is refused rather than resending it", async () => {
  for (const status of [307, 308]) {
    const { fetch, made } = setup();
    const pending = fetch(API, { method: "POST", headers: bearer, body: "refresh_token=invented" });
    made[0].redirect(status, OTHER);
    await assert.rejects(pending, { code: "ERR_REDIRECT_BODY" });
    assert.equal(made.length, 1);
  }
});

test("a cross-origin 307 with no body is followed without the token", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  made[0].redirect(307, OTHER);
  assert.equal(made[1].options.method, "GET");
  assert.equal(made[1].headers.authorization, undefined);
  made[1].respond(200).end();
  await pending;
});

// Drive media ranges are played as they arrive: the answer resolves at the headers, and its body
// is a stream the caller reads chunk by chunk while the rest is still to come.
test("the body streams: the answer resolves before the body has ended, and chunks read as they arrive", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  const message = made[0].respond(206);
  const response = await pending;
  const reader = response.body.getReader();
  message.write(Buffer.from("first"));
  const first = await reader.read();
  assert.equal(Buffer.from(first.value).toString(), "first");
  assert.equal(message.writableEnded, false);
  message.end(Buffer.from("second"));
  const second = await reader.read();
  assert.equal(Buffer.from(second.value).toString(), "second");
  assert.equal((await reader.read()).done, true);
});

test("cancelling the body aborts the request", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  const message = made[0].respond(206);
  const response = await pending;
  message.write("part");
  await response.body.cancel();
  await tick();
  assert.equal(made[0].aborts, 1);
});

test("a status that carries no body answers a null body", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  made[0].respond(304).end();
  const response = await pending;
  assert.equal(response.status, 304);
  assert.equal(response.body, null);
});

test("an abort before the answer rejects with the signal's reason and aborts the request", async () => {
  const { fetch, made } = setup();
  const controller = new AbortController();
  const pending = fetch(API, { headers: bearer, signal: controller.signal });
  const reason = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
  controller.abort(reason);
  await assert.rejects(pending, { code: "ETIMEDOUT" });
  assert.equal(made[0].aborts, 1);
});

test("an abort while the body streams errors the body and aborts the request", async () => {
  const { fetch, made } = setup();
  const controller = new AbortController();
  const pending = fetch(API, { headers: bearer, signal: controller.signal });
  const message = made[0].respond(206);
  const response = await pending;
  message.write("part");
  controller.abort();
  await assert.rejects(response.arrayBuffer(), { name: "AbortError" });
  assert.equal(made[0].aborts, 1);
});

test("an abort during a redirect stops the request being re-issued", async () => {
  const { fetch, made } = setup();
  const controller = new AbortController();
  const pending = fetch(API, { headers: bearer, signal: controller.signal });
  made[0].redirect(302, SAME);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(made[1].aborts, 1);
});

test("a signal already aborted makes no request", async () => {
  const { fetch, made } = setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetch(API, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(made.length, 0);
});

test("a request that fails rejects with its error", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  made[0].emit("error", Object.assign(new Error("net::ERR_INVENTED"), { code: "ECONNRESET" }));
  await assert.rejects(pending, { code: "ECONNRESET" });
});

test("a late event from a request already redirected away from changes nothing", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  made[0].redirect(302, SAME);
  made[0].emit("error", new Error("aborted"));
  made[1].respond(200).end("ok");
  assert.equal(await (await pending).text(), "ok");
});

/// Asserted against `main.js` because that is the only place a client and its fetch are joined, and
/// no test loads it: every client takes whatever fetch it is handed, and every test hands it a fake.
/// OneDrive is deliberately absent - it has its own rules (`redirect: "error"` plus createManualFetch).
test("main.js builds every token-carrying client but OneDrive's on the safe fetch over net.request", () => {
  const main = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(main, /const providerFetch = createSafeFetch\(\(options\) => net\.request\(options\)\);/);
  for (const factory of ["createGoogleAuth", "createMicrosoftAuth", "createGitHubApi", "createGoogleDriveApi"]) {
    const calls = main.match(new RegExp(`${factory}\\(\\{[^}]*\\}\\)`, "g")) ?? [];
    assert.equal(calls.length, 1, `${factory} should be built once`);
    assert.match(calls[0], /fetch: providerFetch\b/, `${factory} must be given providerFetch`);
    assert.doesNotMatch(calls[0], /net\.fetch/, `${factory} must not be given net.fetch`);
  }
});

test("no refusal carries an address or a header in its message", async () => {
  const { fetch, made } = setup();
  const pending = fetch(API, { headers: bearer });
  made[0].redirect(302, "http://content.invented.example/plain");
  const error = await pending.catch((e) => e);
  assert.doesNotMatch(String(error.message), /invented|googleapis|Bearer/);
});
