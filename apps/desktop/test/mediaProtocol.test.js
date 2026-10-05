"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
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

async function withFile(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-media-"));
  const file = path.join(dir, "clip.mp4");
  await fs.writeFile(file, BODY);
  const empty = path.join(dir, "empty.mp4");
  await fs.writeFile(empty, Buffer.alloc(0));

  const locate = async (qualified) => {
    if (qualified === "Notes/clip.mp4") return { ok: true, path: file, size: BODY.length };
    if (qualified === "Notes/empty.mp4") return { ok: true, path: empty, size: 0 };
    if (qualified === "Notes/secret.mp4") return { ok: false, reason: "permission-denied" };
    if (qualified === "Repo/clip.mp4") return { ok: false, reason: "unsupported" };
    return { ok: false, reason: "not-found" };
  };

  try {
    await body({ handle: createMediaHandler({ locate }) });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const get = (url, headers = {}) => new Request(url, { headers });

test("the scheme is privileged in the ways playback needs, and no others", () => {
  const { privileges } = MEDIA_SCHEME_PRIVILEGES;
  // `stream` is the one that matters: without it a media element cannot issue a Range request
  // against the scheme at all, and the scrub bar is dead however well the handler serves ranges.
  assert.equal(privileges.stream, true);
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

// A repository's blobs arrive base64 over an API with no ranges. The provider has no `locateFile`,
// so this is refused by the same path everything else is.
test("refuses a workspace that cannot stream", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Repo/clip.mp4")));
    assert.equal(response.status, 404);
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
