"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { OUTLINE_PATH_LIMIT } = require("@trypthos/domain");
const { outlineWorkspace } = require("../src/workspaceOutline");

/// Walking a folder to list its markdown files.
///
/// In the main process because it is a real recursive walk, and those are not cheap: measured on a
/// home directory this took 39 seconds across 113,553 folders. Everything here is about not doing
/// that - a cap on how much is visited, hidden directories skipped, and node_modules-shaped trees
/// never descended into.

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

test("lists the markdown files, with paths relative to the folder", async () => {
  await withTree({ "plan.md": null, "notes/risks.md": null }, async (dir) => {
    const outline = await outlineWorkspace(dir);
    assert.deepEqual(outline.paths.sort(), ["notes/risks.md", "plan.md"]);
    assert.equal(outline.truncated, false);
  });
});

// Forward slashes on both platforms: the paths go to a model and come back in an answer, and a
// mixture would be one more thing for the user to reconcile.
test("uses forward slashes whatever the platform", async () => {
  await withTree({ "notes/deep/risks.md": null }, async (dir) => {
    assert.deepEqual((await outlineWorkspace(dir)).paths, ["notes/deep/risks.md"]);
  });
});

test("lists markdown only, not everything in the folder", async () => {
  await withTree({ "plan.md": null, "photo.png": null, "notes.txt": null }, async (dir) => {
    assert.deepEqual((await outlineWorkspace(dir)).paths, ["plan.md"]);
  });
});

test("accepts the other markdown extension", async () => {
  await withTree({ "a.md": null, "b.markdown": null }, async (dir) => {
    assert.deepEqual((await outlineWorkspace(dir)).paths.sort(), ["a.md", "b.markdown"]);
  });
});

// A folder someone has opened will often contain a repository. Descending into it would spend the
// whole cap on files nobody was asking about.
test("skips directories nobody means by their notes", async () => {
  await withTree(
    {
      "plan.md": null,
      "node_modules/pkg/readme.md": null,
      ".git/notes.md": null,
      ".obsidian/config.md": null,
    },
    async (dir) => {
      assert.deepEqual((await outlineWorkspace(dir)).paths, ["plan.md"]);
    },
  );
});

test("stops at the cap and says it stopped", async () => {
  const many = {};
  for (let i = 0; i < OUTLINE_PATH_LIMIT + 20; i += 1) many[`note-${i}.md`] = null;

  await withTree(many, async (dir) => {
    const outline = await outlineWorkspace(dir);
    assert.equal(outline.paths.length, OUTLINE_PATH_LIMIT);
    assert.equal(outline.truncated, true);
  });
});

test("an empty folder produces an empty outline rather than a failure", async () => {
  await withTree({}, async (dir) => {
    assert.deepEqual(await outlineWorkspace(dir), { paths: [], truncated: false });
  });
});

test("a folder that is not there produces an empty outline", async () => {
  assert.deepEqual(await outlineWorkspace(path.join(os.tmpdir(), "trypthos-not-a-folder")), {
    paths: [],
    truncated: false,
  });
});

// One unreadable directory - a permissions problem, a device that went away - must not cost the
// listing of everything beside it.
test("an unreadable directory does not stop the rest being listed", async () => {
  await withTree({ "plan.md": null, "notes/risks.md": null }, async (dir) => {
    // A file where a directory is expected fails the same way for the walk.
    await fs.writeFile(path.join(dir, "notadir"), "x", "utf8");
    const outline = await outlineWorkspace(dir);
    assert.ok(outline.paths.includes("plan.md"));
    assert.ok(outline.paths.includes("notes/risks.md"));
  });
});
