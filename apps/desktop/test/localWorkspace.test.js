"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MAX_TEXT_FILE_BYTES, createPathGuard } = require("@trypthos/domain");
const { createLocalWorkspace } = require("../src/localWorkspace");

/// Builds a real workspace on disk. These tests use the filesystem deliberately: the whole point of
/// this module is what happens when a path meets a real one, and a mocked fs would agree with
/// whatever assumption the code already makes.
async function makeWorkspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-test-"));
  await fs.mkdir(path.join(base, "workspace"), { recursive: true });
  await fs.mkdir(path.join(base, "outside"), { recursive: true });

  // realpath AFTER creating them, and on both: the temp directory is itself a symlink on macOS
  // (/var -> /private/var), so a root that is not already resolved would fail its own containment
  // check the moment a resolved path is compared against it.
  const root = await fs.realpath(path.join(base, "workspace"));
  const outside = await fs.realpath(path.join(base, "outside"));
  await fs.mkdir(path.join(root, "notes"));
  await fs.writeFile(path.join(root, "top.md"), "# Top\n", "utf8");
  await fs.writeFile(path.join(root, "notes", "nested.md"), "nested\n", "utf8");
  await fs.writeFile(path.join(outside, "secret.md"), "SECRET\n", "utf8");

  const workspace = createLocalWorkspace({
    root,
    guard: createPathGuard({ root, caseInsensitive: process.platform !== "linux" }),
  });

  return { base, root, outside, workspace };
}

async function withWorkspace(body) {
  const context = await makeWorkspace();
  try {
    await body(context);
  } finally {
    await fs.rm(context.base, { recursive: true, force: true });
  }
}

test("lists the workspace root, directories and files alike", async () => {
  await withWorkspace(async ({ workspace }) => {
    const result = await workspace.list("");
    assert.equal(result.ok, true);
    const names = result.nodes.map((n) => n.name).sort();
    assert.deepEqual(names, ["notes", "top.md"]);
    assert.equal(result.nodes.find((n) => n.name === "notes").kind, "directory");
  });
});

test("lists a subdirectory, giving each child a workspace-relative id", async () => {
  await withWorkspace(async ({ workspace }) => {
    const result = await workspace.list("notes");
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.nodes.map((n) => n.id),
      ["notes/nested.md"],
    );
  });
});

test("reads a file and reports a revision for it", async () => {
  await withWorkspace(async ({ workspace }) => {
    const result = await workspace.read("top.md");
    assert.equal(result.ok, true);
    assert.equal(result.content, "# Top\n");
    assert.ok(result.revision.id.length > 0);
  });
});

test("reports a missing file as not-found rather than throwing", async () => {
  await withWorkspace(async ({ workspace }) => {
    assert.deepEqual(await workspace.read("nope.md"), { ok: false, reason: "not-found" });
  });
});

test("writes when the caller presents the revision it last saw", async () => {
  await withWorkspace(async ({ workspace }) => {
    const opened = await workspace.read("top.md");
    const written = await workspace.write("top.md", "# Changed\n", opened.revision);

    assert.equal(written.ok, true);
    assert.notEqual(written.revision.id, opened.revision.id);
    assert.equal((await workspace.read("top.md")).content, "# Changed\n");
  });
});

test("refuses a write whose revision is stale, and says what is there now", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    const opened = await workspace.read("top.md");

    // Somebody else writes the file after it was opened. mtime has a coarse resolution on some
    // filesystems, so the size is changed too - the revision must differ for reasons of substance,
    // not because the test got lucky with a clock.
    await fs.writeFile(path.join(root, "top.md"), "# Someone else was here\n", "utf8");

    const result = await workspace.write("top.md", "# Mine\n", opened.revision);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "conflict");
    assert.ok(result.theirs.id);

    // The refusal must be total: their content survives untouched.
    assert.equal((await workspace.read("top.md")).content, "# Someone else was here\n");
  });
});

test("creates a new file when the caller presents no revision", async () => {
  await withWorkspace(async ({ workspace }) => {
    const result = await workspace.write("fresh.md", "new\n", null);
    assert.equal(result.ok, true);
    assert.equal((await workspace.read("fresh.md")).content, "new\n");
  });
});

test("refuses to create over a file that already exists", async () => {
  await withWorkspace(async ({ workspace }) => {
    const result = await workspace.write("top.md", "clobber\n", null);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "conflict");
    assert.equal((await workspace.read("top.md")).content, "# Top\n");
  });
});

test("refuses to update a file that has since been deleted", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    const opened = await workspace.read("top.md");
    await fs.rm(path.join(root, "top.md"));

    const result = await workspace.write("top.md", "resurrect\n", opened.revision);
    assert.deepEqual(result, { ok: false, reason: "not-found" });
  });
});

test("refuses a path that climbs out of the workspace", async () => {
  await withWorkspace(async ({ workspace }) => {
    assert.deepEqual(await workspace.read("../outside/secret.md"), {
      ok: false,
      reason: "permission-denied",
    });
  });
});

test("refuses an absolute path", async () => {
  await withWorkspace(async ({ workspace, outside }) => {
    const result = await workspace.read(path.join(outside, "secret.md"));
    assert.deepEqual(result, { ok: false, reason: "permission-denied" });
  });
});

test("refuses a write that climbs out of the workspace", async () => {
  await withWorkspace(async ({ workspace, outside }) => {
    const result = await workspace.write("../outside/secret.md", "overwritten\n", null);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "permission-denied");

    const untouched = await fs.readFile(path.join(outside, "secret.md"), "utf8");
    assert.equal(untouched, "SECRET\n");
  });
});

/// The check the lexical guard cannot make.
///
/// "escape/secret.md" is a perfectly ordinary relative path - it passes every string-level test.
/// Only resolving it on the real filesystem reveals that it leaves the workspace. A junction is used
/// rather than a symlink because Windows creates junctions without elevation, so this test runs
/// everywhere rather than being skipped on the platform most likely to need it.
test("refuses to read through a link that points outside the workspace", async () => {
  await withWorkspace(async ({ workspace, root, outside }) => {
    await fs.symlink(outside, path.join(root, "escape"), "junction");

    const result = await workspace.read("escape/secret.md");
    assert.deepEqual(result, { ok: false, reason: "permission-denied" });
  });
});

test("refuses to write through a link that points outside the workspace", async () => {
  await withWorkspace(async ({ workspace, root, outside }) => {
    await fs.symlink(outside, path.join(root, "escape"), "junction");

    const result = await workspace.write("escape/secret.md", "overwritten\n", null);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "permission-denied");
    assert.equal(await fs.readFile(path.join(outside, "secret.md"), "utf8"), "SECRET\n");
  });
});

test("refuses to create a NEW file through a link pointing outside the workspace", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    await fs.symlink(path.join(root, "..", "outside"), path.join(root, "escape2"), "junction");

    // The file does not exist, so its own realpath cannot be taken - the parent directory is what
    // gets checked. That branch is the one an attacker would aim at.
    const result = await workspace.write("escape2/planted.md", "planted\n", null);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "permission-denied");
  });
});

/// The read boundary.
///
/// Every case below is reachable with nothing but a rename, because the app decides what it can open
/// from an extension and nothing else. The one that matters most is the round trip: a file that is
/// opened and saved must come back byte for byte, and anything this module cannot promise that for
/// has to be refused rather than opened lossily next to a working Save button.

test("refuses a file larger than the cap, and says how large it is", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    const size = MAX_TEXT_FILE_BYTES + 1024;
    await fs.writeFile(path.join(root, "huge.md"), Buffer.alloc(size, 0x61));

    const result = await workspace.read("huge.md");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "too-large");
    assert.equal(result.sizeBytes, size);
    assert.equal(result.limitBytes, MAX_TEXT_FILE_BYTES);
  });
});

test("opens a file exactly at the cap", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    await fs.writeFile(path.join(root, "big.md"), Buffer.alloc(MAX_TEXT_FILE_BYTES, 0x61));

    const result = await workspace.read("big.md");
    assert.equal(result.ok, true);
    assert.equal(result.content.length, MAX_TEXT_FILE_BYTES);
  });
});

test("refuses a binary file even when its name says markdown", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    // PNG magic, then the bytes a header carries. Renaming a picture is all it takes to reach this.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    await fs.writeFile(path.join(root, "picture.md"), png);

    const result = await workspace.read("picture.md");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not-text");
  });
});

test("refuses a UTF-16 file rather than opening it as mojibake", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    // What Windows PowerShell writes by default, so a .log file meets this immediately.
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("# Notes\n", "utf16le")]);
    await fs.writeFile(path.join(root, "transcript.md"), utf16);

    const result = await workspace.read("transcript.md");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unsupported-encoding");
  });
});

test("refuses bytes that are not valid UTF-8 rather than substituting replacement characters", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    await fs.writeFile(path.join(root, "latin.md"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));

    const result = await workspace.read("latin.md");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unsupported-encoding");
  });
});

test("keeps a byte order mark across a read and a save", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    const file = path.join(root, "bom.md");
    await fs.writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# Top\n")]));

    const read = await workspace.read("bom.md");
    assert.equal(read.ok, true);
    // The editor never sees the mark: it would sit in front of the first heading, which then stops
    // being a heading.
    assert.equal(read.content, "# Top\n");

    const written = await workspace.write("bom.md", "# Top\n\nMore\n", read.revision);
    assert.equal(written.ok, true);

    // The mark is put back from what was on disk, never from anything the renderer said.
    const bytes = await fs.readFile(file);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(bytes.subarray(3).toString("utf8"), "# Top\n\nMore\n");
  });
});

test("does not add a byte order mark to a file that had none", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    const read = await workspace.read("top.md");
    assert.equal(read.ok, true);

    const written = await workspace.write("top.md", "# Top\n\nMore\n", read.revision);
    assert.equal(written.ok, true);

    const bytes = await fs.readFile(path.join(root, "top.md"));
    assert.equal(bytes[0], 0x23);
  });
});

test("creates a new file without a byte order mark", async () => {
  await withWorkspace(async ({ workspace, root }) => {
    const written = await workspace.write("fresh.md", "# Fresh\n", null);
    assert.equal(written.ok, true);

    const bytes = await fs.readFile(path.join(root, "fresh.md"));
    assert.equal(bytes[0], 0x23);
  });
});
