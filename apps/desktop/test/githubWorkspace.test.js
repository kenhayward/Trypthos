"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_TEXT_FILE_BYTES } = require("@trypthos/domain");
const { openGitHubWorkspace } = require("../src/githubWorkspace");

/// The GitHub backend, against a fake API.
///
/// The point of these tests is that this provider answers in the SAME shapes the local one does.
/// Everything above it - the tree, the filter box, Find in Files, the editor's read path - was
/// written against the local backend and is not touched by this feature, so the two agreeing is the
/// whole of why that works.

const REF = { kind: "github", owner: "ada", repo: "notes" };

const TREE = [
  { path: "README.md", mode: "100644", type: "blob", sha: "b1", size: 5 },
  { path: "docs", mode: "040000", type: "tree", sha: "t1" },
  { path: "docs/guide.md", mode: "100644", type: "blob", sha: "b2", size: 5 },
  { path: "link.md", mode: "120000", type: "blob", sha: "b4", size: 9 },
];

function fakeApi(overrides = {}) {
  const blobs = { b1: Buffer.from("hello"), b2: Buffer.from("guide") };
  const calls = { blob: [] };

  return {
    calls,
    api: {
      defaultBranchHead: async () => ({ ok: true, branch: "main", sha: "c0ffee" }),
      tree: async () => ({ ok: true, entries: TREE, truncated: false }),
      blob: async (_owner, _repo, sha) => {
        calls.blob.push(sha);
        return blobs[sha] === undefined
          ? { ok: false, reason: "not-found" }
          : { ok: true, bytes: blobs[sha] };
      },
      ...overrides,
    },
  };
}

async function openFake(overrides) {
  const { api, calls } = fakeApi(overrides);
  const opened = await openGitHubWorkspace({ ref: REF, api });
  return { opened, calls };
}

test("opens a repository at the head of its default branch", async () => {
  const { opened } = await openFake();

  assert.equal(opened.ok, true);
  assert.equal(opened.branch, "main");
  assert.equal(opened.provider.kind, "github");
});

// Opening can fail in ways the user has to be told about - a repository that is not there, a token
// that has been revoked - so it is a result rather than a provider that fails on its first listing.
test("reports a repository it cannot open rather than opening an empty one", async () => {
  const { opened } = await openFake({
    defaultBranchHead: async () => ({ ok: false, reason: "not-found" }),
  });

  assert.deepEqual(opened, { ok: false, reason: "not-found" });
});

test("lists a folder in the same shape the local backend does", async () => {
  const { opened } = await openFake();
  const listed = await opened.provider.list("");

  assert.equal(listed.ok, true);
  assert.deepEqual(listed.nodes, [
    { id: "README.md", name: "README.md", kind: "file" },
    { id: "docs", name: "docs", kind: "directory" },
  ]);
});

test("lists a folder below the root", async () => {
  const { opened } = await openFake();
  assert.deepEqual((await opened.provider.list("docs")).nodes, [
    { id: "docs/guide.md", name: "guide.md", kind: "file" },
  ]);
});

// The tree is fetched once at open, so every listing after that is memory. Without it the filter
// box would make one request per folder, against an hourly budget.
test("lists without going back to GitHub", async () => {
  let trees = 0;
  const { opened } = await openFake({
    tree: async () => {
      trees += 1;
      return { ok: true, entries: TREE, truncated: false };
    },
  });

  await opened.provider.list("");
  await opened.provider.list("docs");
  await opened.provider.list("");
  assert.equal(trees, 1);
});

test("reads a file, with the blob's sha as its revision", async () => {
  const { opened } = await openFake();
  const read = await opened.provider.read("docs/guide.md");

  assert.equal(read.ok, true);
  assert.equal(read.content, "guide");
  assert.deepEqual(read.revision, { id: "b2" });
});

// A second read of one file is free. Find in Files opens every document under a folder, and doing
// that twice over a network the user is paying for is the difference between a search and a wait.
test("does not fetch the same blob twice", async () => {
  const { opened, calls } = await openFake();

  await opened.provider.read("README.md");
  await opened.provider.read("README.md");
  assert.deepEqual(calls.blob, ["b1"]);
});

test("reports a path that is not in the tree as not found", async () => {
  const { opened } = await openFake();
  assert.deepEqual(await opened.provider.read("missing.md"), { ok: false, reason: "not-found" });
});

// A symlink is a blob holding the path it points at. The local backend refuses to follow one, and
// this one refuses to open one - if it did not, the two providers would disagree about what a
// repository contains.
test("refuses a symlink rather than opening the path it points at", async () => {
  const { opened } = await openFake();
  assert.deepEqual(await opened.provider.read("link.md"), { ok: false, reason: "not-found" });
});

/// The workspace boundary, which binds a provider path exactly as it binds a local one.
///
/// A repository path is untrusted input in the same way: it reaches the shell from the renderer,
/// and `..` in one would name a file outside the repository just as surely as it would outside a
/// folder. The check is the domain's shared guard, never a second implementation here.
test("refuses a path that climbs out of the repository", async () => {
  const { opened } = await openFake();

  for (const path of ["../secrets.md", "docs/../../secrets.md", "/etc/passwd", "C:\\secrets.md"]) {
    const read = await opened.provider.read(path);
    assert.equal(read.ok, false, `${path} must be refused`);
    assert.equal(read.reason, "permission-denied", `${path} must be refused as permission-denied`);
  }
});

test("refuses a listing that climbs out of the repository", async () => {
  const { opened } = await openFake();
  assert.deepEqual(await opened.provider.list("../elsewhere"), {
    ok: false,
    reason: "permission-denied",
  });
});

// The same read boundary the local backend applies, and applied BEFORE the fetch: the size is in
// the tree, so a file too big to open never has to be downloaded to find that out.
test("refuses a file too large to open, without fetching it", async () => {
  const huge = [{ path: "big.md", mode: "100644", type: "blob", sha: "b9", size: MAX_TEXT_FILE_BYTES + 1 }];
  const { opened, calls } = await openFake({
    tree: async () => ({ ok: true, entries: huge, truncated: false }),
  });

  const read = await opened.provider.read("big.md");
  assert.equal(read.ok, false);
  assert.equal(read.reason, "too-large");
  assert.equal(read.limitBytes, MAX_TEXT_FILE_BYTES);
  assert.deepEqual(calls.blob, [], "nothing should have been downloaded");
});

// The same refusal the local backend gives for bytes that are not text this app can represent.
// Every backend meets the same file, so this is not a GitHub problem and does not get its own answer.
test("refuses a file whose bytes are not text", async () => {
  const { opened } = await openFake({
    blob: async () => ({ ok: true, bytes: Buffer.from([0x00, 0x01, 0x02]) }),
  });

  const read = await opened.provider.read("README.md");
  assert.equal(read.ok, false);
  assert.equal(read.reason, "not-text");
});

test("reads bytes for a picture without deciding what they are", async () => {
  const { opened } = await openFake();
  const read = await opened.provider.readBytes("README.md", 1024);

  assert.equal(read.ok, true);
  assert.equal(read.bytes.toString("utf8"), "hello");
});

test("refuses bytes over the caller's own limit", async () => {
  const { opened } = await openFake();
  const read = await opened.provider.readBytes("README.md", 2);

  assert.equal(read.ok, false);
  assert.equal(read.reason, "too-large");
  assert.equal(read.limitBytes, 2);
});

/// Writing is not built yet, and says so.
///
/// A save to GitHub is a commit on a branch, with history and merge conflicts rather than overwrite -
/// which is a feature, not a line of code. What matters until then is that the refusal is HONEST: an
/// editor that reported a save it never made is the failure the whole revision mechanism exists to
/// prevent, and a user would only discover it when their work was gone.
test("refuses to write, rather than reporting a save it did not make", async () => {
  const { opened } = await openFake();
  const written = await opened.provider.write("README.md", "changed", { id: "b1" });

  assert.deepEqual(written, { ok: false, reason: "unsupported" });
});

test("says when the tree GitHub sent was cut short", async () => {
  const { opened } = await openFake({
    tree: async () => ({ ok: true, entries: TREE, truncated: true }),
  });

  assert.equal(opened.truncated, true);
});
