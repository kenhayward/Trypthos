"use strict";

const { MEDIA_SCHEME, mediaPathFromUrl, mediaTypeFor, pdfMediaTypeFor } = require("@trypthos/domain");
const { parseRange } = require("./mediaRange");

/// Serving video, audio and PDFs to the window.
///
/// The second route out of the shell, after IPC, and it exists because the first one cannot do this
/// job. A picture crosses IPC as a base64 data URL; a clip is a hundred times too large for that,
/// arrives as one string, and could not be seeked anyway - seeking is byte ranges, and a data URL
/// has none.
///
/// **What is NOT here matters as much as what is.** This module never resolves a path, never
/// touches a workspace root, and never decides whether a file may be read. It is handed a `locate`
/// function and does what that says - the same locator the IPC handlers use, so there is one
/// workspace boundary check in this app rather than two that could drift apart.
///
/// **Nor does it know where the bytes live.** `locate` answers a byte source - a size, and an
/// `open(start, end, signal)` for an inclusive range - so a file on disk and a file in a cloud drive are
/// served by the same code. What a source's token or path looks like never reaches this module, and
/// so never reaches the window.

/// Registered BEFORE app-ready, because a scheme's privileges are fixed once a page has loaded.
///
/// `stream` is the load-bearing one: without it a media element will not issue a Range request
/// against the scheme at all, and the scrub bar is dead however well the handler serves ranges.
const MEDIA_SCHEME_PRIVILEGES = {
  scheme: MEDIA_SCHEME,
  privileges: {
    // Without this the scheme's URLs are OPAQUE to Chromium - no host, no path - and a media
    // element refuses to load one even though `fetch` to the same URL succeeds and returns the
    // right bytes. The two take different code paths, which is why this was found by playing a
    // file rather than by any test: every assertion about the handler passed throughout.
    //
    // `corsEnabled` also depends on it.
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
    // There is no Content-Security-Policy in the app today, so this changes nothing now. Pinned so
    // that adding one later is a deliberate policy decision rather than a hole already open.
    bypassCSP: false,
  },
};

/// A refusal, with no body.
///
/// Deliberately uninformative. The window already knows what it asked for, and the difference
/// between "no such file" and "not allowed" is not something to spell out to the untrusted side.
function refuse(status, headers) {
  return new Response(null, { status, headers });
}

/// What a `locate` or an `open` that failed is told to the window as. Only the ones with a meaning to
/// a player get one; anything else is a bad gateway, because the bytes live somewhere that did not
/// answer. One mapping for both, because a cloud `locate` walks listings and can fail `offline` or
/// `rate-limited` on the way - a 404 for that would tell the player a clip that is still there is gone.
///
/// A workspace that has closed, or one that cannot stream (a repository), has nothing here to serve:
/// that is a 404, not a gateway that failed.
///
/// `unsatisfiable` is the source saying the range lies past the end it now has - the file shrank
/// under a player that still holds the old size - and carries the size, as any 416 must.
function refuseOpen(reason, size) {
  if (reason === "unsatisfiable") return refuse(416, { "Content-Range": `bytes */${size}` });
  if (reason === "permission-denied") return refuse(403);
  if (reason === "not-found" || reason === "no-workspace" || reason === "unsupported") return refuse(404);
  return refuse(502);
}

/// The bytes of one range, as a web stream the Response can take, or the refusal to send instead.
///
/// A stream rather than a buffer is the entire reason this feature has a protocol: memory stays
/// flat whether the file is four megabytes or four gigabytes. The range is inclusive, the convention
/// `parseRange` answers in, so no arithmetic happens here.
///
/// `signal` is the window's request's: when the player abandons the range, a source with a request
/// in flight (Drive) stops it rather than letting it run on for nobody.
async function bodyOf(found, start, end, signal) {
  // An empty file has no byte to read, and asking for `0-(-1)` is not a range any source accepts.
  if (end < start) return { body: new Blob([]).stream() };
  const opened = await found.open(start, end, signal);
  return opened.ok ? { body: opened.body } : { refusal: refuseOpen(opened.reason, found.size) };
}

function createMediaHandler({ locate }) {
  return async function handle(request) {
    const qualified = mediaPathFromUrl(request.url);
    if (qualified === null) return refuse(400);

    // **Decided HERE, from the name.** A declared media type is an instruction to the engine about
    // how to read the bytes that follow, so it is never taken from the renderer - and a name no
    // catalogue row claims is refused rather than guessed at. A PDF is claimed by its own row, and
    // the engine that reads it is chosen by the window, not by this header.
    const mediaType = mediaTypeFor(qualified) ?? pdfMediaTypeFor(qualified);
    if (mediaType === null) return refuse(404);

    const found = await locate(qualified);
    if (!found.ok) return refuseOpen(found.reason);

    const range = parseRange(request.headers.get("Range"), found.size);

    if (range !== null && range.unsatisfiable === true) {
      // 416 rather than 200. A player handed the start of a file it asked to seek past will sit
      // there showing nothing, with no error anywhere to explain why.
      return refuse(416, { "Content-Range": `bytes */${found.size}` });
    }

    // `Accept-Ranges` on every response, the whole-file one included: it is how the engine learns
    // it MAY seek, and it reads that before it has any reason to send a Range of its own.
    const headers = { "Content-Type": mediaType, "Accept-Ranges": "bytes" };

    if (range === null) {
      const whole = await bodyOf(found, 0, found.size - 1, request.signal);
      if (whole.refusal !== undefined) return whole.refusal;
      return new Response(whole.body, {
        status: 200,
        headers: { ...headers, "Content-Length": String(found.size) },
      });
    }

    const part = await bodyOf(found, range.start, range.end, request.signal);
    if (part.refusal !== undefined) return part.refusal;
    return new Response(part.body, {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(range.length),
        "Content-Range": `bytes ${range.start}-${range.end}/${found.size}`,
      },
    });
  };
}

module.exports = { MEDIA_SCHEME_PRIVILEGES, createMediaHandler };
