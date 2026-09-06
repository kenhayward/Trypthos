"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createPathGuard } = require("@trypthos/domain");
const { createLocalWorkspace } = require("../src/localWorkspace");
const { createFolderToolRunner } = require("../src/folderToolRunner");

/// The tools that let a model look around the folder somebody attached.
///
/// Driven against a REAL workspace, because the thing worth testing is where they stop: both fences
/// are here, and a mocked provider would agree with whatever assumption the code already makes.

const TYPES = ["markdown", "text"];

async function withFolder(files, body) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-tools-"));
  await fs.mkdir(path.join(base, "workspace"));
  const root = await fs.realpath(path.join(base, "workspace"));

  try {
    for (const [file, contents] of Object.entries(files)) {
      const full = path.join(root, file);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, contents, "utf8");
    }

    const provider = createLocalWorkspace({
      root,
      guard: createPathGuard({ root, caseInsensitive: process.platform !== "linux" }),
    });

    await body({
      run: (folder, name, args) =>
        createFolderToolRunner({ provider, folder, fileTypes: TYPES })(name, JSON.stringify(args)),
      root,
    });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
}

const TREE = {
  "docs/plan.md": "# Plan\nA TODO here\nand more\n",
  "docs/specs/api.md": "# API\nnothing to see\n",
  "docs/notes.txt": "a todo in lower case\n",
  "other/secret.md": "TODO outside the folder\n",
};

test("lists a directory, sorted, with folders marked", async () => {
  await withFolder(TREE, async ({ run }) => {
    const result = await run("docs", "list_directory", {});

    assert.equal(result.ok, true);
    assert.match(result.content, /notes\.txt/);
    assert.match(result.content, /plan\.md/);
    assert.match(result.content, /specs\//);
    // Sorted, and sorted the same way twice: an unsorted listing changes between turns with nothing
    // having changed on disk, and a model cannot tell that from something moving.
    assert.ok(result.content.indexOf("notes.txt") < result.content.indexOf("plan.md"));
  });
});

test("lists a directory below the attached folder", async () => {
  await withFolder(TREE, async ({ run }) => {
    assert.match((await run("docs", "list_directory", { path: "docs/specs" })).content, /api\.md/);
  });
});

/// The second fence. The workspace guard is the first, and this is not instead of it: attaching a
/// folder is the consent gesture, and honouring it is the point.
test("refuses to list outside the attached folder", async () => {
  await withFolder(TREE, async ({ run }) => {
    const result = await run("docs", "list_directory", { path: "other" });
    assert.match(result.content, /outside the folder/);
    assert.doesNotMatch(result.content, /secret/);
  });
});

// The prefix trap, and the same answer as everywhere else: a whole segment, or "docs" contains
// "docs-archive".
test("refuses a sibling folder whose name merely starts the same", async () => {
  await withFolder({ ...TREE, "docs-archive/old.md": "old\n" }, async ({ run }) => {
    assert.match((await run("docs", "list_directory", { path: "docs-archive" })).content, /outside/);
  });
});

// With the whole workspace attached, the folder fence lets a climbing path through - and the
// workspace guard underneath refuses it. That is the point of having both: neither is the only one.
test("the workspace guard still applies underneath", async () => {
  await withFolder(TREE, async ({ run }) => {
    const result = await run("", "list_directory", { path: "../.." });

    assert.equal(result.ok, true);
    assert.match(result.content, /could not be listed/);
    // The refusal names the path the model asked for and nothing else. No entry from outside the
    // workspace reaches the model.
    assert.doesNotMatch(result.content, /workspace/);
  });
});

test("searches the folder and says which file and line each match is on", async () => {
  await withFolder(TREE, async ({ run }) => {
    const result = await run("docs", "search_contents", { pattern: "TODO" });

    assert.match(result.content, /docs\/plan\.md:2/);
    // Case-insensitive, because that is what searching a folder means.
    assert.match(result.content, /docs\/notes\.txt:1/);
    // And still bounded by the folder.
    assert.doesNotMatch(result.content, /other\/secret/);
  });
});

test("searches below the attached folder too", async () => {
  await withFolder(TREE, async ({ run }) => {
    assert.match((await run("docs", "search_contents", { pattern: "API" })).content, /specs\/api/);
  });
});

test("says so when nothing matched", async () => {
  await withFolder(TREE, async ({ run }) => {
    assert.match((await run("docs", "search_contents", { pattern: "zzz" })).content, /matched/);
  });
});

// Told, not guessed at. Falling back to a literal search would quietly answer a different question
// from the one that was asked.
test("says so when the pattern is not a valid expression", async () => {
  await withFolder(TREE, async ({ run }) => {
    const result = await run("docs", "search_contents", { pattern: "[unclosed" });
    assert.match(result.content, /not a valid regular expression/);
  });
});

// A search that returned files the browser will not show would be telling the model about files the
// user cannot open.
test("searches only the file types that are turned on", async () => {
  await withFolder({ "docs/a.md": "TODO\n", "docs/b.py": "TODO\n" }, async ({ run }) => {
    const result = await run("docs", "search_contents", { pattern: "TODO" });

    assert.match(result.content, /a\.md/);
    assert.doesNotMatch(result.content, /b\.py/);
  });
});

test("compares two files line by line", async () => {
  await withFolder({ "docs/a.md": "one\ntwo\n", "docs/b.md": "one\nTWO\n" }, async ({ run }) => {
    const result = await run("docs", "diff_files", { left: "docs/a.md", right: "docs/b.md" });

    assert.match(result.content, /-two/);
    assert.match(result.content, /\+TWO/);
  });
});

test("says when two files are the same", async () => {
  await withFolder({ "docs/a.md": "one\n", "docs/b.md": "one\n" }, async ({ run }) => {
    const result = await run("docs", "diff_files", { left: "docs/a.md", right: "docs/b.md" });
    assert.match(result.content, /identical/);
  });
});

test("refuses to compare a file outside the attached folder", async () => {
  await withFolder(TREE, async ({ run }) => {
    const result = await run("docs", "diff_files", {
      left: "docs/plan.md",
      right: "other/secret.md",
    });

    assert.match(result.content, /outside the folder/);
    assert.doesNotMatch(result.content, /TODO outside/);
  });
});

// Null is "nothing here carries out that name", which is different from a refusal - a refusal is an
// answer the model can act on.
test("answers null for a name it does not carry out", async () => {
  await withFolder(TREE, async ({ run }) => {
    assert.equal(await run("docs", "delete_everything", {}), null);
  });
});

// A model streams arguments as a string, so a call cut off mid-object is an ordinary outcome. Every
// one of these is an answer rather than a throw.
test("answers rather than throwing on a call it cannot read", async () => {
  await withFolder(TREE, async () => {
    for (const name of ["list_directory", "search_contents", "diff_files"]) {
      const result = await createFolderToolRunner({
        provider: { list: async () => ({ ok: true, nodes: [] }), read: async () => ({ ok: false }) },
        folder: "docs",
        fileTypes: TYPES,
      })(name, '{"path":"do');

      assert.equal(result.ok, true);
      assert.match(result.content, /could not be read/);
    }
  });
});
