"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createIgnoreRules, DENIED_DIRECTORIES } = require("../src/folderIgnore");

/// What a folder's graph leaves out.
///
/// A vault is curated; an arbitrary folder is not. Measured on this repository, 11 markdown files
/// sit outside node_modules and 1,117 inside it, so without these rules a folder's graph is a graph
/// of dependency READMEs.

test("skips the build and dependency folders wherever they sit", () => {
  const rules = createIgnoreRules(null);
  for (const path of ["node_modules", "packages/app/node_modules", "dist", "a/b/build", "target", "vendor", "__pycache__"]) {
    assert.equal(rules.skipsDirectory(path), true, path);
  }
});

test("matches a whole directory name, never a substring", () => {
  const rules = createIgnoreRules(null);
  assert.equal(rules.skipsDirectory("builds"), false);
  assert.equal(rules.skipsDirectory("my_node_modules_notes"), false);
  assert.equal(rules.skipsDirectory("distribution"), false);
});

// A Windows disk does not care about case, and a rule that did would miss the folder only for some
// people - the kind of failure nobody reproduces.
test("ignores case in the directory list", () => {
  const rules = createIgnoreRules(null);
  assert.equal(rules.skipsDirectory("Node_Modules"), true);
  assert.equal(rules.skipsDirectory("docs/BUILD"), true);
});

test("applies the folder's own .gitignore", () => {
  const rules = createIgnoreRules("drafts/\n*.tmp.md\n!keep.tmp.md\n");
  assert.equal(rules.skipsDirectory("drafts"), true);
  assert.equal(rules.skipsFile("notes/scratch.tmp.md"), true);
  assert.equal(rules.skipsFile("notes/keep.tmp.md"), false);
  assert.equal(rules.skipsFile("notes/plan.md"), false);
});

// `ignore` only matches a directory-only pattern when the path it is asked about ends in a slash.
// Asking about `drafts` rather than `drafts/` answers false, and the whole folder is walked.
test("asks about a directory as a directory", () => {
  const rules = createIgnoreRules("drafts/\n");
  assert.equal(rules.skipsDirectory("drafts"), true);
  assert.equal(rules.skipsDirectory("a/drafts"), true);
});

// The floor is beneath the .gitignore, not beside it. A .gitignore that does not mention
// node_modules - a nested package, a repository that vendors its dependencies - must not let the
// whole problem back in.
test("keeps the floor when the .gitignore does not mention it", () => {
  const rules = createIgnoreRules("*.log\n");
  assert.equal(rules.skipsDirectory("node_modules"), true);
});

test("keeps the floor for a .gitignore that says nothing useful", () => {
  const rules = createIgnoreRules("[[[ not a real pattern\n");
  assert.equal(rules.skipsDirectory("node_modules"), true);
  assert.equal(rules.skipsFile("notes/plan.md"), false);
});

test("never throws on a path the ignore package would refuse", () => {
  const rules = createIgnoreRules("*.md\n");
  assert.equal(rules.skipsFile(""), false);
  assert.equal(rules.skipsFile("/absolute.md"), false);
});

test("lists the floor in lower case, so lookups can be too", () => {
  for (const name of DENIED_DIRECTORIES) assert.equal(name, name.toLowerCase());
  assert.ok(DENIED_DIRECTORIES.has("node_modules"));
});
