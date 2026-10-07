"use strict";

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

module.exports = { createManualFetch };
