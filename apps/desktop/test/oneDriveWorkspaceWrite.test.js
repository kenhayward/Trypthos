"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ONEDRIVE_UPLOAD_LIMIT_BYTES } = require("@trypthos/domain");
const { openOneDriveWorkspace } = require("../src/oneDriveWorkspace");

/// Writing to a OneDrive folder, over a fake OneDrive client that answers paths in any case, as Graph
/// does.
///
/// What is under test: a save presents the content tag it read and hands the editor the one OneDrive
/// answers, keeping a byte-order mark; a refused save is a conflict and nothing else is tried; a write
/// with no revision creates and never replaces, and never makes a folder on the way; a taken name is
/// the provider contract's `conflict`; every write drops the listing of the folder it wrote into under
/// its folded spelling, and a listing in flight across a write is not kept; the guard refuses before
/// any request; a file over the simple-upload limit opens read-only.

const MINE = "d0c0ffee";
const REF = { kind: "onedrive", driveId: MINE, itemId: "ROOT!0", name: "Notes" };
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function tree() {
  return {
    "": { id: "ROOT!0", name: "Notes", folder: {} },
    "Plan.md": { id: "ITEM!1", name: "Plan.md", size: 8, cTag: "ctag-1", file: {} },
    Archive: { id: "ITEM!2", name: "Archive", folder: {} },
    "Archive/Old.md": { id: "ITEM!3", name: "Old.md", size: 3, cTag: "ctag-3", file: {} },
  };
}

/// The key a path is held under, in the case it was first made in - Graph's own case-insensitivity. A
/// path nobody has is answered as it was asked.
function canonical(items, path) {
  if (path === "") return "";
  let at = "";
  for (const segment of path.split("/")) {
    const asked = at === "" ? segment : `${at}/${segment}`;
    at = Object.keys(items).find((key) => key.toLowerCase() === asked.toLowerCase()) ?? asked;
  }
  return at;
}

function childrenOf(items, path) {
  const prefix = path === "" ? "" : `${path}/`;
  return Object.entries(items)
    .filter(([key]) => key !== "" && key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
    .map(([, item]) => ({ ...item }));
}

/// `answers` replaces what a write call answers; `gate(path)` is awaited by `children` AFTER it has
/// read the tree, so a test can hold a listing in flight while it is already out of date.
function fakeApi({ items = tree(), bytes = null, answers = {}, gate = null } = {}) {
  const content = bytes ?? { "ITEM!1": Buffer.concat([BOM, Buffer.from("hello")]), "ITEM!3": Buffer.from("old") };
  const calls = [];
  /// Each body a write was handed, exactly as it came: the client does not check it is bytes.
  const bodies = [];
  let made = 0;
  const api = {
    drive: async () => ({ ok: true, drive: { id: MINE } }),
    item: async (driveId, itemId, path) => {
      calls.push(["item", path]);
      const key = canonical(items, path);
      return items[key] === undefined ? { ok: false, reason: "not-found" } : { ok: true, item: { ...items[key] } };
    },
    children: async (driveId, itemId, path) => {
      calls.push(["children", path]);
      const key = canonical(items, path);
      const listed = items[key]?.folder === undefined ? { ok: false, reason: "not-found" } : { ok: true, items: childrenOf(items, key) };
      if (gate !== null) await gate(path);
      return listed;
    },
    download: async (driveId, itemId) => ({ ok: true, bytes: content[itemId] }),
    writeContent: async (driveId, itemId, path, body, cTag) => {
      calls.push(["writeContent", driveId, itemId, path, Buffer.from(body), cTag]);
      bodies.push(body);
      if (answers.writeContent !== undefined) return answers.writeContent;
      const key = canonical(items, path);
      if (items[key] === undefined || items[key].cTag !== cTag) return { ok: false, reason: "conflict" };
      made += 1;
      items[key] = { ...items[key], cTag: `ctag-saved-${made}`, size: body.length };
      return { ok: true, item: { ...items[key] } };
    },
    createContent: async (driveId, itemId, path, body) => {
      calls.push(["createContent", driveId, itemId, path, Buffer.from(body)]);
      bodies.push(body);
      if (answers.createContent !== undefined) return answers.createContent;
      const key = canonical(items, path);
      if (items[key] !== undefined) return { ok: false, reason: "exists" };
      made += 1;
      items[key] = { id: `NEW!${made}`, name: key.slice(key.lastIndexOf("/") + 1), size: body.length, cTag: `ctag-new-${made}`, file: {} };
      return { ok: true, item: { ...items[key] } };
    },
    createFolder: async (driveId, itemId, parentPath, name) => {
      calls.push(["createFolder", driveId, itemId, parentPath, name]);
      if (answers.createFolder !== undefined) return answers.createFolder;
      const parent = canonical(items, parentPath);
      const key = canonical(items, parent === "" ? name : `${parent}/${name}`);
      if (items[key] !== undefined) return { ok: false, reason: "exists" };
      made += 1;
      items[key] = { id: `DIR!${made}`, name, folder: {} };
      return { ok: true, item: { ...items[key] } };
    },
    rename: async (driveId, itemId, path, name) => {
      calls.push(["rename", driveId, itemId, path, name]);
      if (answers.rename !== undefined) return answers.rename;
      const from = canonical(items, path);
      if (items[from] === undefined) return { ok: false, reason: "not-found" };
      const parent = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
      const to = parent === "" ? name : `${parent}/${name}`;
      const taken = canonical(items, to);
      if (items[taken] !== undefined && taken.toLowerCase() !== from.toLowerCase()) return { ok: false, reason: "exists" };
      for (const key of Object.keys(items)) {
        if (key !== from && !key.startsWith(`${from}/`)) continue;
        const item = items[key];
        delete items[key];
        items[to + key.slice(from.length)] = key === from ? { ...item, name } : item;
      }
      return { ok: true, item: { ...items[to] } };
    },
  };
  return { api, calls, items, bodies };
}

async function open(options = {}) {
  const fake = fakeApi(options);
  const opened = await openOneDriveWorkspace({ ref: REF, api: fake.api });
  assert.equal(opened.ok, true);
  return { provider: opened.provider, calls: fake.calls, items: fake.items, bodies: fake.bodies };
}

const named = (calls, name) => calls.filter((call) => call[0] === name);

test("saves against the content tag it read, keeps a byte-order mark, and answers OneDrive's new tag", async () => {
  const { provider, calls } = await open();
  const read = await provider.read("Plan.md");
  assert.deepEqual(read, { ok: true, content: "hello", revision: { id: "ctag-1" } });
  assert.deepEqual(await provider.write("Plan.md", "changed", read.revision), { ok: true, revision: { id: "ctag-saved-1" } });
  // The mark carries on to the next save, recorded against the tag the first save answered.
  assert.deepEqual(await provider.write("Plan.md", "again", { id: "ctag-saved-1" }), { ok: true, revision: { id: "ctag-saved-2" } });
  const saves = named(calls, "writeContent");
  assert.deepEqual(
    saves.map((call) => [call[1], call[2], call[3], call[5]]),
    [
      [MINE, "ROOT!0", "Plan.md", "ctag-1"],
      [MINE, "ROOT!0", "Plan.md", "ctag-saved-1"],
    ],
  );
  assert.deepEqual(saves[0][4], Buffer.concat([BOM, Buffer.from("changed")]));
  assert.deepEqual(saves[1][4], Buffer.concat([BOM, Buffer.from("again")]));
});

test("a save OneDrive refuses for a stale tag is a conflict naming no revision, and nothing else is tried", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  assert.deepEqual(await provider.write("Plan.md", "mine", { id: "ctag-stale" }), { ok: false, reason: "conflict", theirs: null });
  assert.deepEqual(calls.slice(before).map((call) => call[0]), ["writeContent"]);
});

// The revision comes back from the renderer, and goes into a header.
test("a revision that is not a content tag is bad-request, with nothing asked", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  for (const id of ["a\r\nX-Injected: 1", " ctag-1", "ctag\t1", "é"]) {
    assert.deepEqual(await provider.write("Plan.md", "x", { id }), { ok: false, reason: "bad-request" }, JSON.stringify(id));
  }
  assert.equal(calls.length, before);
});

// The content landed, but as what OneDrive will not say: there is nothing honest to hand the editor.
test("a write whose answer has no usable content tag landed as unknown", async () => {
  const landedWithout = { ok: true, item: { id: "ITEM!1", name: "Plan.md", file: {} } };
  const { provider } = await open({ answers: { writeContent: landedWithout, createContent: landedWithout } });
  assert.deepEqual(await provider.write("Plan.md", "x", { id: "ctag-1" }), { ok: false, reason: "unknown" });
  assert.deepEqual(await provider.write("New.md", "x", null), { ok: false, reason: "unknown" });
});

test("a refused save that is not a conflict is passed on as it came", async () => {
  for (const refusal of [
    { ok: false, reason: "offline" },
    { ok: false, reason: "unknown" },
    { ok: false, reason: "permission-denied" },
    { ok: false, reason: "too-large", sizeBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES + 1, limitBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES },
  ]) {
    const { provider } = await open({ answers: { writeContent: refusal } });
    assert.deepEqual(await provider.write("Plan.md", "x", { id: "ctag-1" }), refusal, refusal.reason);
  }
});

test("a write with no revision creates the file, with no byte-order mark, and never replaces one", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.write("Archive/New.md", "made", null), { ok: true, revision: { id: "ctag-new-1" } });
  assert.deepEqual(
    named(calls, "createContent").map((call) => [call[3], call[4].toString("utf8")]),
    [["Archive/New.md", "made"]],
  );
  // A name taken in another case is the same name to OneDrive.
  assert.deepEqual(await provider.write("Archive/new.MD", "again", null), { ok: false, reason: "conflict", theirs: null });
  assert.equal(named(calls, "writeContent").length, 0);
});

// Graph's path PUT may make the folders on the way; the app makes only what it was asked for.
test("a create into a folder that is not there is not-found, with nothing written", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.write("Missing/New.md", "x", null), { ok: false, reason: "not-found" });
  assert.equal(named(calls, "createContent").length, 0);
});

// A folder deleted on the web is still in the listing cache for up to its TTL. Asked through the
// cache, the create would go ahead and Graph's path PUT would make the folder again.
test("a create asks for its folder fresh, so one deleted since it was listed is not made again", async () => {
  const { provider, calls, items } = await open();
  await provider.list("");
  await provider.list("Archive");
  delete items.Archive;
  delete items["Archive/Old.md"];
  assert.deepEqual(await provider.write("Archive/New.md", "x", null), { ok: false, reason: "not-found" });
  assert.equal(named(calls, "createContent").length, 0);
  assert.deepEqual(named(calls, "item").at(-1), ["item", "Archive"]);
});

test("a create into something that is a file, not a folder, is not-found, with nothing written", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.write("Plan.md/New.md", "x", null), { ok: false, reason: "not-found" });
  assert.equal(named(calls, "createContent").length, 0);
});

// The client sends what it is handed and does not check it is bytes; a string would go out as
// whatever fetch made of it, and the four-megabyte limit would count characters.
test("every write hands OneDrive the text as UTF-8 bytes, counted in bytes", async () => {
  const { provider, bodies } = await open();
  await provider.read("Plan.md");
  assert.equal((await provider.write("Plan.md", "éé", { id: "ctag-1" })).ok, true);
  assert.equal((await provider.write("Archive/New.md", "é", null)).ok, true);
  assert.equal(bodies.length, 2);
  for (const body of bodies) assert.ok(body instanceof Uint8Array, typeof body);
  assert.deepEqual(Buffer.from(bodies[0]), Buffer.concat([BOM, Buffer.from([0xc3, 0xa9, 0xc3, 0xa9])]));
  assert.deepEqual(Buffer.from(bodies[1]), Buffer.from([0xc3, 0xa9]));
});

test("a write through a lower-case spelling drops the listing made under another", async () => {
  const { provider, calls } = await open();
  await provider.list("Archive");
  assert.equal((await provider.write("archive/x.md", "x", null)).ok, true);
  const relisted = await provider.list("Archive");
  assert.equal(named(calls, "children").length, 2);
  assert.ok(relisted.nodes.some((node) => node.id === "Archive/x.md"));
});

test("New Folder and a rename drop the listing of their folder, whichever spelling it was made under", async () => {
  const { provider, calls } = await open();
  await provider.list("Archive");
  assert.deepEqual(await provider.createDirectory("ARCHIVE/Ideas"), { ok: true });
  await provider.list("Archive");
  assert.equal(named(calls, "children").length, 2);
  assert.deepEqual(await provider.rename("archive/Old.md", "Older.md"), { ok: true, path: "archive/Older.md" });
  const relisted = await provider.list("Archive");
  assert.equal(named(calls, "children").length, 3);
  assert.ok(relisted.nodes.some((node) => node.id === "Archive/Older.md"));
});

// Something that fails as offline or unknown may still have landed.
test("a refused write drops the listing all the same", async () => {
  const { provider, calls } = await open({
    answers: {
      writeContent: { ok: false, reason: "unknown" },
      createContent: { ok: false, reason: "offline" },
      createFolder: { ok: false, reason: "offline" },
      rename: { ok: false, reason: "unknown" },
    },
  });
  await provider.list("Archive");
  let lists = 1;
  for (const write of [
    () => provider.write("Archive/Old.md", "x", { id: "ctag-3" }),
    () => provider.write("Archive/New.md", "x", null),
    () => provider.createDirectory("Archive/Ideas"),
    () => provider.rename("Archive/Old.md", "Older.md"),
  ]) {
    assert.equal((await write()).ok, false);
    await provider.list("Archive");
    lists += 1;
    assert.equal(named(calls, "children").length, lists);
  }
});

// The carry-over from PR 2's review: two spellings of one folder.
test("a write into a folder drops its listing, whichever spelling either was made under", async () => {
  const { provider, calls } = await open();
  await provider.list("Archive");
  assert.equal(named(calls, "children").length, 1);
  assert.equal((await provider.write("ARCHIVE/New.md", "x", null)).ok, true);
  const relisted = await provider.list("archive");
  assert.equal(named(calls, "children").length, 2);
  assert.deepEqual(relisted.nodes.map((node) => node.id), ["archive/New.md", "archive/Old.md"]);
});

test("a save drops the listing of the folder it saved into", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  await provider.write("Plan.md", "longer text", { id: "ctag-1" });
  await provider.list("");
  assert.equal(named(calls, "children").length, 2);
});

test("a listing in flight when a write lands in its folder is not kept", async () => {
  let holding = true;
  let release = () => {};
  const held = new Promise((resolve) => (release = resolve));
  const gate = async (path) => {
    if (path === "Archive" && holding) {
      holding = false;
      await held;
    }
  };
  const { provider, calls } = await open({ gate });
  const first = provider.list("Archive");
  assert.deepEqual(await provider.createDirectory("Archive/Ideas"), { ok: true });
  release();
  const overtaken = await first;
  assert.ok(overtaken.nodes.some((node) => node.id === "Archive/Ideas"));
  const again = await provider.list("Archive");
  assert.equal(named(calls, "children").length, 2);
  assert.ok(again.nodes.some((node) => node.id === "Archive/Ideas"));
});

test("New Folder asks OneDrive for one folder in its parent, and a taken name is a conflict", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.createDirectory("Archive/Ideas"), { ok: true });
  assert.deepEqual(await provider.createDirectory("archive/IDEAS"), { ok: false, reason: "conflict" });
  assert.deepEqual(named(calls, "createFolder"), [
    ["createFolder", MINE, "ROOT!0", "Archive", "Ideas"],
    ["createFolder", MINE, "ROOT!0", "archive", "IDEAS"],
  ]);
});

test("renames in its folder and answers the new path; a change of case alone is asked like any other", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.rename("Plan.md", "plan.md"), { ok: true, path: "plan.md" });
  assert.deepEqual(await provider.rename("Archive/Old.md", "Older.md"), { ok: true, path: "Archive/Older.md" });
  assert.deepEqual(named(calls, "rename"), [
    ["rename", MINE, "ROOT!0", "Plan.md", "plan.md"],
    ["rename", MINE, "ROOT!0", "Archive/Old.md", "Older.md"],
  ]);
});

test("a rename onto a taken name is a conflict, and other refusals pass on", async () => {
  assert.deepEqual(await (await open({ answers: { rename: { ok: false, reason: "exists" } } })).provider.rename("Plan.md", "Archive"), {
    ok: false,
    reason: "conflict",
  });
  assert.deepEqual(await (await open({ answers: { rename: { ok: false, reason: "offline" } } })).provider.rename("Plan.md", "x.md"), {
    ok: false,
    reason: "offline",
  });
});

test("a rename drops the listing of its folder and of everything that was below it", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  await provider.list("Archive");
  assert.deepEqual(await provider.rename("Archive", "Kept"), { ok: true, path: "Kept" });
  assert.deepEqual(await provider.listKnown(""), { ok: true, nodes: [], complete: false });
  assert.deepEqual(await provider.listKnown("archive"), { ok: true, nodes: [], complete: false });
  const root = await provider.list("");
  assert.ok(root.nodes.some((node) => node.id === "Kept"));
  assert.equal(named(calls, "children").length, 3);
});

test("refuses a rename that is not a name in the same folder, and the workspace's own folder, before any request", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  for (const name of ["../x.md", "a/b.md", "a\\b.md", "..", "."]) {
    assert.deepEqual(await provider.rename("Plan.md", name), { ok: false, reason: "bad-request" }, name);
  }
  assert.deepEqual(await provider.rename("", "x"), { ok: false, reason: "permission-denied" });
  assert.deepEqual(await provider.createDirectory(""), { ok: false, reason: "permission-denied" });
  assert.deepEqual(await provider.write("", "x", null), { ok: false, reason: "permission-denied" });
  assert.equal(calls.length, before);
});

// The workspace boundary, for every write. Refused by the shared guard before any request is made.
test("refuses a write that leaves the workspace, before asking OneDrive anything", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  for (const escape of ["../outside.md", "Archive/../../outside.md", "/etc/passwd", "C:/Windows/win.ini", "C:outside.md", "\\\\server\\share\\x.md"]) {
    for (const answer of [
      provider.write(escape, "x", null),
      provider.write(escape, "x", { id: "ctag-1" }),
      provider.createDirectory(escape),
      provider.rename(escape, "x.md"),
    ]) {
      assert.deepEqual(await answer, { ok: false, reason: "permission-denied" }, escape);
    }
  }
  assert.equal(calls.length, before);
});

// Graph's simple upload takes four megabytes; a file larger than that could be edited and never saved.
test("a file larger than OneDrive takes in one request opens read-only; one within it opens to be edited", async () => {
  const big = Buffer.alloc(ONEDRIVE_UPLOAD_LIMIT_BYTES + 1, 0x61);
  const items = { ...tree(), "big.md": { id: "ITEM!9", name: "big.md", size: big.length, cTag: "ctag-9", file: {} } };
  const { provider } = await open({ items, bytes: { "ITEM!9": big, "ITEM!3": Buffer.from("old") } });
  const read = await provider.read("big.md");
  assert.equal(read.ok, true);
  assert.equal(read.readOnly, true);
  assert.equal("readOnly" in (await provider.read("Archive/Old.md")), false);
});

test("a content tag that could not go back in a header is never handed to the editor", async () => {
  const items = { ...tree(), "odd.md": { id: "ITEM!8", name: "odd.md", size: 3, cTag: "ctag\r\nX", file: {} } };
  const { provider } = await open({ items, bytes: { "ITEM!8": Buffer.from("odd") } });
  assert.deepEqual(await provider.read("odd.md"), { ok: false, reason: "unknown" });
});
