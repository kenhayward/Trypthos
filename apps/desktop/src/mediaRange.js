"use strict";

/// A `Range` header, as a position in a file of `size` bytes.
///
/// Three answers, because a range request has three outcomes and collapsing any two of them loses
/// the one the caller has to behave differently about:
///
///  - `null`                    - there is no range to honour. Send the whole file, 200.
///  - `{ unsatisfiable: true }` - the header asks for bytes that are not there. 416, not 200: a
///                                player handed the start of a file it asked to seek past will sit
///                                there silently, with nothing anywhere to explain why.
///  - `{ start, end, length }`  - serve exactly that, 206. Both ends INCLUSIVE.
///
/// Pure, and its own module, because every mistake available here is an off-by-one and they are all
/// invisible in ordinary playback. A video that only misbehaves when the scrub bar is dragged to
/// the last second is a bug nobody reports clearly.
function parseRange(header, size) {
  if (typeof header !== "string") return null;

  const trimmed = header.trim();
  if (trimmed === "") return null;

  // One range only. A comma means several, which this declines by answering "no range" - serving
  // the whole file is a legal response to a Range header, and serving a guess is not.
  const match = /^bytes=(\d*)-(\d*)$/.exec(trimmed);
  if (match === null) return null;

  const rawStart = match[1];
  const rawEnd = match[2];
  if (rawStart === "" && rawEnd === "") return null;

  // A suffix range: `bytes=-500` is the LAST 500 bytes. Reading it as "the first 500" serves the
  // wrong part of the file and looks, from the player, like nothing happened at all.
  if (rawStart === "") {
    const wanted = Number(rawEnd);
    if (wanted === 0 || size === 0) return { unsatisfiable: true };
    const start = Math.max(0, size - wanted);
    return { start, end: size - 1, length: size - start };
  }

  const start = Number(rawStart);
  if (start >= size) return { unsatisfiable: true };

  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return { unsatisfiable: true };

  return { start, end, length: end - start + 1 };
}

module.exports = { parseRange };
