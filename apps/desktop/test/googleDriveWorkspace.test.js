"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { openGoogleDriveWorkspace } = require("../src/googleDriveWorkspace");

/// A Drive folder as a workspace, over a fake Drive client.
///
/// Drive names files by id; the tree names them by path. What is under test is the map between the
/// two: filled as folders are listed, resolved on demand for a path nobody has listed yet, and
/// never allowed to reach outside the workspace.

const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";
const REF = { kind: "google-drive", folderId: "rootAAA", name: "Notes" };

const DRIVE = {
  rootAAA: [
    { id: "dirBBB", name: "Archive", mimeType: FOLDER },
    { id: "mdCCC", name: "Plan.md", mimeType: "text/markdown", size: "5", headRevisionId: "rev1" },
    { id: "docDDD", name: "Meeting", mimeType: DOC, modifiedTime: "2026-10-01T00:00:00Z" },
    { id: "pngEEE", name: "chart.png", mimeType: "image/png", size: "4" },
    { id: "bigFFF", name: "huge.md", mimeType: "text/markdown", size: String(17 * 1024 * 1024) },
  ],
  dirBBB: [{ id: "oldGGG", name: "Old.md", mimeType: "text/markdown", size: "3", headRevisionId: "rev2" }],
};

const BYTES = { mdCCC: Buffer.from("hello"), oldGGG: Buffer.from("old"), pngEEE: Buffer.from([1, 2, 3, 4]) };

function fakeApi(overrides = {}) {
  const calls = { list: [], download: [], export: [] };
  const api = {
    fileMeta: async (id) =>
      id === "rootAAA" ? { ok: true, file: { id, name: "Notes (renamed)", mimeType: FOLDER } } : { ok: false, reason: "not-found" },
    listChildren: async (id) => {
      calls.list.push(id);
      return DRIVE[id] === undefined ? { ok: false, reason: "not-found" } : { ok: true, files: DRIVE[id] };
    },
    download: async (id) => {
      calls.download.push(id);
      return BYTES[id] === undefined ? { ok: false, reason: "not-found" } : { ok: true, bytes: BYTES[id] };
    },
    exportMarkdown: async (id) => {
      calls.export.push(id);
      return { ok: true, bytes: Buffer.from("# Meeting") };
    },
    ...overrides,
  };
  return { api, calls };
}

async function open(overrides, options = {}) {
  const { api, calls } = fakeApi(overrides);
  const opened = await openGoogleDriveWorkspace({ ref: REF, api, ...options });
  assert.equal(opened.ok, true);
  return { provider: opened.provider, name: opened.name, calls };
}

test("opens a folder under its current name", async () => {
  const { name, provider } = await open();
  assert.equal(name, "Notes (renamed)");
  assert.equal(provider.kind, "google-drive");
});

test("refuses to open something that is not a folder, or is in the trash", async () => {
  for (const file of [
    { id: "rootAAA", name: "x.md", mimeType: "text/markdown" },
    { id: "rootAAA", name: "Notes", mimeType: FOLDER, trashed: true },
  ]) {
    const { api } = fakeApi({ fileMeta: async () => ({ ok: true, file }) });
    assert.deepEqual(await openGoogleDriveWorkspace({ ref: REF, api }), { ok: false, reason: "not-found" });
  }
});

test("passes on a failure to reach the folder", async () => {
  const { api } = fakeApi({ fileMeta: async () => ({ ok: false, reason: "not-connected" }) });
  assert.deepEqual(await openGoogleDriveWorkspace({ ref: REF, api }), { ok: false, reason: "not-connected" });
});

test("lists the root as tree nodes", async () => {
  const { provider } = await open();
  const listed = await provider.list("");
  assert.deepEqual(listed, {
    ok: true,
    nodes: [
      { id: "Archive", name: "Archive", kind: "directory" },
      { id: "chart.png", name: "chart.png", kind: "file" },
      { id: "huge.md", name: "huge.md", kind: "file" },
      { id: "Meeting.md", name: "Meeting.md", kind: "file" },
      { id: "Plan.md", name: "Plan.md", kind: "file" },
    ],
  });
});

test("lists a subfolder by the id its listing recorded", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  const listed = await provider.list("Archive");
  assert.deepEqual(listed.nodes, [{ id: "Archive/Old.md", name: "Old.md", kind: "file" }]);
  assert.deepEqual(calls.list, ["rootAAA", "dirBBB"]);
});

test("reads a file, with its head revision", async () => {
  const { provider } = await open();
  await provider.list("");
  assert.deepEqual(await provider.read("Plan.md"), { ok: true, content: "hello", revision: { id: "rev1" } });
});

test("reads a Google Doc as exported markdown", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  assert.deepEqual(await provider.read("Meeting.md"), {
    ok: true,
    content: "# Meeting",
    revision: { id: "modified:2026-10-01T00:00:00Z" },
  });
  assert.deepEqual(calls.export, ["docDDD"]);
  assert.deepEqual(calls.download, []);
});

// A tab restored at launch, or a link followed from another note, names a path whose folder has not
// been listed this session. The provider walks to it rather than calling it missing.
test("reads a path nobody has listed yet by listing its way there", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.read("Archive/Old.md"), { ok: true, content: "old", revision: { id: "rev2" } });
  assert.deepEqual(calls.list, ["rootAAA", "dirBBB"]);
});

test("a path that is not there is not found", async () => {
  const { provider } = await open();
  assert.deepEqual(await provider.read("Missing.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.read("Plan.md/inside"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.list("Plan.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.read("Archive"), { ok: false, reason: "not-found" });
});

test("a path outside the workspace is refused before Drive is asked", async () => {
  const { provider, calls } = await open();
  for (const escape of ["../x.md", "/etc/passwd", "C:\\x.md", "Archive/../../x.md"]) {
    assert.deepEqual(await provider.read(escape), { ok: false, reason: "permission-denied" });
  }
  assert.deepEqual(await provider.list("../"), { ok: false, reason: "permission-denied" });
  assert.deepEqual(calls.list, []);
});

test("a file over the limit is refused from its listed size, before downloading", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  const read = await provider.read("huge.md");
  assert.equal(read.ok, false);
  assert.equal(read.reason, "too-large");
  assert.equal(read.sizeBytes, 17 * 1024 * 1024);
  assert.deepEqual(calls.download, []);
});

test("reads the bytes of an image, within the caller's limit", async () => {
  const { provider } = await open();
  await provider.list("");
  const bytes = await provider.readBytes("chart.png", 1024);
  assert.equal(Buffer.isBuffer(bytes.bytes), true);
  assert.equal(bytes.bytes.length, 4);
  assert.equal((await provider.readBytes("chart.png", 2)).reason, "too-large");
});

test("writing is refused: this release opens Drive read-only", async () => {
  const { provider } = await open();
  await provider.list("");
  assert.deepEqual(await provider.write("Plan.md", "changed", { id: "rev1" }), { ok: false, reason: "read-only" });
});

// Re-expanding a folder without a refresh must replace only its own children, so what was learned
// about the folders below them (and any open file under them) stays readable.
test("re-listing a folder keeps what was learned about the folders under it", async () => {
  const { provider, calls } = await open({}, { ttlMs: 0 });
  await provider.list("");
  await provider.list("Archive");
  await provider.list("");
  assert.equal((await provider.read("Archive/Old.md")).ok, true);
  assert.deepEqual(calls.list, ["rootAAA", "dirBBB", "rootAAA"]);
});

test("re-listing drops a child that has gone", async () => {
  const { provider } = await open({
    listChildren: (() => {
      let first = true;
      return async (id) => {
        if (id !== "rootAAA") return { ok: true, files: [] };
        const files = first ? DRIVE.rootAAA : DRIVE.rootAAA.filter((file) => file.id !== "mdCCC");
        first = false;
        return { ok: true, files };
      };
    })(),
  }, { ttlMs: 0 });
  await provider.list("");
  await provider.list("");
  assert.deepEqual(await provider.read("Plan.md"), { ok: false, reason: "not-found" });
});

test("a folder replaced by a new one of the same name does not keep the old one's contents", async () => {
  const root = [
    [{ id: "dirBBB", name: "Archive", mimeType: FOLDER }],
    [{ id: "dirNEW", name: "Archive", mimeType: FOLDER }],
  ];
  let round = 0;
  const { provider, calls } = await open({
    listChildren: async (id) => {
      if (id === "rootAAA") return { ok: true, files: root[Math.min(round++, 1)] };
      if (id === "dirBBB") return { ok: true, files: DRIVE.dirBBB };
      return { ok: true, files: [] };
    },
  }, { ttlMs: 0 });
  await provider.list("");
  await provider.list("Archive");
  await provider.list("");
  assert.deepEqual(await provider.read("Archive/Old.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(calls.download, []);
});

test("a folder that has gone takes what was learned beneath it", async () => {
  let first = true;
  const { provider, calls } = await open({
    listChildren: async (id) => {
      if (id === "rootAAA") {
        const files = first ? [{ id: "dirBBB", name: "Archive", mimeType: FOLDER }] : [];
        first = false;
        return { ok: true, files };
      }
      return { ok: true, files: DRIVE.dirBBB };
    },
  }, { ttlMs: 0 });
  await provider.list("");
  await provider.list("Archive");
  await provider.list("");
  assert.deepEqual(await provider.read("Archive/Old.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(calls.download, []);
});

test("a Google Doc whose export is over the limit is refused after exporting", async () => {
  const { provider } = await open();
  await provider.list("");
  const read = await provider.readBytes("Meeting.md", 3);
  assert.equal(read.ok, false);
  assert.equal(read.reason, "too-large");
  assert.equal(read.sizeBytes, 9);
  assert.equal(read.limitBytes, 3);
});

test("refresh forgets every path, so the next read asks Drive again", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  assert.deepEqual(await provider.refresh(), { ok: true, truncated: false });
  await provider.read("Plan.md");
  assert.deepEqual(calls.list, ["rootAAA", "rootAAA"]);
});

test("a listing failure passes through", async () => {
  const { provider } = await open({ listChildren: async () => ({ ok: false, reason: "rate-limited" }) });
  assert.deepEqual(await provider.list(""), { ok: false, reason: "rate-limited" });
});

// Listing is a network request, and the filter, Find in Files and the chat's outline walk the tree
// through `list` - so each query would be a storm of requests without a short memory.
test("a second listing of a folder within the TTL does not ask Drive again", async () => {
  let clock = 1000;
  const { provider, calls } = await open({}, { now: () => clock, ttlMs: 60_000 });
  const first = await provider.list("");
  clock += 59_000;
  assert.deepEqual(await provider.list(""), first);
  assert.deepEqual(calls.list, ["rootAAA"]);
  // The cached answer still records paths, so a read resolves without another listing.
  assert.equal((await provider.read("Plan.md")).ok, true);
  assert.deepEqual(calls.list, ["rootAAA"]);
});

test("a listing older than the TTL is asked for again", async () => {
  let clock = 1000;
  const { provider, calls } = await open({}, { now: () => clock, ttlMs: 60_000 });
  await provider.list("");
  clock += 60_001;
  await provider.list("");
  assert.deepEqual(calls.list, ["rootAAA", "rootAAA"]);
});

test("refresh empties the listing cache as well as the paths", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  await provider.refresh();
  await provider.list("");
  assert.deepEqual(calls.list, ["rootAAA", "rootAAA"]);
});

test("concurrent reads of an unlisted path share one listing per ancestor", async () => {
  const { provider, calls } = await open();
  const [one, two] = await Promise.all([provider.read("Archive/Old.md"), provider.read("Archive/Old.md")]);
  assert.equal(one.ok, true);
  assert.equal(two.ok, true);
  assert.deepEqual(calls.list, ["rootAAA", "dirBBB"]);
});

test("a failed listing is not cached", async () => {
  let fail = true;
  const asked = [];
  const { provider } = await open({
    listChildren: async (id) => {
      asked.push(id);
      return fail ? { ok: false, reason: "offline" } : { ok: true, files: DRIVE.rootAAA };
    },
  });
  assert.deepEqual(await provider.list(""), { ok: false, reason: "offline" });
  fail = false;
  assert.equal((await provider.list("")).ok, true);
  assert.deepEqual(asked, ["rootAAA", "rootAAA"]);
});
