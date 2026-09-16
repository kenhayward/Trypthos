"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CREATE_CHARACTER_LIMIT, RECURSIVE_LIST_LIMIT, createPathGuard } = require("@trypthos/domain");
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

/// The two tools that DO something rather than answer something.
///
/// `create_file` is the only thing a model does to a user's disk without them pressing Apply, so its
/// bounds are the ones worth being sure of.
async function withActing(files, body) {
  await withFolder(files, async ({ root }) => {
    const provider = createLocalWorkspace({
      root,
      guard: createPathGuard({ root, caseInsensitive: process.platform !== "linux" }),
    });
    const opened = [];

    await body({
      opened,
      run: (folder, name, args) =>
        createFolderToolRunner({
          provider,
          folder,
          fileTypes: TYPES,
          openInTab: (file) => opened.push(file),
        })(name, JSON.stringify(args)),
      read: (file) => fs.readFile(path.join(root, file), "utf8"),
      root,
    });
  });
}

test("opens a file the user can then see", async () => {
  await withActing(TREE, async ({ run, opened }) => {
    const result = await run("docs", "open_file", { path: "docs/plan.md" });

    assert.match(result.content, /open in a tab/);
    assert.deepEqual(opened, ["docs/plan.md"]);
  });
});

test("refuses to open a file outside the attached folder", async () => {
  await withActing(TREE, async ({ run, opened }) => {
    assert.match((await run("docs", "open_file", { path: "other/secret.md" })).content, /outside/);
    assert.deepEqual(opened, []);
  });
});

// A tab for a file the user's own browser will not show them is a tab about a file they cannot open.
test("refuses to open a file type that is turned off", async () => {
  await withActing({ "docs/a.py": "x = 1\n" }, async ({ run, opened }) => {
    assert.match((await run("docs", "open_file", { path: "docs/a.py" })).content, /not a kind/);
    assert.deepEqual(opened, []);
  });
});

test("says so rather than opening a file that is not there", async () => {
  await withActing(TREE, async ({ run, opened }) => {
    assert.match((await run("docs", "open_file", { path: "docs/gone.md" })).content, /not there/);
    assert.deepEqual(opened, []);
  });
});

test("creates a new file, and opens it", async () => {
  await withActing(TREE, async ({ run, opened, read }) => {
    const result = await run("docs", "create_file", {
      path: "docs/new.md",
      content: "# New\n",
    });

    assert.match(result.content, /has been created/);
    assert.equal(await read("docs/new.md"), "# New\n");
    assert.deepEqual(opened, ["docs/new.md"]);
  });
});

test("creates without opening when asked not to", async () => {
  await withActing(TREE, async ({ run, opened }) => {
    await run("docs", "create_file", { path: "docs/new.md", content: "x", open: false });
    assert.deepEqual(opened, []);
  });
});

/// The bound that matters most. Enforced by the write itself - presenting no revision is how this
/// app says "there should be nothing here" - rather than by a check that could race it.
test("cannot replace a file that already exists", async () => {
  await withActing(TREE, async ({ run, read }) => {
    const result = await run("docs", "create_file", {
      path: "docs/plan.md",
      content: "REPLACED",
    });

    assert.match(result.content, /already exists/);
    assert.match(await read("docs/plan.md"), /# Plan/);
  });
});

test("cannot create outside the attached folder", async () => {
  await withActing(TREE, async ({ run, root }) => {
    const result = await run("docs", "create_file", { path: "other/planted.md", content: "x" });

    assert.match(result.content, /outside/);
    await assert.rejects(() => fs.stat(path.join(root, "other", "planted.md")));
  });
});

test("cannot create a file type the user has turned off", async () => {
  await withActing(TREE, async ({ run, root }) => {
    const result = await run("docs", "create_file", { path: "docs/run.sh", content: "rm -rf /" });

    assert.match(result.content, /not a kind/);
    await assert.rejects(() => fs.stat(path.join(root, "docs", "run.sh")));
  });
});

test("refuses a file longer than a person would read through", async () => {
  await withActing(TREE, async ({ run, root }) => {
    const result = await run("docs", "create_file", {
      path: "docs/huge.md",
      content: "x".repeat(CREATE_CHARACTER_LIMIT + 1),
    });

    assert.match(result.content, /longer than/);
    await assert.rejects(() => fs.stat(path.join(root, "docs", "huge.md")));
  });
});

/// Listing a whole tree in one call, so reaching the file that matters does not use up the tool calls
/// one question may make.
test("lists every readable file below a folder in one recursive call, as readable paths", async () => {
  await withFolder(TREE, async ({ run }) => {
    const result = await run("docs", "list_directory", { recursive: true });
    const lines = result.content.split("\n");

    // Workspace-relative, so each can be passed straight to get_file_contents.
    assert.ok(lines.includes("docs/plan.md"));
    assert.ok(lines.includes("docs/notes.txt"));
    assert.ok(lines.includes("docs/specs/api.md"));
    // Breadth first: the folder's own files before the ones a level down.
    assert.ok(lines.indexOf("docs/plan.md") < lines.indexOf("docs/specs/api.md"));
    assert.doesNotMatch(result.content, /other\/secret/);
  });
});

test("lists only the file types that are turned on, when recursive", async () => {
  await withFolder({ "src/a.md": "x", "src/deep/b.md": "x", "src/logo.png": "x" }, async ({ run }) => {
    const result = await run("src", "list_directory", { recursive: true });
    assert.match(result.content, /src\/deep\/b\.md/);
    assert.doesNotMatch(result.content, /logo\.png/);
  });
});

test("refuses to list recursively outside the attached folder", async () => {
  await withFolder(TREE, async ({ run }) => {
    const result = await run("docs", "list_directory", { path: "other", recursive: true });
    assert.match(result.content, /outside the folder/);
    assert.doesNotMatch(result.content, /secret/);
  });
});

// From a repository root, `.git` and `node_modules` are most of the tree. A recursive listing passes
// over them - and says so - while a direct listing of either still works.
test("passes over .git and node_modules when recursive, but not when listed directly", async () => {
  await withFolder(
    {
      "repo/src/app.md": "x",
      "repo/.github/ci.md": "x",
      "repo/node_modules/dep/readme.md": "x",
      "repo/.git/notes.md": "x",
    },
    async ({ run }) => {
      const walked = await run("repo", "list_directory", { recursive: true });
      assert.match(walked.content, /repo\/src\/app\.md/);
      assert.match(walked.content, /repo\/\.github\/ci\.md/);
      assert.doesNotMatch(walked.content, /node_modules\/dep/);
      assert.doesNotMatch(walked.content, /\.git\/notes/);
      assert.match(walked.content, /node_modules/);

      const direct = await run("repo", "list_directory", { path: "repo/node_modules/dep", recursive: true });
      assert.match(direct.content, /repo\/node_modules\/dep\/readme\.md/);
    },
  );
});

test("says when a recursive listing had to stop", async () => {
  const many = {};
  for (let i = 0; i <= RECURSIVE_LIST_LIMIT; i += 1) many[`big/f${String(i).padStart(4, "0")}.md`] = "x";

  await withFolder(many, async ({ run }) => {
    const result = await run("big", "list_directory", { recursive: true });
    const paths = result.content.split("\n").filter((line) => line.startsWith("big/"));
    assert.equal(paths.length, RECURSIVE_LIST_LIMIT);
    assert.match(result.content, /more/i);
  });
});

test("says when a recursive listing found nothing readable", async () => {
  await withFolder({ "art/logo.png": "x" }, async ({ run }) => {
    assert.match((await run("art", "list_directory", { recursive: true })).content, /no readable files/i);
  });
});

// A search from a repository root used to spend its whole file budget inside node_modules before it
// reached the code.
test("searches past node_modules and .git rather than into them", async () => {
  await withFolder(
    {
      "repo/src/app.md": "needle here\n",
      "repo/node_modules/dep/readme.md": "needle in a dependency\n",
      "repo/.git/notes.md": "needle in git\n",
    },
    async ({ run }) => {
      const result = await run("repo", "search_contents", { pattern: "needle" });
      assert.match(result.content, /repo\/src\/app\.md:1/);
      assert.doesNotMatch(result.content, /node_modules/);
      assert.doesNotMatch(result.content, /\.git/);
    },
  );
});
