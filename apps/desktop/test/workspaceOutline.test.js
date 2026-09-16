"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DEFAULT_OUTLINE_FILE_LIMIT, OUTLINE_PATH_LIMIT } = require("@trypthos/domain");
const { createPathGuard } = require("@trypthos/domain");
const { createLocalWorkspace } = require("../src/localWorkspace");
const { outlineWorkspace } = require("../src/workspaceOutline");

/// Most of these cases are about the walk - one level, sorting, the cap, a folder that is not there
/// - and say nothing about file types, so they run against what a fresh installation has. The cases
/// that ARE about file types name their own list.
/// A real guarded provider over a real directory, because what this walks and what it REFUSES to
/// walk are the same question - the folder is a path from the renderer.
function providerFor(root) {
  return createLocalWorkspace({
    root,
    guard: createPathGuard({ root, caseInsensitive: process.platform !== "linux" }),
  });
}

function outlineOf(root, options = {}) {
  return outlineWorkspace(providerFor(root), { path: "", fileTypes: ["markdown"], ...options });
}

/// The files and folders chat is shown when a folder is attached - the model's map of it.
///
/// One level only. It is NOT what the model may read: that is any enabled file inside the attached
/// folder, checked in the main process when a read is asked for (`readForModel` in ipcHandlers). A
/// file below this list can be read once the model knows its path.

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
    assert.deepEqual(await outlineOf(dir), { path: "", paths: [], folders: [], truncated: false });
  });
});

test("a folder that is not there produces an empty outline", async () => {
  assert.deepEqual(await outlineOf(path.join(os.tmpdir(), "trypthos-not-a-folder")), { path: "", paths: [], folders: [], truncated: false });
});

/// A type the user has turned off is not shown - and is refused when read, separately, in the main
/// process.
test("offers only the file types that are turned on", async () => {
  await withTree({ "plan.md": null, "notes.txt": null, "logo.png": null }, async (dir) => {
    assert.deepEqual((await outlineOf(dir)).paths, ["plan.md"]);
    assert.deepEqual((await outlineOf(dir, { fileTypes: ["markdown", "text"] })).paths, [
      "notes.txt",
      "plan.md",
    ]);
  });
});

/// The outline follows the folder the user selected in the tree, not always the workspace root.
///
/// The folder is a path from the renderer, so it goes through the same guarded provider every other
/// path does - the boundary is the workspace root, not the folder.
test("walks the folder it was given, not the root", async () => {
  await withTree({ "top.md": null, "notes/inner.md": null, "notes/deep/far.md": null }, async (dir) => {
    assert.deepEqual((await outlineOf(dir)).paths, ["top.md"]);
    assert.deepEqual((await outlineOf(dir, { path: "notes" })).paths, ["notes/inner.md"]);
  });
});

test("names paths from the workspace root, so a file can be read back", async () => {
  await withTree({ "notes/inner.md": null }, async (dir) => {
    const outline = await outlineOf(dir, { path: "notes" });
    assert.deepEqual(outline.paths, ["notes/inner.md"]);
    assert.equal(outline.path, "notes");
  });
});

test("refuses a folder that climbs out of the workspace", async () => {
  await withTree({ "top.md": null }, async (dir) => {
    assert.deepEqual(await outlineOf(dir, { path: "../.." }), { path: "", paths: [], folders: [], truncated: false });
  });
});

test("answers empty for a folder that is not there", async () => {
  await withTree({ "top.md": null }, async (dir) => {
    const outline = await outlineOf(dir, { path: "nowhere" });
    assert.deepEqual(outline.paths, []);
  });
});

/// The folders directly inside, so the model knows there is more than the top-level files.
///
/// Without them a model pointed at a repository root saw a README and a lock file, and nothing to say
/// the code was one level down.
test("names the folders directly inside, from the workspace root", async () => {
  await withTree(
    { "top.md": null, "src/app.md": null, "docs/guide/deep.md": null, "docs/intro.md": null },
    async (dir) => {
      const outline = await outlineOf(dir);
      assert.deepEqual(outline.paths, ["top.md"]);
      // One level: "docs/guide" is not named here.
      assert.deepEqual(outline.folders, ["docs", "src"]);

      assert.deepEqual((await outlineOf(dir, { path: "docs" })).folders, ["docs/guide"]);
    },
  );
});

// Named whatever types are on: a folder of Python files is still somewhere a markdown-only model's
// user may want it to look.
test("names a folder whatever file types are turned on", async () => {
  await withTree({ "photos/logo.png": null }, async (dir) => {
    assert.deepEqual((await outlineOf(dir)).folders, ["photos"]);
  });
});

// Version control internals and installed dependencies are most of the files in a repository and
// none of the ones anybody asked about. `.github` is not among them.
test("leaves out .git and node_modules, but not other dot-folders", async () => {
  await withTree(
    { ".git/HEAD": null, "node_modules/x/index.md": null, ".github/ci.md": null, "src/a.md": null },
    async (dir) => {
      assert.deepEqual((await outlineOf(dir)).folders, [".github", "src"]);
    },
  );
});

test("names no more folders than the wire allows, and says it stopped", async () => {
  const many = {};
  for (let i = 0; i < OUTLINE_PATH_LIMIT + 3; i += 1) many[`f${String(i).padStart(3, "0")}/a.md`] = null;

  await withTree(many, async (dir) => {
    const outline = await outlineOf(dir);
    assert.equal(outline.folders.length, OUTLINE_PATH_LIMIT);
    assert.equal(outline.truncated, true);
  });
});
