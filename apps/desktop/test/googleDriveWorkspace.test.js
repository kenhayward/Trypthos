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

/// The metadata `fileMeta` answers for each file, as it is "in Drive" now. Each fake gets its own
/// copy, so a test can change a file's revision - or delete it - behind the provider's back.
const META = {
  rootAAA: { id: "rootAAA", name: "Notes (renamed)", mimeType: FOLDER },
  dirBBB: { id: "dirBBB", name: "Archive", mimeType: FOLDER },
  mdCCC: { id: "mdCCC", name: "Plan.md", mimeType: "text/markdown", headRevisionId: "rev1" },
  pngEEE: { id: "pngEEE", name: "chart.png", mimeType: "image/png", headRevisionId: "revPng" },
  bigFFF: { id: "bigFFF", name: "huge.md", mimeType: "text/markdown", headRevisionId: "revBig" },
  oldGGG: { id: "oldGGG", name: "Old.md", mimeType: "text/markdown", headRevisionId: "rev2" },
};

function fakeApi(overrides = {}) {
  const calls = { list: [], download: [], export: [], meta: [], upload: [], create: [], order: [] };
  const drive = Object.fromEntries(Object.entries(DRIVE).map(([id, files]) => [id, [...files]]));
  const meta = Object.fromEntries(Object.entries(META).map(([id, file]) => [id, { ...file }]));
  const bytes = { ...BYTES };
  let created = 0;
  const api = {
    fileMeta: async (id) => {
      calls.meta.push(id);
      calls.order.push(["meta", id]);
      return meta[id] === undefined ? { ok: false, reason: "not-found" } : { ok: true, file: { ...meta[id] } };
    },
    listChildren: async (id) => {
      calls.list.push(id);
      // A copy, as Drive's answer would be: a later change "in Drive" must not reach a cached listing.
      return drive[id] === undefined ? { ok: false, reason: "not-found" } : { ok: true, files: [...drive[id]] };
    },
    download: async (id) => {
      calls.download.push(id);
      calls.order.push(["download", id]);
      return bytes[id] === undefined ? { ok: false, reason: "not-found" } : { ok: true, bytes: bytes[id] };
    },
    uploadContent: async (id, content, mimeType) => {
      calls.upload.push({ id, bytes: Buffer.from(content), mimeType });
      calls.order.push(["upload", id]);
      // Each upload moves the file on to a new revision, which `fileMeta` then answers.
      const headRevisionId = calls.upload.length === 1 ? "rev-new" : `rev-new-${calls.upload.length}`;
      if (meta[id] !== undefined) meta[id].headRevisionId = headRevisionId;
      bytes[id] = Buffer.from(content);
      return { ok: true, file: { id, name: meta[id]?.name ?? id, mimeType, headRevisionId } };
    },
    createFile: async (parentId, name, content, mimeType) => {
      calls.create.push({ parentId, name, bytes: Buffer.from(content), mimeType });
      created += 1;
      const file = { id: `new${created}XYZ`, name, mimeType, size: String(content.length), headRevisionId: `rev-created-${created}` };
      // The new file is in Drive now: listed in its folder, readable, and answered by `fileMeta`.
      drive[parentId] = [...(drive[parentId] ?? []), file];
      meta[file.id] = { id: file.id, name, mimeType, headRevisionId: file.headRevisionId };
      bytes[file.id] = Buffer.from(content);
      return { ok: true, file };
    },
    exportMarkdown: async (id) => {
      calls.export.push(id);
      return { ok: true, bytes: Buffer.from("# Meeting") };
    },
    ...overrides,
  };
  return { api, calls, meta, drive };
}

async function open(overrides, options = {}) {
  const { api, calls, meta, drive } = fakeApi(overrides);
  const opened = await openGoogleDriveWorkspace({ ref: REF, api, ...options });
  assert.equal(opened.ok, true);
  return { provider: opened.provider, name: opened.name, calls, meta, drive };
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
      { id: "Meeting.md", name: "Meeting.md", kind: "file", googleDoc: true },
      { id: "Plan.md", name: "Plan.md", kind: "file" },
    ],
  });
});

// The tree shows a Doc under its own title, not as the `.md` it opens as - so it has to be told which.
test("marks a Google Doc as one when the folder is already known, too", async () => {
  const { provider } = await open();
  await provider.list("");
  const known = await provider.listKnown("");
  assert.deepEqual(
    known.nodes.filter((node) => node.googleDoc === true).map((node) => node.id),
    ["Meeting.md"],
  );
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
    readOnly: true,
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

// The listing can be a minute old (the cache), so the revision a read answers is asked of Drive - and
// asked BEFORE the bytes, so any skew between the two errs toward a conflict, never an overwrite.
test("a read answers the revision Drive gives now, asked before the download", async () => {
  const { provider, calls, meta } = await open();
  await provider.list("");
  meta.mdCCC.headRevisionId = "rev5";
  const read = await provider.read("Plan.md");
  assert.deepEqual(read, { ok: true, content: "hello", revision: { id: "rev5" } });
  assert.equal("readOnly" in read, false);
  assert.deepEqual(calls.order, [["meta", "rootAAA"], ["meta", "mdCCC"], ["download", "mdCCC"]]);
});

test("a read of a file deleted in Drive since its listing is not found", async () => {
  const { provider, calls, meta } = await open();
  await provider.list("");
  meta.mdCCC.trashed = true;
  assert.deepEqual(await provider.read("Plan.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(calls.download, []);
});

test("a save checks the revision, uploads, and answers the revision Drive gave the write", async () => {
  const { provider, calls } = await open();
  const read = await provider.read("Plan.md");
  assert.deepEqual(read.revision, { id: "rev1" });
  const metaBefore = calls.meta.length;

  const written = await provider.write("Plan.md", "changed", { id: "rev1" });

  assert.deepEqual(written, { ok: true, revision: { id: "rev-new" } });
  assert.deepEqual(calls.meta.slice(metaBefore), ["mdCCC"]);
  // The race between check and write is one request long, so nothing may sit between the two.
  assert.deepEqual(calls.order.slice(-2), [["meta", "mdCCC"], ["upload", "mdCCC"]]);
  assert.equal(calls.upload.length, 1);
  assert.equal(calls.upload[0].id, "mdCCC");
  assert.equal(calls.upload[0].mimeType, "text/markdown");
  assert.equal(calls.upload[0].bytes.toString("utf8"), "changed");
});

test("a save keeps the byte-order mark the file was read with", async () => {
  const { provider, calls } = await open({
    download: async () => ({ ok: true, bytes: Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("hello")]) }),
  });
  const read = await provider.read("Plan.md");
  assert.equal(read.content, "hello");
  assert.equal((await provider.write("Plan.md", "edited", read.revision)).ok, true);
  assert.deepEqual([...calls.upload[0].bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(calls.upload[0].bytes.subarray(3).toString("utf8"), "edited");
});

// Refresh forgets paths and listings, but not what a file's bytes began with: the editor still holds
// the text it read, and saving it must not drop a mark it never showed.
test("a save after a refresh keeps the byte-order mark the file was read with", async () => {
  const { provider, calls } = await open({
    download: async () => ({ ok: true, bytes: Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("hello")]) }),
  });
  const read = await provider.read("Plan.md");
  await provider.refresh();
  assert.equal((await provider.write("Plan.md", "edited", read.revision)).ok, true);
  assert.deepEqual([...calls.upload[0].bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("a second save in a row keeps the byte-order mark too", async () => {
  const { provider, calls } = await open({
    download: async () => ({ ok: true, bytes: Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("hello")]) }),
  });
  const read = await provider.read("Plan.md");
  const first = await provider.write("Plan.md", "one", read.revision);
  assert.deepEqual(first, { ok: true, revision: { id: "rev-new" } });
  const second = await provider.write("Plan.md", "two", first.revision);
  assert.deepEqual(second, { ok: true, revision: { id: "rev-new-2" } });
  for (const upload of calls.upload) assert.deepEqual([...upload.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(calls.upload[1].bytes.subarray(3).toString("utf8"), "two");
});

test("a save without a mark read does not add one", async () => {
  const { provider, calls } = await open();
  const read = await provider.read("Plan.md");
  await provider.write("Plan.md", "edited", read.revision);
  assert.equal(calls.upload[0].bytes.toString("utf8"), "edited");
});

test("a file changed in Drive since it was read is a conflict, and nothing is uploaded", async () => {
  const { provider, calls, meta } = await open();
  await provider.read("Plan.md");
  meta.mdCCC.headRevisionId = "rev9";
  assert.deepEqual(await provider.write("Plan.md", "changed", { id: "rev1" }), {
    ok: false,
    reason: "conflict",
    theirs: { id: "rev9" },
  });
  assert.deepEqual(calls.upload, []);
});

test("a file deleted or trashed in Drive since it was read is a conflict with nothing of theirs", async () => {
  for (const change of [(meta) => delete meta.mdCCC, (meta) => (meta.mdCCC.trashed = true)]) {
    const { provider, calls, meta } = await open();
    await provider.read("Plan.md");
    change(meta);
    assert.deepEqual(await provider.write("Plan.md", "changed", { id: "rev1" }), {
      ok: false,
      reason: "conflict",
      theirs: null,
    });
    assert.deepEqual(calls.upload, []);
  }
});

test("a failure to check passes through, and nothing is uploaded", async () => {
  const { provider, calls } = await open({
    fileMeta: async (id) => (id === "rootAAA" ? { ok: true, file: META.rootAAA } : { ok: false, reason: "offline" }),
  });
  await provider.list("");
  assert.deepEqual(await provider.write("Plan.md", "changed", { id: "rev1" }), { ok: false, reason: "offline" });
  assert.deepEqual(calls.upload, []);
});

test("a failed upload passes through", async () => {
  const { provider } = await open({ uploadContent: async () => ({ ok: false, reason: "offline" }) });
  const read = await provider.read("Plan.md");
  assert.deepEqual(await provider.write("Plan.md", "changed", read.revision), { ok: false, reason: "offline" });
});

// The content landed, but a made-up revision would let the next save overwrite blindly. Asking Drive
// afterwards is a guess too: it could answer a concurrent writer's revision.
test("a write whose answer has no revision answers unknown, and does not ask Drive again", async () => {
  let meta = null;
  const opened = await open({
    uploadContent: async (id) => {
      meta.mdCCC.headRevisionId = "rev-somebody-else";
      return { ok: true, file: { id, name: "Plan.md", mimeType: "text/markdown" } };
    },
  });
  meta = opened.meta;
  const read = await opened.provider.read("Plan.md");
  const asked = opened.calls.meta.length;
  assert.deepEqual(await opened.provider.write("Plan.md", "changed", read.revision), { ok: false, reason: "unknown" });
  // One request: the check. None after the upload.
  assert.equal(opened.calls.meta.length, asked + 1);
});

test("a create whose answer has no revision answers unknown, never the file's id", async () => {
  const { provider } = await open({
    createFile: async (parentId, name, content, mimeType) => ({ ok: true, file: { id: "newABC", name, mimeType } }),
  });
  assert.deepEqual(await provider.write("new.md", "x", null), { ok: false, reason: "unknown" });
});

// A listed file can carry no revision at all; its conflict then has nothing of theirs to name.
test("a conflict over a file with no revision says nothing of theirs, not an empty one", async () => {
  const { provider, drive } = await open();
  // Listed first, so the file arrives through a create's fresh re-listing rather than the check.
  await provider.list("");
  drive.rootAAA.push({ id: "bareIII", name: "bare.md", mimeType: "text/markdown", size: "1" });
  assert.deepEqual(await provider.write("bare.md", "x", null), { ok: false, reason: "conflict", theirs: null });
});

test("a Google Doc refuses a save, without asking Drive anything", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  const metaBefore = calls.meta.length;
  assert.deepEqual(await provider.write("Meeting.md", "changed", { id: "modified:2026-10-01T00:00:00Z" }), {
    ok: false,
    reason: "read-only",
  });
  assert.equal(calls.meta.length, metaBefore);
  assert.deepEqual(calls.upload, []);
});

test("a write to a folder or outside the workspace is refused", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.write("Archive", "x", null), { ok: false, reason: "permission-denied" });
  assert.deepEqual(await provider.write("", "x", null), { ok: false, reason: "permission-denied" });
  assert.deepEqual(await provider.write("../x.md", "x", null), { ok: false, reason: "permission-denied" });
  assert.deepEqual(calls.upload, []);
  assert.deepEqual(calls.create, []);
});

// The chat's create-file tool writes a path nobody has with `expected === null`, as it does locally.
test("a write with no expected revision to a missing path creates the file in its folder", async () => {
  const { provider, calls } = await open();
  const written = await provider.write("Archive/new.md", "# New", null);
  assert.deepEqual(written, { ok: true, revision: { id: "rev-created-1" } });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].parentId, "dirBBB");
  assert.equal(calls.create[0].name, "new.md");
  assert.equal(calls.create[0].mimeType, "text/markdown");
  assert.equal(calls.create[0].bytes.toString("utf8"), "# New");
  assert.deepEqual(calls.upload, []);

  assert.deepEqual(await provider.read("Archive/new.md"), { ok: true, content: "# New", revision: { id: "rev-created-1" } });
  assert.deepEqual((await provider.listKnown("Archive")).nodes.map((node) => node.id).sort(), ["Archive/Old.md", "Archive/new.md"]);
});

test("a new file at the workspace's own folder is created there, as text when it is not markdown", async () => {
  const { provider, calls } = await open();
  assert.equal((await provider.write("todo.txt", "x", null)).ok, true);
  assert.equal(calls.create[0].parentId, "rootAAA");
  assert.equal(calls.create[0].mimeType, "text/plain");
});

// A listing in the cache can predate a file Drive already has; creating another of the same name
// would leave the path naming the OLDER one, and the save would have landed somewhere else.
test("a create asks Drive for the folder afresh, and an existing file there is a conflict", async () => {
  const { provider, calls, drive, meta } = await open();
  await provider.list("");
  drive.rootAAA.push({ id: "lateHHH", name: "late.md", mimeType: "text/markdown", size: "1", headRevisionId: "revLate" });
  meta.lateHHH = { id: "lateHHH", name: "late.md", mimeType: "text/markdown", headRevisionId: "revLate" };
  assert.deepEqual(await provider.write("late.md", "mine", null), {
    ok: false,
    reason: "conflict",
    theirs: { id: "revLate" },
  });
  assert.deepEqual(calls.create, []);
});

test("a create is refused when the path does not describe a new file honestly", async () => {
  const { provider, calls } = await open();
  // A revision expected of a file that is not there: it was deleted, or never existed.
  assert.deepEqual(await provider.write("Missing.md", "x", { id: "rev1" }), { ok: false, reason: "conflict", theirs: null });
  // No revision expected of a file that IS there: somebody else's file, not a new one.
  assert.deepEqual(await provider.write("Plan.md", "x", null), { ok: false, reason: "conflict", theirs: { id: "rev1" } });
  // A name the tree would show differently would land under another path than the one asked for.
  assert.deepEqual(await provider.write("Archive/a:b.md", "x", null), { ok: false, reason: "bad-request" });
  assert.deepEqual(await provider.write("tab\there.md", "x", null), { ok: false, reason: "bad-request" });
  // "a:b.md" at the root reads as drive-relative to the shared guard, and is refused before that.
  assert.deepEqual(await provider.write("a:b.md", "x", null), { ok: false, reason: "permission-denied" });
  // The folder it would go in is not there, or is a file.
  assert.deepEqual(await provider.write("Nowhere/new.md", "x", null), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.write("Plan.md/new.md", "x", null), { ok: false, reason: "not-found" });
  assert.deepEqual(calls.create, []);
  assert.deepEqual(calls.upload, []);
});

test("a failed create passes through", async () => {
  const { provider } = await open({ createFile: async () => ({ ok: false, reason: "rate-limited" }) });
  assert.deepEqual(await provider.write("new.md", "x", null), { ok: false, reason: "rate-limited" });
});

// Refresh pressed while a listing is in flight: what that listing brings back predates the refresh,
// so it must neither be served nor cached.
test("a listing that was in flight when refresh was pressed is asked for again", async () => {
  const OLD = [{ id: "mdCCC", name: "Plan.md", mimeType: "text/markdown", headRevisionId: "rev1" }];
  const NEW = [{ id: "mdNEW", name: "Fresh.md", mimeType: "text/markdown", headRevisionId: "rev3" }];
  const gates = [];
  const asked = [];
  const { provider } = await open({
    listChildren: (id) => {
      asked.push(id);
      if (asked.length === 1) return new Promise((resolve) => gates.push(resolve));
      return Promise.resolve({ ok: true, files: NEW });
    },
  });

  const pending = provider.list("");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gates.length, 1);
  await provider.refresh();
  gates[0]({ ok: true, files: OLD });

  assert.deepEqual((await pending).nodes.map((node) => node.id), ["Fresh.md"]);
  assert.deepEqual(asked, ["rootAAA", "rootAAA"]);
  // Nor did the stale answer reach the cache.
  assert.deepEqual((await provider.list("")).nodes.map((node) => node.id), ["Fresh.md"]);
  assert.deepEqual(await provider.read("Plan.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(asked, ["rootAAA", "rootAAA"]);
});

test("a listing started after refresh does not join one started before it", async () => {
  const gates = [];
  const asked = [];
  const { provider } = await open({
    listChildren: (id) => {
      asked.push(id);
      if (asked.length === 1) return new Promise((resolve) => gates.push(resolve));
      return Promise.resolve({ ok: true, files: DRIVE.rootAAA });
    },
  });
  const first = provider.list("");
  await new Promise((resolve) => setImmediate(resolve));
  await provider.refresh();
  const second = provider.list("");
  await new Promise((resolve) => setImmediate(resolve));
  // Released before asserting, so a provider that joined the old request fails here rather than hangs.
  gates[0]({ ok: true, files: [] });
  assert.equal((await second).ok, true);
  assert.equal((await first).ok, true);
  assert.deepEqual(asked, ["rootAAA", "rootAAA"]);
  assert.deepEqual((await second).nodes.map((node) => node.id), (await provider.list("")).nodes.map((node) => node.id));
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

// The filter, Find in Files and the chat outline search only what has been opened: `listKnown` answers
// from the map and never asks Drive.
test("listKnown answers a listed folder from the map without asking Drive", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  const asked = calls.list.length;
  const known = await provider.listKnown("");
  assert.equal(known.ok, true);
  assert.equal(known.complete, true);
  assert.deepEqual(known.nodes.map((node) => node.name).sort(), ["Archive", "Meeting.md", "Plan.md", "chart.png", "huge.md"]);
  assert.equal(calls.list.length, asked);
});

test("listKnown says a folder never listed is incomplete, and does not ask Drive", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  const asked = calls.list.length;
  assert.deepEqual(await provider.listKnown("Archive"), { ok: true, nodes: [], complete: false });
  assert.deepEqual(await provider.listKnown(""), { ok: true, nodes: (await provider.listKnown("")).nodes, complete: true });
  assert.equal(calls.list.length, asked);
});

test("listKnown on the root before anything is listed is incomplete", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.listKnown(""), { ok: true, nodes: [], complete: false });
  assert.equal(calls.list.length, 0);
});

test("listKnown treats a folder as listed once its listing has succeeded", async () => {
  const { provider } = await open();
  await provider.list("Archive");
  const known = await provider.listKnown("Archive");
  assert.equal(known.complete, true);
  assert.deepEqual(known.nodes.map((node) => node.id), ["Archive/Old.md"]);
});

test("a failed listing does not count as listed", async () => {
  const { provider } = await open({ listChildren: async () => ({ ok: false, reason: "offline" }) });
  await provider.list("");
  assert.equal((await provider.listKnown("")).complete, false);
});

test("refresh forgets which folders were listed", async () => {
  const { provider } = await open();
  await provider.list("");
  await provider.refresh();
  assert.equal((await provider.listKnown("")).complete, false);
});

test("a folder that has gone is no longer known as listed", async () => {
  let gone = false;
  const { provider } = await open({
    listChildren: async (id) =>
      id === "rootAAA"
        ? { ok: true, files: gone ? DRIVE.rootAAA.filter((file) => file.id !== "dirBBB") : DRIVE.rootAAA }
        : { ok: true, files: DRIVE[id] ?? [] },
  });
  await provider.list("Archive");
  assert.equal((await provider.listKnown("Archive")).complete, true);
  gone = true;
  await provider.refresh();
  await provider.list("");
  assert.equal((await provider.listKnown("Archive")).complete, false);
});

test("listKnown refuses a path outside the workspace", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.listKnown("../x"), { ok: false, reason: "permission-denied" });
  assert.equal(calls.list.length, 0);
});

const SHARED_ROOT = { kind: "google-drive", folderId: "0AbcDEF", driveId: "0AbcDEF", name: "Test Drive" };

async function openRef(ref, overrides) {
  const { api } = fakeApi(overrides);
  return openGoogleDriveWorkspace({ ref, api });
}

test("a shared drive's root opens under the drive's own name, not Drive's generic one", async () => {
  const asked = [];
  const opened = await openRef(SHARED_ROOT, {
    fileMeta: async (id) => ({ ok: true, file: { id, name: "Drive", mimeType: FOLDER } }),
    sharedDrive: async (id) => {
      asked.push(id);
      return { ok: true, drive: { id, name: "Team Drive Now" } };
    },
  });
  assert.equal(opened.name, "Team Drive Now");
  assert.equal(opened.variant, "shared-drive");
  assert.deepEqual(asked, ["0AbcDEF"]);
});

test("a shared drive whose name cannot be read opens as the name it was chosen under", async () => {
  const opened = await openRef(SHARED_ROOT, {
    fileMeta: async (id) => ({ ok: true, file: { id, name: "Drive", mimeType: FOLDER } }),
    sharedDrive: async () => ({ ok: false, reason: "offline" }),
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.name, "Test Drive");
  assert.equal(opened.variant, "shared-drive");
});

test("a folder inside a shared drive is named by its own metadata and does not ask for the drive", async () => {
  let asked = false;
  const opened = await openRef(
    { kind: "google-drive", folderId: "rootAAA", driveId: "0AbcDEF", name: "Notes" },
    {
      sharedDrive: async () => {
        asked = true;
        return { ok: false, reason: "offline" };
      },
    },
  );
  assert.equal(opened.name, "Notes (renamed)");
  assert.equal(opened.variant, "folder");
  assert.equal(asked, false);
});

test("says what kind of place was opened", async () => {
  const myDrive = await openRef(
    { kind: "google-drive", folderId: "root", name: "My Drive" },
    { fileMeta: async () => ({ ok: true, file: { id: "realRootId", name: "My Drive", mimeType: FOLDER } }) },
  );
  assert.equal(myDrive.variant, "my-drive");

  const shared = await openRef(REF, {
    fileMeta: async (id) => ({ ok: true, file: { id, name: "Projects", mimeType: FOLDER, shared: true } }),
  });
  assert.equal(shared.variant, "shared-folder");

  const plain = await openRef(REF, {});
  assert.equal(plain.variant, "folder");
});

// My Drive is opened by the alias "root", which means whichever account is connected. Its real id is
// remembered at first open, so a later open under another account is refused rather than followed.
test("My Drive is pinned to the account that first opened it", async () => {
  const realRoot = { fileMeta: async () => ({ ok: true, file: { id: "0ARealRootId", name: "My Drive", mimeType: FOLDER } }) };

  const first = await openRef({ kind: "google-drive", folderId: "root", name: "My Drive" }, realRoot);
  assert.equal(first.ok, true);
  assert.deepEqual(first.ref, { kind: "google-drive", folderId: "root", rootId: "0ARealRootId", name: "My Drive" });
  // The key stays the alias: the provider still lists "root".
  assert.equal(first.provider.id, "root");

  const same = await openRef({ kind: "google-drive", folderId: "root", rootId: "0ARealRootId", name: "My Drive" }, realRoot);
  assert.equal(same.ok, true);
  assert.equal(same.ref.rootId, "0ARealRootId");

  assert.deepEqual(await openRef({ kind: "google-drive", folderId: "root", rootId: "0AOtherRoot", name: "My Drive" }, realRoot), {
    ok: false,
    reason: "other-account",
  });
});

test("a folder that is not My Drive answers its reference unchanged", async () => {
  const opened = await openRef(REF, {});
  assert.deepEqual(opened.ref, REF);
  const shared = await openRef(SHARED_ROOT, {
    fileMeta: async (id) => ({ ok: true, file: { id, name: "Drive", mimeType: FOLDER } }),
    sharedDrive: async (id) => ({ ok: true, drive: { id, name: "Team" } }),
  });
  assert.deepEqual(shared.ref, SHARED_ROOT);
});

/// A Drive with a clip in it, answering ranges. `downloadRange` records what it was asked and hands
/// back a stream, as the real client does.
function mediaApi() {
  const asked = [];
  const listed = [];
  const FILES = {
    rootAAA: [
      { id: "dirBBB", name: "Archive", mimeType: FOLDER },
      { id: "vidHHH", name: "clip.mp4", mimeType: "video/mp4", size: "2000" },
      { id: "nosIII", name: "unsized.mp4", mimeType: "video/mp4" },
      { id: "docDDD", name: "Meeting", mimeType: DOC, modifiedTime: "2026-10-01T00:00:00Z" },
    ],
    dirBBB: [{ id: "audJJJ", name: "song.mp3", mimeType: "audio/mpeg", size: "300" }],
  };
  const overrides = {
    listChildren: async (id) => (listed.push(id), FILES[id] === undefined ? { ok: false, reason: "not-found" } : { ok: true, files: [...FILES[id]] }),
    downloadRange: async (id, start, end) => {
      asked.push([id, start, end]);
      return { ok: true, status: 206, body: new Blob(["bytes"]).stream() };
    },
  };
  return { overrides, asked, listed };
}

test("mediaSource answers the listed size, with no metadata request and no download", async () => {
  const { overrides, asked } = mediaApi();
  const { provider, calls } = await open(overrides);
  await provider.list("");
  calls.meta.length = 0;

  const found = await provider.mediaSource("clip.mp4");
  assert.equal(found.ok, true);
  assert.equal(found.size, 2000);
  assert.equal(typeof found.open, "function");
  assert.deepEqual(calls.meta, []);
  assert.deepEqual(calls.download, []);
  assert.deepEqual(asked, []);
});

test("mediaSource's open asks Drive for exactly that inclusive range and answers its body", async () => {
  const { overrides, asked } = mediaApi();
  const { provider } = await open(overrides);
  const found = await provider.mediaSource("clip.mp4");

  const opened = await found.open(10, 19);
  assert.equal(opened.ok, true);
  assert.deepEqual(asked, [["vidHHH", 10, 19]]);
  assert.equal(await new Response(opened.body).text(), "bytes");
});

test("mediaSource's open passes on a failure from Drive as its reason", async () => {
  const { overrides } = mediaApi();
  const { provider } = await open({ ...overrides, downloadRange: async () => ({ ok: false, reason: "unsatisfiable" }) });
  const found = await provider.mediaSource("clip.mp4");
  assert.deepEqual(await found.open(5000, 5001), { ok: false, reason: "unsatisfiable" });
});

test("mediaSource refuses a path outside the workspace before Drive is asked", async () => {
  const { overrides, asked, listed } = mediaApi();
  const { provider, calls } = await open(overrides);
  // Opening asked Drive about the folder itself; what must stay quiet is everything after.
  calls.meta.length = 0;
  for (const bad of ["../clip.mp4", "Archive/../../clip.mp4", "", "/etc/clip.mp4"]) {
    const found = await provider.mediaSource(bad);
    assert.equal(found.ok, false, bad);
    assert.equal(found.reason, "permission-denied", bad);
  }
  assert.deepEqual(listed, []);
  assert.deepEqual(calls.meta, []);
  assert.deepEqual(asked, []);
});

test("mediaSource answers not-found for a folder, a Google Doc, an unknown path and an unsized file", async () => {
  const { overrides } = mediaApi();
  const { provider } = await open(overrides);
  for (const missing of ["Archive", "Meeting.md", "nothing.mp4", "unsized.mp4"]) {
    assert.deepEqual(await provider.mediaSource(missing), { ok: false, reason: "not-found" }, missing);
  }
});

test("mediaSource finds a file nobody has listed by the same walk read uses", async () => {
  const { overrides, asked, listed } = mediaApi();
  const { provider } = await open(overrides);

  const found = await provider.mediaSource("Archive/song.mp3");
  assert.equal(found.ok, true);
  assert.equal(found.size, 300);
  assert.deepEqual(listed, ["rootAAA", "dirBBB"]);

  await found.open(0, 299);
  assert.deepEqual(asked, [["audJJJ", 0, 299]]);
});

/// Drive can ignore a Range and answer 200 with the whole file; the client passes that on for a
/// range starting at 0. A 200 is only the answer to a range that IS the whole file.
function ignoringRangeApi() {
  const cancelled = [];
  const overrides = {
    listChildren: async () => ({ ok: true, files: [{ id: "vidHHH", name: "clip.mp4", mimeType: "video/mp4", size: "20" }] }),
    downloadRange: async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({ cancel: () => void cancelled.push(true) }),
    }),
  };
  return { overrides, cancelled };
}

test("mediaSource refuses a whole-file 200 as the answer to a partial range, and cancels its body", async () => {
  const { overrides, cancelled } = ignoringRangeApi();
  const { provider } = await open(overrides);
  const found = await provider.mediaSource("clip.mp4");
  assert.deepEqual(await found.open(0, 4), { ok: false, reason: "offline" });
  assert.deepEqual(cancelled, [true]);
});

test("mediaSource accepts a 200 for a range that is the whole file", async () => {
  const { overrides, cancelled } = ignoringRangeApi();
  const { provider } = await open(overrides);
  const found = await provider.mediaSource("clip.mp4");
  const opened = await found.open(0, 19);
  assert.equal(opened.ok, true);
  assert.deepEqual(cancelled, []);
});
