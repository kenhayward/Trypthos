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

/// Writing, before anywhere has been chosen to write TO.
///
/// A save to GitHub is a commit on a branch, and until the user has said which branch there is no
/// answer to where it goes. Refused rather than guessed at: committing to the default branch by
/// default is how somebody pushes to main without meaning to.
test("refuses to write until a branch has been chosen", async () => {
  const { opened } = await openFake();
  const written = await opened.provider.write("README.md", "changed", { id: "b1" });

  assert.deepEqual(written, { ok: false, reason: "no-branch" });
});

test("says when the tree GitHub sent was cut short", async () => {
  const { opened } = await openFake({
    tree: async () => ({ ok: true, entries: TREE, truncated: true }),
  });

  assert.equal(opened.truncated, true);
});

/// Committing, once somewhere has been chosen.
///
/// The awkward part is not the request - that is one call. It is everything the workspace has to
/// put right afterwards: it is pinned to a commit and holds the whole tree in memory, and both are
/// stale the moment a commit lands. Get that wrong and the bug is the worst kind - save, reopen the
/// file, and read your old text back.

function writingApi(overrides = {}) {
  const { api, calls } = fakeApi();
  const written = [];

  return {
    written,
    calls,
    api: {
      ...api,
      createBranch: async (_owner, _repo, name, sha) => ({ ok: true, branch: name, sha }),
      putFile: async (request) => {
        written.push(request);
        return { ok: true, blobSha: "b1-new", commitSha: "commit-2" };
      },
      branches: async () => ({
        ok: true,
        branches: [
          { name: "main", sha: "c0ffee" },
          { name: "trunk", sha: "decaf" },
        ],
      }),
      ...overrides,
    },
  };
}

async function openWritable(overrides) {
  const { api, written, calls } = writingApi(overrides);
  const opened = await openGitHubWorkspace({ ref: REF, api });
  return { provider: opened.provider, written, calls };
}

test("starts a branch at the commit the workspace is pinned to", async () => {
  const started = [];
  const { provider } = await openWritable({
    createBranch: async (_owner, _repo, name, sha) => {
      started.push({ name, sha });
      return { ok: true, branch: name, sha };
    },
  });

  const result = await provider.startBranch("trypthos/update-readme");

  assert.deepEqual(result, { ok: true, branch: "trypthos/update-readme" });
  // The commit the tree in memory describes. A branch cut from anywhere else would be a branch
  // whose files are not the files on screen.
  assert.deepEqual(started, [{ name: "trypthos/update-readme", sha: "c0ffee" }]);
  assert.equal(provider.writeTarget().branch, "trypthos/update-readme");
});

// A new branch points at the same commit, so the tree is the same tree. Refetching it would be a
// request whose answer is already in memory.
test("does not refetch the tree for a branch cut from where it stands", async () => {
  let trees = 0;
  const { provider } = await openWritable({
    tree: async () => {
      trees += 1;
      return { ok: true, entries: TREE, truncated: false };
    },
  });

  await provider.startBranch("trypthos/update-readme");
  assert.equal(trees, 1, "the tree fetched at open is still the right one");
});

test("commits a save to the chosen branch", async () => {
  const { provider, written } = await openWritable();
  await provider.startBranch("trypthos/update-readme");

  const result = await provider.write("README.md", "changed", { id: "b1" }, { message: "Update" });

  assert.deepEqual(result, { ok: true, revision: { id: "b1-new" } });
  assert.equal(written[0].path, "README.md");
  assert.equal(written[0].branch, "trypthos/update-readme");
  assert.equal(written[0].sha, "b1");
  assert.equal(written[0].message, "Update");
  assert.equal(written[0].bytes.toString(), "changed");
});

/// The bug this exists to prevent.
///
/// The tree is fetched once at open and every listing is a read of memory, so the blob sha for a
/// path is whatever it was when the repository opened. Leave it there after a commit and the next
/// read of that file fetches the OLD blob - the user saves, reopens, and their work is gone.
test("reads back what was just written, not what was there before", async () => {
  const { provider, calls } = await openWritable();
  await provider.startBranch("trypthos/update-readme");
  await provider.write("README.md", "changed", { id: "b1" }, { message: "Update" });

  const read = await provider.read("README.md");

  assert.equal(read.ok, true);
  assert.equal(read.content, "changed");
  assert.equal(read.revision.id, "b1-new");
  // And it came from memory rather than from another request: the bytes that were just written are
  // the bytes that are there.
  assert.equal(calls.blob.includes("b1-new"), false, "the new blob should not be fetched back");
});

// The workspace is pinned to a commit, and a commit moved it. A branch cut after this one has to
// start from the new head or it would leave the change behind.
test("advances the pin to the commit it just made", async () => {
  const started = [];
  const { provider } = await openWritable({
    createBranch: async (_owner, _repo, name, sha) => {
      started.push(sha);
      return { ok: true, branch: name, sha };
    },
  });

  await provider.startBranch("one");
  await provider.write("README.md", "changed", { id: "b1" }, { message: "m" });
  await provider.startBranch("two");

  assert.deepEqual(started, ["c0ffee", "commit-2"]);
});

/// A mark the editor never showed must not be lost by saving.
///
/// The same rule the local backend follows, reached the same way: the mark is read from what is
/// STORED - the bytes being replaced - never carried by the renderer, which is untrusted and has no
/// business asserting a file's encoding.
test("keeps a byte order mark the file already had", async () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello")]);
  const { api } = writingApi();
  const written = [];

  const opened = await openGitHubWorkspace({
    ref: REF,
    api: {
      ...api,
      blob: async () => ({ ok: true, bytes: withBom }),
      putFile: async (request) => {
        written.push(request);
        return { ok: true, blobSha: "b1-new", commitSha: "commit-2" };
      },
    },
  });

  await opened.provider.startBranch("trypthos/update-readme");
  // Read first, which is what an editor does before it can have edited anything.
  await opened.provider.read("README.md");
  await opened.provider.write("README.md", "changed", { id: "b1" }, { message: "m" });

  assert.deepEqual([...written[0].bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(written[0].bytes.subarray(3).toString(), "changed");
});

test("passes a conflict straight through rather than resolving it", async () => {
  const { provider } = await openWritable({
    putFile: async () => ({ ok: false, reason: "conflict", theirs: "theirs" }),
  });
  await provider.startBranch("trypthos/update-readme");

  const result = await provider.write("README.md", "changed", { id: "b1" }, { message: "m" });

  assert.deepEqual(result, { ok: false, reason: "conflict", theirs: { id: "theirs" } });
});

// A refused write must leave everything exactly as it was. A pin advanced on a commit that never
// happened would make the next save conflict against a commit nobody made.
test("changes nothing when the commit was refused", async () => {
  const { provider } = await openWritable({
    putFile: async () => ({ ok: false, reason: "read-only-token" }),
  });
  await provider.startBranch("trypthos/update-readme");

  const result = await provider.write("README.md", "changed", { id: "b1" }, { message: "m" });
  assert.deepEqual(result, { ok: false, reason: "read-only-token" });

  const read = await provider.read("README.md");
  assert.equal(read.content, "hello", "the file is still what GitHub holds");
});

/// Moving to a branch that already exists.
///
/// Not the same as cutting one: that branch is at a different commit, so its tree is a different
/// tree and has to be fetched. The workspace follows, because commits going somewhere the browser
/// cannot see is how Find in Files ends up searching one branch while the edits are on another.
test("switches to an existing branch, and takes the tree with it", async () => {
  const OTHER = [{ path: "README.md", mode: "100644", type: "blob", sha: "other-b1", size: 5 }];
  const asked = [];
  const { provider } = await openWritable({
    tree: async (_owner, _repo, sha) => {
      asked.push(sha);
      return { ok: true, entries: sha === "decaf" ? OTHER : TREE, truncated: false };
    },
  });

  const result = await provider.useBranch("trunk");

  assert.deepEqual(result, { ok: true, branch: "trunk" });
  assert.deepEqual(asked, ["c0ffee", "decaf"]);
  const listed = await provider.list("");
  assert.deepEqual(
    listed.nodes.map((node) => node.name),
    ["README.md"],
  );
});

test("refuses a branch that is not there rather than pretending to move", async () => {
  const { provider } = await openWritable();
  assert.deepEqual(await provider.useBranch("nowhere"), { ok: false, reason: "not-found" });
  assert.equal(provider.writeTarget().branch, null);
});

// Nothing has been chosen at open. The dialog is what chooses, and it needs to know that.
test("starts with nowhere to write to, and says which branch it is reading", async () => {
  const { provider } = await openWritable();
  assert.deepEqual(provider.writeTarget(), { branch: null, readingBranch: "main" });
});
