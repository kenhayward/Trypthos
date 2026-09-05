"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DEFAULT_OUTLINE_FILE_LIMIT } = require("@trypthos/domain");
const { outlineWorkspace } = require("../src/workspaceOutline");

/// Most of these cases are about the walk - one level, sorting, the cap, a folder that is not there
/// - and say nothing about file types, so they run against what a fresh installation has. The cases
/// that ARE about file types name their own list.
function outlineOf(root, options = {}) {
  return outlineWorkspace(root, { fileTypes: ["markdown"], ...options });
}

/// The files chat is offered, and may then ask to read.
///
/// One level only, and this list is also the allowlist - so a file that does not appear here cannot
/// be read by the model at all. That makes "what does this return" a security question as much as a
/// usability one.

async function withTree(files, body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-outline-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(dir, file);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content ?? "x", "utf8");
    }
    await body(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("lists the markdown files at the top level", async () => {
  await withTree({ "plan.md": null, "risks.md": null }, async (dir) => {
    const outline = await outlineOf(dir);
    assert.deepEqual(outline.paths, ["plan.md", "risks.md"]);
    assert.equal(outline.truncated, false);
  });
});

// Not a recursive walk. A menu the model orders from wants to be short and predictable, and a
// recursive walk of a large folder is neither - measured at 39 seconds on a home directory.
test("does not descend into subfolders", async () => {
  await withTree({ "plan.md": null, "notes/risks.md": null }, async (dir) => {
    assert.deepEqual((await outlineOf(dir)).paths, ["plan.md"]);
  });
});

test("lists markdown only, not everything in the folder", async () => {
  await withTree({ "plan.md": null, "photo.png": null, "notes.txt": null }, async (dir) => {
    assert.deepEqual((await outlineOf(dir)).paths, ["plan.md"]);
  });
});

test("accepts the other markdown extension", async () => {
  await withTree({ "a.md": null, "b.markdown": null }, async (dir) => {
    assert.deepEqual((await outlineOf(dir)).paths, ["a.md", "b.markdown"]);
  });
});

// The same folder must produce the same menu twice running, or which files the model can read would
// drift between turns with nothing having changed.
test("is in a stable order", async () => {
  await withTree({ "c.md": null, "a.md": null, "b.md": null }, async (dir) => {
    assert.deepEqual((await outlineOf(dir)).paths, ["a.md", "b.md", "c.md"]);
  });
});

test("names no more files than it was asked for, and says it stopped", async () => {
  await withTree({ "a.md": null, "b.md": null, "c.md": null }, async (dir) => {
    const outline = await outlineOf(dir, { limit: 2 });
    assert.deepEqual(outline.paths, ["a.md", "b.md"]);
    assert.equal(outline.truncated, true);
  });
});

test("defaults to a short menu rather than a complete one", async () => {
  const many = {};
  for (let i = 0; i < DEFAULT_OUTLINE_FILE_LIMIT + 5; i += 1) {
    many[`note-${String(i).padStart(2, "0")}.md`] = null;
  }

  await withTree(many, async (dir) => {
    const outline = await outlineOf(dir);
    assert.equal(outline.paths.length, DEFAULT_OUTLINE_FILE_LIMIT);
    assert.equal(outline.truncated, true);
  });
});

test("an empty folder produces an empty outline rather than a failure", async () => {
  await withTree({}, async (dir) => {
    assert.deepEqual(await outlineOf(dir), { paths: [], truncated: false });
  });
});

test("a folder that is not there produces an empty outline", async () => {
  assert.deepEqual(await outlineOf(path.join(os.tmpdir(), "trypthos-not-a-folder")), {
    paths: [],
    truncated: false,
  });
});

/// This list is the allowlist, so which file types are on decides what the model may read - not just
/// what it is shown. A type the user has turned off is a file chat cannot ask for.
test("offers only the file types that are turned on", async () => {
  await withTree({ "plan.md": null, "notes.txt": null, "logo.png": null }, async (dir) => {
    assert.deepEqual((await outlineOf(dir)).paths, ["plan.md"]);
    assert.deepEqual((await outlineOf(dir, { fileTypes: ["markdown", "text"] })).paths, [
      "notes.txt",
      "plan.md",
    ]);
  });
});
