"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PROVIDER_KINDS } = require("@trypthos/domain");
const { openWorkspaceFor, PROVIDER_OPENERS } = require("../src/providers");

/// The registry, and the promise it makes to everything above it.

/// The guard that catches a provider added to the schema and never wired up here - which would be a
/// source the picker offers and the shell cannot open.
test("every provider kind the domain names can be opened", () => {
  const missing = PROVIDER_KINDS.filter((kind) => typeof PROVIDER_OPENERS[kind] !== "function");
  assert.deepEqual(missing, []);
});

test("opens a local folder and names it after the folder", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-registry-"));
  try {
    const opened = await openWorkspaceFor({ kind: "local", root: dir });

    assert.equal(opened.ok, true);
    assert.equal(opened.workspace.name, path.basename(dir));
    assert.equal(opened.workspace.root, dir);
    assert.equal(typeof opened.workspace.provider.list, "function");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// A remembered folder can have been deleted, renamed, or written on another machine entirely.
test("refuses a local folder that is no longer there", async () => {
  const opened = await openWorkspaceFor({ kind: "local", root: path.join(os.tmpdir(), "no-such-folder-here") });
  assert.deepEqual(opened, { ok: false, reason: "not-found" });
});

test("refuses a local root that is a file rather than a folder", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-registry-"));
  const file = path.join(dir, "notes.md");
  try {
    await fs.writeFile(file, "hello", "utf8");
    assert.deepEqual(await openWorkspaceFor({ kind: "local", root: file }), {
      ok: false,
      reason: "not-found",
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("opens a GitHub repository and names it after the repository", async () => {
  const github = {
    defaultBranchHead: async () => ({ ok: true, branch: "main", sha: "c0ffee" }),
    tree: async () => ({ ok: true, entries: [], truncated: false }),
    blob: async () => ({ ok: false, reason: "not-found" }),
  };

  const opened = await openWorkspaceFor({ kind: "github", owner: "ada", repo: "notes" }, { github });

  assert.equal(opened.ok, true);
  assert.equal(opened.workspace.name, "notes");
  assert.equal(opened.workspace.branch, "main");
});

/// The field that carries the whole difference between the providers.
///
/// A repository has no folder on disk, so Save As has nowhere to open a dialog and the recent-files
/// list has nothing to record. Null says that; a made-up path would be a place the app would then
/// try to write to.
test("a GitHub repository has no root, and says so", async () => {
  const github = {
    defaultBranchHead: async () => ({ ok: true, branch: "main", sha: "c0ffee" }),
    tree: async () => ({ ok: true, entries: [], truncated: false }),
  };

  const opened = await openWorkspaceFor({ kind: "github", owner: "ada", repo: "notes" }, { github });
  assert.equal(opened.workspace.root, null);
});

test("reports a repository that cannot be opened", async () => {
  const github = {
    defaultBranchHead: async () => ({ ok: false, reason: "permission-denied" }),
    tree: async () => {
      throw new Error("must not be reached");
    },
  };

  assert.deepEqual(await openWorkspaceFor({ kind: "github", owner: "ada", repo: "x" }, { github }), {
    ok: false,
    reason: "permission-denied",
  });
});

// A settings file written by a newer build can name a provider this one has never heard of. That is
// a folder which does not open, which is far better than a guess about what it meant.
test("refuses a provider this build does not know", async () => {
  assert.deepEqual(await openWorkspaceFor({ kind: "dropbox", accountId: "1" }), {
    ok: false,
    reason: "unsupported",
  });
});
