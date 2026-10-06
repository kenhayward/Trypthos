"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mediaUrl } = require("@trypthos/domain");
const { createMediaHandler, MEDIA_SCHEME_PRIVILEGES } = require("../src/mediaProtocol");

/// The second route out of the shell, after IPC, and therefore the second place the workspace
/// boundary has to hold.
///
/// Most of this is about what the handler REFUSES. The success cases exist to prove the refusals
/// are not simply refusing everything, and to pin the headers a scrub bar depends on.
///
/// `locate` is injected, so none of this needs Electron, a window or an open workspace. What it
/// stands in for is the real locator in `ipcHandlers.js`, which applies the provider's guard - so
/// the assertion in the traversal test is that the handler does not serve those paths, never that
/// it resolves them itself. It must not resolve a path at all.

/// Twenty bytes, each identifiable by its position, so a wrong range is obvious rather than merely
/// the wrong length.
const BODY = Buffer.from("0123456789ABCDEFGHIJ");

/// A byte source over an in-memory buffer, as `locate` answers one. `opened` records every
/// `open(start, end)` so a test can assert what the handler asked for, not just what it returned.
function sourceOf(buffer, opened, failure = null, signals = []) {
  return {
    ok: true,
    size: buffer.length,
    open: async (start, end, signal) => {
      opened.push([start, end]);
      signals.push(signal);
      if (failure !== null) return { ok: false, reason: failure };
      return { ok: true, body: new Blob([buffer.subarray(start, end + 1)]).stream() };
    },
  };
}

async function withFile(body) {
  const opened = [];
  const signals = [];
  const locate = async (qualified) => {
    if (qualified === "Notes/clip.mp4") return sourceOf(BODY, opened, null, signals);
    if (qualified === "Notes/empty.mp4") return sourceOf(Buffer.alloc(0), opened);
    if (qualified === "Notes/denied.mp4") return sourceOf(BODY, opened, "permission-denied");
    if (qualified === "Notes/gone.mp4") return sourceOf(BODY, opened, "not-found");
    if (qualified === "Notes/offline.mp4") return sourceOf(BODY, opened, "offline");
    if (qualified === "Notes/shrunk.mp4") return sourceOf(BODY, opened, "unsatisfiable");
    if (qualified === "Notes/secret.mp4") return { ok: false, reason: "permission-denied" };
    if (qualified === "Repo/clip.mp4") return { ok: false, reason: "unsupported" };
    if (qualified === "Closed/clip.mp4") return { ok: false, reason: "no-workspace" };
    // A cloud listing walk can fail on the way to the file, for reasons that say nothing about it.
    for (const reason of ["offline", "rate-limited", "not-connected"]) {
      if (qualified === `Drive/${reason}.mp4`) return { ok: false, reason };
    }
    return { ok: false, reason: "not-found" };
  };

  await body({ handle: createMediaHandler({ locate }), opened, signals });
}

const get = (url, headers = {}) => new Request(url, { headers });

test("the scheme is privileged in the ways playback needs, and no others", () => {
  const { privileges } = MEDIA_SCHEME_PRIVILEGES;
  // `stream` is the one that matters for seeking: without it a media element cannot issue a Range
  // request against the scheme at all, and the scrub bar is dead however well ranges are served.
  assert.equal(privileges.stream, true);
  // And `standard` is the one that matters for playing AT ALL. Without it Chromium treats the
  // scheme's URLs as opaque and a media element refuses to load one - while `fetch` to the very
  // same URL succeeds and returns the right bytes, because the two take different code paths.
  // Found by playing a file in the real app; every assertion in this file passed without it.
  assert.equal(privileges.standard, true);
  assert.equal(privileges.supportFetchAPI, true);
  assert.equal(privileges.secure, true);
  // There is no CSP in the app today. Pinning this to false means adding one later is a policy
  // decision rather than a hole that was already open.
  assert.equal(privileges.bypassCSP, false);
});

test("serves a whole file when nothing asks for a range", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Notes/clip.mp4")));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "video/mp4");
    assert.equal(response.headers.get("Content-Length"), "20");
    // Without this a player will not even try to seek, however well ranges are served.
    assert.equal(response.headers.get("Accept-Ranges"), "bytes");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), BODY.toString());
  });
});

test("serves exactly the bytes a range asks for", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Notes/clip.mp4"), { Range: "bytes=10-14" }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 10-14/20");
    assert.equal(response.headers.get("Content-Length"), "5");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "ABCDE");
  });
});

// What a player actually sends first: an open-ended range from zero, to discover whether ranges
// work at all.
test("serves an open-ended range as the rest of the file", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Notes/clip.mp4"), { Range: "bytes=0-" }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 0-19/20");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), BODY.toString());
  });
});

test("answers 416 for a range past the end, never the start of the file", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Notes/clip.mp4"), { Range: "bytes=100-200" }));
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */20");
  });
});

test("serves an empty file without inventing a byte", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Notes/empty.mp4")));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Length"), "0");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });
});

test("refuses a name no media row claims, rather than guessing a type", async () => {
  await withFile(async ({ handle }) => {
    for (const name of ["Notes/clip.avi", "Notes/notes.md", "Notes/photo.png", "Notes/clip"]) {
      const response = await handle(get(mediaUrl(name)));
      assert.equal(response.status, 404, name);
    }
  });
});

test("refuses a workspace that is not open", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Elsewhere/clip.mp4")));
    assert.equal(response.status, 404);
  });
});

test("refuses a path that tries to leave the workspace", async () => {
  await withFile(async ({ handle }) => {
    for (const bad of [
      "Notes/../../outside.mp4",
      "Notes/..\\..\\outside.mp4",
      "Notes//server/share/clip.mp4",
      "Notes/C:/Windows/clip.mp4",
      "Notes/secret.mp4",
    ]) {
      const response = await handle(get(mediaUrl(bad)));
      assert.ok(response.status === 403 || response.status === 404, `${bad} gave ${response.status}`);
    }
  });
});

// A repository's blobs arrive base64 over an API with no ranges. The provider has no byte source,
// so this is refused by the same path everything else is.
test("refuses a workspace that cannot stream", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Repo/clip.mp4")));
    assert.equal(response.status, 404);
  });
});

test("refuses a workspace that has closed as missing", async () => {
  await withFile(async ({ handle }) => {
    assert.equal((await handle(get(mediaUrl("Closed/clip.mp4")))).status, 404);
  });
});

// A network problem on the way to the file is not a missing file: a player told 404 gives up on a
// clip that is still there.
test("a locate that failed for a reason other than the file answers 502, as an open would", async () => {
  await withFile(async ({ handle }) => {
    for (const reason of ["offline", "rate-limited", "not-connected"]) {
      const response = await handle(get(mediaUrl(`Drive/${reason}.mp4`)));
      assert.equal(response.status, 502, reason);
      assert.equal((await response.arrayBuffer()).byteLength, 0, reason);
    }
  });
});

// When the player abandons a range, the request behind it must be able to stop.
test("hands the window's request signal to the source's open", async () => {
  await withFile(async ({ handle, signals }) => {
    const ranged = get(mediaUrl("Notes/clip.mp4"), { Range: "bytes=0-4" });
    await (await handle(ranged)).arrayBuffer();
    const whole = get(mediaUrl("Notes/clip.mp4"));
    await (await handle(whole)).arrayBuffer();
    assert.deepEqual(signals, [ranged.signal, whole.signal]);
  });
});

test("refuses a URL that is not one of ours", async () => {
  await withFile(async ({ handle }) => {
    for (const url of ["tp-media://elsewhere/Notes%2Fclip.mp4", "tp-media://workspace/"]) {
      const response = await handle(get(url));
      assert.equal(response.status, 400, url);
    }
  });
});

// A refusal says nothing about why. The window already knows what it asked for, and the difference
// between "no such file" and "not allowed" is not a thing to spell out to the untrusted side.
test("a refusal carries no body", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Notes/nothing.mp4")));
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });
});

test("asks the source for exactly the inclusive range parseRange gave, and the whole file otherwise", async () => {
  await withFile(async ({ handle, opened }) => {
    await (await handle(get(mediaUrl("Notes/clip.mp4"), { Range: "bytes=10-14" }))).arrayBuffer();
    await (await handle(get(mediaUrl("Notes/clip.mp4"), { Range: "bytes=-4" }))).arrayBuffer();
    await (await handle(get(mediaUrl("Notes/clip.mp4")))).arrayBuffer();
    assert.deepEqual(opened, [
      [10, 14],
      [16, 19],
      [0, 19],
    ]);
  });
});

test("an empty file is never opened", async () => {
  await withFile(async ({ handle, opened }) => {
    const response = await handle(get(mediaUrl("Notes/empty.mp4")));
    assert.equal((await response.arrayBuffer()).byteLength, 0);
    assert.deepEqual(opened, []);
  });
});

test("a source that fails to open answers by its reason, with no body", async () => {
  await withFile(async ({ handle }) => {
    for (const [name, status] of [
      ["denied", 403],
      ["gone", 404],
      ["offline", 502],
    ]) {
      const response = await handle(get(mediaUrl(`Notes/${name}.mp4`), { Range: "bytes=0-4" }));
      assert.equal(response.status, status, name);
      assert.equal((await response.arrayBuffer()).byteLength, 0, name);
    }
  });
});

// The file shrank under a player that still believed the old size: Drive's 416 is the answer, and it
// carries the size the handler was told, so the player can see where the end is.
test("a source that answers unsatisfiable is a 416 with the size, not a 502", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Notes/shrunk.mp4"), { Range: "bytes=0-4" }));
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */20");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });
});
