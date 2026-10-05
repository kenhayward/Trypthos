"use strict";

const { createReadStream } = require("node:fs");
const { Readable } = require("node:stream");
const { MEDIA_SCHEME, mediaPathFromUrl, mediaTypeFor } = require("@trypthos/domain");
const { parseRange } = require("./mediaRange");

/// Serving video and audio to the window.
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

/// The bytes, as a web stream the Response can take.
///
/// A stream rather than a buffer is the entire reason this feature has a protocol: memory stays
/// flat whether the file is four megabytes or four gigabytes. `createReadStream` takes an inclusive
/// `end`, which is the convention `parseRange` answers in, so no arithmetic happens here.
function streamOf(file, start, end) {
  // An empty file has no byte to read, and asking for `0-(-1)` is not a range any reader accepts.
  if (end < start) return new Blob([]).stream();
  return Readable.toWeb(createReadStream(file, { start, end }));
}

function createMediaHandler({ locate }) {
  return async function handle(request) {
    const qualified = mediaPathFromUrl(request.url);
    if (qualified === null) return refuse(400);

    // **Decided HERE, from the name.** A declared media type is an instruction to the engine about
    // how to read the bytes that follow, so it is never taken from the renderer - and a name no
    // catalogue row claims is refused rather than guessed at.
    const mediaType = mediaTypeFor(qualified);
    if (mediaType === null) return refuse(404);

    const found = await locate(qualified);
    if (!found.ok) return refuse(found.reason === "permission-denied" ? 403 : 404);

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
      return new Response(streamOf(found.path, 0, found.size - 1), {
        status: 200,
        headers: { ...headers, "Content-Length": String(found.size) },
      });
    }

    return new Response(streamOf(found.path, range.start, range.end), {
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
