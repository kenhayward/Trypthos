"use strict";

const { Readable } = require("node:stream");

/// A fetch that never follows a redirect, built over Electron's `net.request`.
///
/// Why it exists: Graph answers a file's `/content` with a 302 to a pre-authenticated address on
/// another host, and the shell must read that `Location` WITHOUT following it - a followed redirect
/// carries the `Authorization` header to the target. Measured with this repo's Electron:
/// `net.fetch(url, { redirect: "manual" })` throws "Redirect was cancelled", so the `Location` cannot
/// be read through it. `net.request({ url, redirect: "manual" })` emits `redirect` instead, and does
/// not contact the target when `abort()` is called inside that listener - Electron cancels the
/// request once the listener returns, so the abort cannot wait.
///
/// `request(options)` is `net.request`-shaped (injected, so this is testable without Electron).
/// Answers a 3xx as `{ status, headers: { get }, body: null, json }` whose only header is `Location`,
/// a 2xx as a `Response` with no body (aborted unread - the caller wants an address, not bytes), and
/// anything else as a `Response` over the collected body, cut at 64 KB with the request aborted. Errors and aborts reject; the caller
/// (`oneDriveApi.js`'s `deadlined`) turns a rejection into a result. Nothing here logs.

/// Statuses a `Response` refuses a body for.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/// The most of a non-success body collected. Graph's error bodies are a few hundred bytes.
const MAX_BODY_BYTES = 64 * 1024;

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

/// Electron's header values may be arrays; fetch joins a repeated header with ", ".
function headersOf(raw) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw ?? {})) {
    headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }
  return headers;
}

function createManualFetch(request) {
  return function fetchManual(url, init = {}) {
    return new Promise((resolve, reject) => {
      const signal = init.signal ?? null;
      if (signal?.aborted) {
        reject(abortError(signal));
        return;
      }

      let settled = false;
      let onAbort = null;
      const settle = (done, value) => {
        if (settled) return;
        settled = true;
        if (onAbort !== null) signal.removeEventListener("abort", onAbort);
        done(value);
      };

      let req;
      try {
        req = request({ method: init.method ?? "GET", url, redirect: "manual" });
        for (const [name, value] of Object.entries(init.headers ?? {})) req.setHeader(name, value);
      } catch (error) {
        settle(reject, error);
        return;
      }

      if (signal !== null) {
        onAbort = () => {
          if (settled) return;
          try {
            req.abort();
          } catch {
            // Already finished: the rejection below is the answer either way.
          }
          settle(reject, abortError(signal));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      req.on("redirect", (statusCode, _method, redirectUrl) => {
        // Inside the listener, before it returns: this is what stops the target being contacted.
        req.abort();
        settle(resolve, {
          status: statusCode,
          headers: { get: (name) => (String(name).toLowerCase() === "location" ? redirectUrl : null) },
          body: null,
          json: async () => null,
        });
      });

      req.on("response", (message) => {
        const status = message.statusCode;
        const answer = (body) => {
          try {
            settle(resolve, new Response(NULL_BODY_STATUSES.has(status) ? null : body, { status, headers: headersOf(message.headers) }));
          } catch (error) {
            settle(reject, error);
          }
        };
        const stop = () => {
          try {
            req.abort();
          } catch {
            // Already finished: the answer is settled either way.
          }
        };

        // A success here is the bytes themselves, not an address, and the caller refuses it unread:
        // answer at once with no body rather than buffer a whole file into memory.
        if (status >= 200 && status < 300) {
          // The abort may still surface on the message as an error; it is not an answer any more.
          message.on("error", () => {});
          stop();
          answer(null);
          return;
        }

        // Anything else is read for Graph's error code, which is small. Past the cap the rest is not
        // worth holding: stop collecting, abort, and answer what arrived.
        const chunks = [];
        let size = 0;
        message.on("data", (chunk) => {
          if (settled) return;
          const bytes = Buffer.from(chunk);
          const room = MAX_BODY_BYTES - size;
          if (bytes.length <= room) {
            chunks.push(bytes);
            size += bytes.length;
            return;
          }
          chunks.push(bytes.subarray(0, room));
          stop();
          answer(Buffer.concat(chunks));
        });
        message.on("error", (error) => settle(reject, error));
        message.on("end", () => answer(Buffer.concat(chunks)));
      });

      req.on("error", (error) => settle(reject, error));
      req.end();
    });
  };
}

/// The fetch every other token-carrying provider call goes through: Google Drive, GitHub, Google's
/// and Microsoft's sign-in clients (issue #237). Same `(url, init) => Promise<Response>` contract as
/// fetch, over the same `net.request`-shaped function.
///
/// Why it exists: `net.fetch` follows a redirect with every header still on it, the `Authorization`
/// header included, to whatever host the `Location` names (measured with this repo's Electron). This
/// applies the fetch spec's browser rules instead, one hop at a time:
///
/// - every hop is its own `net.request` with `redirect: "manual"`, aborted INSIDE the `redirect`
///   listener so Electron never follows it, then re-issued here with headers this module chose;
/// - a **same-origin** hop (scheme, host and port) keeps the headers; a **cross-origin** hop drops
///   `Authorization`, `Cookie` and `Proxy-Authorization`, and once dropped they stay dropped;
/// - a hop to anything but https, a sixth hop, or a body that would be resent to another origin
///   (a cross-origin 307/308, or a 301/302 that keeps its method) rejects without contacting it;
/// - a 303 (and a 301/302 after a POST) becomes a GET with no body and no body headers.
///
/// The answer is a `Response` over the IncomingMessage via `Readable.toWeb`, resolved at the
/// headers: a Drive media range streams rather than being buffered. The signal aborts the request at
/// any stage, the body included, and cancelling the body aborts the request. A refusal rejects with
/// a fixed message and a `code`; nothing here logs, and no error carries an address or a header.

/// Redirects followed before the next one is refused.
const MAX_REDIRECTS = 5;

/// What a cross-origin hop never carries.
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/// What describes a body, and goes when the body does.
const BODY_HEADERS = ["content-type", "content-length", "content-encoding", "content-language", "content-location"];

function refusal(code) {
  return Object.assign(new Error("The redirect was refused."), { code });
}

/// fetch rejects with the signal's own reason, so a deadline's code reaches the caller's log line.
function abortReason(signal) {
  return signal?.reason ?? abortError(signal);
}

/// The body as bytes, so it can be resent on a same-origin 307/308. The shapes the clients send.
function bodyBytes(body) {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (Buffer.isBuffer(body)) return body;
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw Object.assign(new TypeError("The request body is not a supported type."), { code: "ERR_UNSUPPORTED_BODY" });
}

/// The next hop, or a thrown refusal. `hop` is the request about to be redirected away from.
function nextHop(hop, status, location, redirects) {
  if (redirects >= MAX_REDIRECTS) throw refusal("ERR_TOO_MANY_REDIRECTS");
  let target;
  try {
    target = new URL(location, hop.url);
  } catch {
    throw refusal("ERR_REDIRECT_INVALID");
  }
  if (target.protocol !== "https:") throw refusal("ERR_REDIRECT_INSECURE");

  const sameOrigin = target.origin === hop.url.origin;
  const headers = new Headers(hop.headers);
  let { method, body } = hop;

  const toGet = (status === 303 && method !== "GET" && method !== "HEAD") || ((status === 301 || status === 302) && method === "POST");
  if (toGet) {
    method = "GET";
    body = null;
    for (const name of BODY_HEADERS) headers.delete(name);
  } else if (body !== null && !sameOrigin) {
    throw refusal("ERR_REDIRECT_BODY");
  }
  if (!sameOrigin) for (const name of CREDENTIAL_HEADERS) headers.delete(name);

  return { url: target, method, headers, body };
}

function createSafeFetch(request) {
  return function safeFetch(url, init = {}) {
    return new Promise((resolve, reject) => {
      const signal = init.signal ?? null;
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }

      let hop;
      try {
        const headers = new Headers(init.headers ?? {});
        if (init.body instanceof URLSearchParams && !headers.has("content-type")) {
          headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
        }
        hop = { url: new URL(url), method: String(init.method ?? "GET").toUpperCase(), headers, body: bodyBytes(init.body) };
      } catch (error) {
        reject(error);
        return;
      }

      // pending -> streaming (resolved, the body still arriving) -> done.
      let state = "pending";
      let current = null;
      let message = null;
      let redirects = 0;

      const stop = (req) => {
        try {
          req.abort();
        } catch {
          // Already finished: nothing left to stop.
        }
      };
      const done = () => {
        state = "done";
        message = null;
        signal?.removeEventListener("abort", onAbort);
      };
      const fail = (error) => {
        if (state === "pending") {
          if (current !== null) stop(current);
          done();
          reject(error);
        } else if (state === "streaming") {
          const streaming = message;
          stop(current);
          done();
          streaming.destroy(error);
        }
      };
      function onAbort() {
        fail(abortReason(signal));
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      const issue = () => {
        let req;
        try {
          req = request({ method: hop.method, url: hop.url.href, redirect: "manual" });
          current = req;
          for (const [name, value] of hop.headers) req.setHeader(name, value);
        } catch (error) {
          fail(error);
          return;
        }

        req.on("redirect", (status, _method, location) => {
          // Inside the listener, before it returns: Electron would otherwise follow it with every
          // header on it. Each hop is re-issued below with the headers chosen here.
          stop(req);
          if (req !== current || state !== "pending") return;
          // Stopped already: a refusal below has nothing more to abort.
          current = null;
          try {
            hop = nextHop(hop, status, location, redirects);
          } catch (error) {
            fail(error);
            return;
          }
          redirects += 1;
          issue();
        });

        req.on("response", (incoming) => {
          if (req !== current || state !== "pending") return;
          const status = incoming.statusCode;
          const empty = NULL_BODY_STATUSES.has(status) || hop.method === "HEAD";
          let response;
          try {
            response = new Response(empty ? null : Readable.toWeb(incoming), { status, headers: headersOf(incoming.headers) });
          } catch (error) {
            fail(error);
            return;
          }
          if (empty) {
            incoming.on("error", () => {});
            incoming.resume();
            done();
            resolve(response);
            return;
          }
          state = "streaming";
          message = incoming;
          let ended = false;
          incoming.on("end", () => {
            ended = true;
          });
          // A body cancelled or destroyed before its end leaves the request running: stop it.
          incoming.on("close", () => {
            if (state !== "streaming" || message !== incoming) return;
            if (!ended) stop(req);
            done();
          });
          resolve(response);
        });

        req.on("error", (error) => {
          if (req !== current) return;
          fail(error);
        });

        if (hop.body === null) req.end();
        else req.end(hop.body);
      };

      issue();
    });
  };
}

module.exports = { createManualFetch, createSafeFetch, MAX_REDIRECTS };
