"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_TEXT_FILE_BYTES } = require("@trypthos/domain");
const { openOneDriveWorkspace, GUARD_ROOT } = require("../src/oneDriveWorkspace");

/// A OneDrive folder as a workspace, over a fake OneDrive client.
///
/// OneDrive is addressed by path, so there is no id map to test. What is under test: the guard runs
/// before any request; a read's revision is the content tag asked for fresh; a listing is kept for its
/// TTL and dropped by refresh; media streams from a pre-authenticated address that is fetched again
/// once when it has expired; and an own-drive folder is never opened under
/// another account.

const MINE = "d0c0ffee";
const REF = { kind: "onedrive", driveId: MINE, itemId: "ROOT!0", name: "Notes then" };

/// The drive, by path below the workspace's root ("" is the root itself).
const TREE = {
  "": { id: "ROOT!0", name: "Notes now", folder: {}, webUrl: "https://onedrive.live.com/?id=ROOT!0" },
  "Plan.md": { id: "ITEM!1", name: "Plan.md", size: 5, cTag: "ctag-1", file: {}, webUrl: "https://onedrive.live.com/?id=ITEM!1" },
  Archive: { id: "ITEM!2", name: "Archive", folder: {} },
  "Archive/Old.md": { id: "ITEM!3", name: "Old.md", size: 3, cTag: "ctag-3", file: {} },
  "clip.mp4": { id: "ITEM!4", name: "clip.mp4", size: 10, cTag: "ctag-4", file: {} },
  "huge.md": { id: "ITEM!5", name: "huge.md", size: 17 * 1024 * 1024, cTag: "ctag-5", file: {} },
};

const BYTES = { "ITEM!1": Buffer.from("hello"), "ITEM!3": Buffer.from("old") };

function childrenOf(items, path) {
  const prefix = path === "" ? "" : `${path}/`;
  return Object.entries(items)
    .filter(([key]) => key !== "" && key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
    .map(([, item]) => ({ ...item }));
}

function fakeApi({ myDrive = MINE, items = TREE, rangeFrom = null, children = null } = {}) {
  const calls = [];
  /// The options each `rangeFrom` call was handed, in order: where the window's abort signal travels.
  const rangeOptions = [];
  let issued = 0;
  const api = {
    drive: async () => {
      calls.push(["drive"]);
      return { ok: true, drive: { id: myDrive } };
    },
    item: async (driveId, itemId, path) => {
      calls.push(["item", driveId, itemId, path]);
      return items[path] === undefined ? { ok: false, reason: "not-found" } : { ok: true, item: { ...items[path] } };
    },
    children: async (driveId, itemId, path) => {
      calls.push(["children", driveId, itemId, path]);
      if (children !== null) return children(driveId, itemId, path);
      return items[path]?.folder === undefined ? { ok: false, reason: "not-found" } : { ok: true, items: childrenOf(items, path) };
    },
    download: async (driveId, itemId, limitBytes) => {
      calls.push(["download", driveId, itemId, limitBytes]);
      return BYTES[itemId] === undefined ? { ok: false, reason: "not-found" } : { ok: true, bytes: BYTES[itemId] };
    },
    downloadLocation: async (driveId, itemId) => {
      calls.push(["location", driveId, itemId]);
      issued += 1;
      return { ok: true, url: `https://download.invented.example/${itemId}/${issued}` };
    },
    rangeFrom: async (url, start, end, options) => {
      calls.push(["range", url, start, end]);
      rangeOptions.push(options);
      if (rangeFrom !== null) return rangeFrom(url, start, end, options);
      return { ok: true, status: 206, body: new Response(Buffer.from("0123456789").subarray(start, end + 1)).body };
    },
  };
  return { api, calls, rangeOptions };
}

async function open({ ref = REF, now, ...options } = {}) {
  const { api, calls, rangeOptions } = fakeApi(options);
  const opened = await openOneDriveWorkspace({ ref, api, ...(now === undefined ? {} : { now }) });
  return { opened, provider: opened.ok ? opened.provider : null, calls, rangeOptions };
}

test("guards a root of its own, which exists nowhere", () => {
  assert.equal(GUARD_ROOT, "/onedrive");
});

test("opens an own-drive folder under its current name, having checked whose drive it is", async () => {
  const { opened, calls } = await open();
  assert.equal(opened.ok, true);
  assert.equal(opened.name, "Notes now");
  assert.equal(opened.provider.kind, "onedrive");
  assert.equal(opened.provider.id, "ROOT!0");
  assert.deepEqual(calls, [["drive"], ["item", MINE, "ROOT!0", ""]]);
});

test("opens My files under the name it was chosen by, since Graph calls the root 'root'", async () => {
  const { opened } = await open({
    ref: { kind: "onedrive", driveId: MINE, itemId: "root", name: "My files" },
    items: { ...TREE, "": { ...TREE[""], name: "root" } },
  });
  assert.equal(opened.name, "My files");
});

test("an own-drive folder is other-account under a different account, and nothing else is asked", async () => {
  const { opened, calls } = await open({ myDrive: "beefcafe" });
  assert.deepEqual(opened, { ok: false, reason: "other-account" });
  assert.deepEqual(calls, [["drive"]]);
});

test("compares the drive ids without regard to case", async () => {
  assert.equal((await open({ myDrive: "D0C0FFEE" })).opened.ok, true);
});

// Its driveId is someone else's by design.
test("a folder shared with the user is not checked against the connected drive", async () => {
  const { opened, calls } = await open({ ref: { ...REF, driveId: "beefcafe", shared: true } });
  assert.equal(opened.ok, true);
  assert.deepEqual(calls, [["item", "beefcafe", "ROOT!0", ""]]);
});

test("a root that is not a folder, or not there, does not open", async () => {
  assert.deepEqual((await open({ items: { ...TREE, "": { id: "ROOT!0", name: "x.md", file: {} } } })).opened, {
    ok: false,
    reason: "not-found",
  });
  assert.deepEqual((await open({ items: {} })).opened, { ok: false, reason: "not-found" });
});

test("a failure asking whose drive it is is passed on", async () => {
  const { api } = fakeApi();
  api.drive = async () => ({ ok: false, reason: "offline" });
  assert.deepEqual(await openOneDriveWorkspace({ ref: REF, api }), { ok: false, reason: "offline" });
});

test("lists the root and a folder by path, folders first, then names whatever the case", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.list(""), {
    ok: true,
    nodes: [
      { id: "Archive", name: "Archive", kind: "directory" },
      { id: "clip.mp4", name: "clip.mp4", kind: "file" },
      { id: "huge.md", name: "huge.md", kind: "file" },
      { id: "Plan.md", name: "Plan.md", kind: "file" },
    ],
  });
  assert.deepEqual(await provider.list("Archive"), { ok: true, nodes: [{ id: "Archive/Old.md", name: "Old.md", kind: "file" }] });
  assert.deepEqual(
    calls.filter((call) => call[0] === "children"),
    [
      ["children", MINE, "ROOT!0", ""],
      ["children", MINE, "ROOT!0", "Archive"],
    ],
  );
});

test("keeps a listing for its TTL, asks again after it, and refresh drops it", async () => {
  let clock = 0;
  const { provider, calls } = await open({ now: () => clock });
  const listings = () => calls.filter((call) => call[0] === "children").length;
  await provider.list("");
  await provider.list("");
  assert.equal(listings(), 1);
  clock += 61_000;
  await provider.list("");
  assert.equal(listings(), 2);
  assert.deepEqual(await provider.refresh(), { ok: true, truncated: false });
  await provider.list("");
  assert.equal(listings(), 3);
});

test("two walks of one folder at once ask OneDrive once", async () => {
  const { provider, calls } = await open();
  await Promise.all([provider.list("Archive"), provider.list("Archive")]);
  assert.equal(calls.filter((call) => call[0] === "children").length, 1);
});

test("answers what is already listed without asking, and says when a folder never was", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.listKnown(""), { ok: true, nodes: [], complete: false });
  await provider.list("");
  const before = calls.length;
  const known = await provider.listKnown("");
  assert.equal(known.complete, true);
  assert.equal(known.nodes.length, 4);
  assert.equal(calls.length, before);
  await provider.refresh();
  assert.deepEqual(await provider.listKnown(""), { ok: true, nodes: [], complete: false });
});

// The workspace boundary. Every escape is refused by the shared guard before any request is made.
test("refuses a path that leaves the workspace, before asking OneDrive anything", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  for (const escape of ["../outside.md", "Archive/../../outside.md", "/etc/passwd", "C:/Windows/win.ini", "C:outside.md", "\\\\server\\share\\x.md"]) {
    for (const answer of [
      provider.list(escape),
      provider.listKnown(escape),
      provider.read(escape),
      provider.readBytes(escape, 10),
      provider.mediaSource(escape),
      provider.webAddress(escape),
    ]) {
      assert.deepEqual(await answer, { ok: false, reason: "permission-denied" }, escape);
    }
  }
  assert.equal(calls.length, before);
});

test("refuses a backslash traversal that is not UNC, and a blank path, before asking OneDrive anything", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  for (const refused of ["Archive\\..\\..\\x.md", "  "]) {
    for (const answer of [provider.list(refused), provider.read(refused), provider.readBytes(refused, 10), provider.webAddress(refused)]) {
      assert.deepEqual(await answer, { ok: false, reason: "permission-denied" }, JSON.stringify(refused));
    }
  }
  assert.equal(calls.length, before);
});

test("a path that stays inside is asked for by its normalised form", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  assert.equal((await provider.read("./Plan.md")).ok, true);
  assert.equal((await provider.readBytes("Archive//Old.md", 10)).ok, true);
  assert.deepEqual(
    calls.slice(before).filter((call) => call[0] === "item"),
    [
      ["item", MINE, "ROOT!0", "Plan.md"],
      ["item", MINE, "ROOT!0", "Archive/Old.md"],
    ],
  );
});

test("a failed listing is not kept: the next list asks again", async () => {
  let failing = true;
  const children = async (driveId, itemId, path) => (failing ? { ok: false, reason: "offline" } : { ok: true, items: childrenOf(TREE, path) });
  const { provider, calls } = await open({ children });
  assert.deepEqual(await provider.list(""), { ok: false, reason: "offline" });
  failing = false;
  assert.equal((await provider.list("")).ok, true);
  assert.equal(calls.filter((call) => call[0] === "children").length, 2);
});

test("reads a file to be edited, its revision the content tag asked for before the bytes", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  assert.deepEqual(await provider.read("Plan.md"), { ok: true, content: "hello", revision: { id: "ctag-1" } });
  assert.deepEqual(calls.slice(before), [
    ["item", MINE, "ROOT!0", "Plan.md"],
    ["download", MINE, "ITEM!1", MAX_TEXT_FILE_BYTES],
  ]);
});

test("a folder is not a file, a missing file is not found, and a file with no content tag is not read", async () => {
  const { provider } = await open({ items: { ...TREE, "untagged.md": { id: "ITEM!9", name: "untagged.md", size: 1, file: {} } } });
  assert.deepEqual(await provider.read("Archive"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.read("Missing.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.read("untagged.md"), { ok: false, reason: "unknown" });
  assert.deepEqual(await provider.read(""), { ok: false, reason: "permission-denied" });
});

test("a file larger than a text file may be is refused by its size, with nothing downloaded", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.read("huge.md"), {
    ok: false,
    reason: "too-large",
    sizeBytes: 17 * 1024 * 1024,
    limitBytes: MAX_TEXT_FILE_BYTES,
  });
  assert.equal(calls.some((call) => call[0] === "download"), false);
});

test("reads a file's bytes under the limit it is given", async () => {
  const { provider } = await open();
  const read = await provider.readBytes("Archive/Old.md", 10);
  assert.equal(read.ok, true);
  assert.equal(read.bytes.toString("utf8"), "old");
  assert.deepEqual(await provider.readBytes("Plan.md", 2), { ok: false, reason: "too-large", sizeBytes: 5, limitBytes: 2 });
});

test("streams a clip in ranges from one pre-authenticated address, its size from the listing", async () => {
  const { provider, calls } = await open();
  const media = await provider.mediaSource("clip.mp4");
  assert.equal(media.ok, true);
  assert.equal(media.size, 10);
  assert.equal(await new Response((await media.open(5, 9)).body).text(), "56789");
  assert.equal(await new Response((await media.open(0, 1)).body).text(), "01");
  assert.deepEqual(calls.filter((call) => call[0] === "location"), [["location", MINE, "ITEM!4"]]);
});

test("an expired address is fetched again once, and a second refusal is permission-denied", async () => {
  let refusals = 1;
  const rangeFrom = async (url, start, end) => {
    if (refusals > 0) {
      refusals -= 1;
      return { ok: false, reason: "expired" };
    }
    return { ok: true, status: 206, body: new Response(Buffer.from("0123456789").subarray(start, end + 1)).body };
  };
  const { provider, calls } = await open({ rangeFrom });
  const media = await provider.mediaSource("clip.mp4");
  assert.equal(await new Response((await media.open(2, 3)).body).text(), "23");
  assert.equal(calls.filter((call) => call[0] === "location").length, 2);

  refusals = 2;
  assert.deepEqual(await media.open(2, 3), { ok: false, reason: "permission-denied" });
  assert.equal(calls.filter((call) => call[0] === "location").length, 3);
});

test("the window's abort signal reaches the first range and the retry after an expired address", async () => {
  let refusals = 1;
  const rangeFrom = async (url, start, end) => {
    if (refusals > 0) {
      refusals -= 1;
      return { ok: false, reason: "expired" };
    }
    return { ok: true, status: 206, body: new Response(Buffer.from("0123456789").subarray(start, end + 1)).body };
  };
  const { provider, rangeOptions } = await open({ rangeFrom });
  const media = await provider.mediaSource("clip.mp4");
  const { signal } = new AbortController();
  assert.equal(await new Response((await media.open(2, 3, signal)).body).text(), "23");
  assert.equal(rangeOptions.length, 2);
  assert.equal(rangeOptions[0].signal, signal);
  assert.equal(rangeOptions[1].signal, signal);
});

test("a range abandoned while its address expired asks for no new address, and answers as an abort does", async () => {
  const controller = new AbortController();
  const rangeFrom = async () => {
    controller.abort();
    return { ok: false, reason: "expired" };
  };
  const { provider, calls } = await open({ rangeFrom });
  const media = await provider.mediaSource("clip.mp4");
  assert.deepEqual(await media.open(2, 3, controller.signal), { ok: false, reason: "offline" });
  assert.equal(calls.filter((call) => call[0] === "location").length, 1);
  assert.equal(calls.filter((call) => call[0] === "range").length, 1);
});

test("a whole-file answer is accepted only for a whole-file range", async () => {
  const rangeFrom = async () => ({ ok: true, status: 200, body: new Response(Buffer.from("0123456789")).body });
  const { provider } = await open({ rangeFrom });
  const media = await provider.mediaSource("clip.mp4");
  assert.deepEqual(await media.open(0, 4), { ok: false, reason: "offline" });
  // Ends at the last byte but does not start at the first: a 200 here is the wrong bytes.
  assert.deepEqual(await media.open(3, 9), { ok: false, reason: "offline" });
  assert.equal(await new Response((await media.open(0, 9)).body).text(), "0123456789");
});

test("a folder, a missing file or a file with no size has no media source", async () => {
  const { provider } = await open({ items: { ...TREE, "unsized.mp4": { id: "ITEM!8", name: "unsized.mp4", file: {} } } });
  assert.deepEqual(await provider.mediaSource("Archive"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.mediaSource("gone.mp4"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.mediaSource("unsized.mp4"), { ok: false, reason: "not-found" });
});

test("refresh forgets the download addresses with the listings", async () => {
  const { provider, calls } = await open();
  await (await provider.mediaSource("clip.mp4")).open(0, 1);
  await provider.refresh();
  await (await provider.mediaSource("clip.mp4")).open(0, 1);
  assert.equal(calls.filter((call) => call[0] === "location").length, 2);
});

test("names an entry's page on the web, and the workspace's own, but never a non-https one", async () => {
  const { provider } = await open({ items: { ...TREE, "odd.md": { id: "ITEM!7", name: "odd.md", file: {}, webUrl: "javascript:alert(1)" } } });
  assert.deepEqual(await provider.webAddress(""), { ok: true, url: "https://onedrive.live.com/?id=ROOT!0" });
  assert.deepEqual(await provider.webAddress("Plan.md"), { ok: true, url: "https://onedrive.live.com/?id=ITEM!1" });
  assert.deepEqual(await provider.webAddress("odd.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.webAddress("gone.md"), { ok: false, reason: "not-found" });
});

// The address goes to openExternal, so only Microsoft's own hosts are named.
test("names a page on the web only at a Microsoft host, over https, with no user in it", async () => {
  const at = (webUrl) => ({ id: "ITEM!6", name: "web.md", file: {}, webUrl });
  for (const refused of [
    "https://evil.example/",
    "https://onedrive.live.com.evil.example/",
    "https://evilsharepoint.com/",
    "https://sharepoint.com.evil.example/",
    "https://user@onedrive.live.com/",
    "http://onedrive.live.com/",
  ]) {
    const { provider } = await open({ items: { ...TREE, "web.md": at(refused) } });
    assert.deepEqual(await provider.webAddress("web.md"), { ok: false, reason: "not-found" }, refused);
  }
  for (const accepted of [
    "https://onedrive.live.com/?id=ITEM!6",
    "https://contoso-my.sharepoint.com/personal/ada/Documents/web.md",
    "https://1drv.ms/t/s!invented",
  ]) {
    const { provider } = await open({ items: { ...TREE, "web.md": at(accepted) } });
    assert.deepEqual(await provider.webAddress("web.md"), { ok: true, url: accepted }, accepted);
  }
});

// OneDrive answers a path in any case. The tree, a wiki link, a restored tab and the chat can each name
// one folder in a different case, so a folder is cached once, under its folded spelling: a write into
// it, through whichever spelling, can then never leave a stale listing standing under another.
test("keeps one listing per folder, whatever case it is asked for in", async () => {
  const { provider, calls } = await open();
  await provider.list("Archive");
  assert.deepEqual(await provider.list("ARCHIVE"), { ok: true, nodes: [{ id: "ARCHIVE/Old.md", name: "Old.md", kind: "file" }] });
  assert.equal(calls.filter((call) => call[0] === "children").length, 1);
  const known = await provider.listKnown("archive");
  assert.equal(known.complete, true);
  assert.deepEqual(known.nodes, [{ id: "archive/Old.md", name: "Old.md", kind: "file" }]);
});

test("two walks of one folder in two spellings at once ask OneDrive once", async () => {
  const { provider, calls } = await open();
  await Promise.all([provider.list("Archive"), provider.list("archive")]);
  assert.equal(calls.filter((call) => call[0] === "children").length, 1);
});
