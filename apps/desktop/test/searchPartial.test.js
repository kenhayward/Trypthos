"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { searchNames } = require("../src/nameSearch");
const { searchFiles } = require("../src/fileSearch");
const { outlineWorkspace } = require("../src/workspaceOutline");

/// A provider for Drive's shape: `listKnown` answers from what has been opened, `list` would go to
/// the network. The three walkers must prefer the first and say so when it was incomplete.

function file(id) {
  return { id, name: id.split("/").pop(), kind: "file" };
}
function dir(id) {
  return { id, name: id.split("/").pop(), kind: "directory" };
}

function drive({ listed, tree }) {
  const calls = { list: [], listKnown: [] };
  return {
    calls,
    provider: {
      kind: "google-drive",
      async list(path) {
        calls.list.push(path);
        return { ok: true, nodes: tree[path] ?? [] };
      },
      async listKnown(path) {
        calls.listKnown.push(path);
        return listed.has(path)
          ? { ok: true, nodes: tree[path] ?? [], complete: true }
          : { ok: true, nodes: [], complete: false };
      },
      async read(path) {
        return { ok: true, content: `needle in ${path}`, revision: { id: "r" } };
      },
    },
  };
}

const TREE = { "": [file("a.md"), dir("Opened"), dir("Unopened")], Opened: [file("Opened/b.md")] };

test("the filter walks with listKnown only, and reports a folder it could not see", async () => {
  const { provider, calls } = drive({ listed: new Set(["", "Opened"]), tree: TREE });
  const result = await searchNames(provider, { path: "", filter: "md" });
  assert.deepEqual(result.paths.sort(), ["Opened/b.md", "a.md"]);
  assert.equal(result.partial, true);
  assert.deepEqual(calls.list, []);
});

test("the filter reports no partial when every folder was known", async () => {
  const { provider } = drive({ listed: new Set(["", "Opened", "Unopened"]), tree: TREE });
  const result = await searchNames(provider, { path: "", filter: "md" });
  assert.equal(result.partial, undefined);
});

test("Find in Files reads known folders only, and reports partial", async () => {
  const { provider, calls } = drive({ listed: new Set(["", "Opened"]), tree: TREE });
  const result = await searchFiles(provider, { path: "", pattern: "needle", regex: false, caseSensitive: false, fileTypes: ["markdown"] });
  assert.equal(result.ok, true);
  assert.equal(result.hits.length, 2);
  assert.equal(result.partial, true);
  assert.deepEqual(calls.list, []);
});

test("the outline lists with listKnown and reports partial when the folder was never opened", async () => {
  const { provider, calls } = drive({ listed: new Set(), tree: TREE });
  const outline = await outlineWorkspace(provider, { path: "", fileTypes: ["markdown"] });
  assert.equal(outline.partial, true);
  assert.deepEqual(calls.list, []);
});

test("the outline of an opened folder is not partial", async () => {
  const { provider } = drive({ listed: new Set([""]), tree: TREE });
  const outline = await outlineWorkspace(provider, { path: "", fileTypes: ["markdown"] });
  assert.deepEqual(outline.paths, ["a.md"]);
  assert.equal(outline.partial, undefined);
});

test("a provider without listKnown is walked with list and never partial", async () => {
  const calls = [];
  const provider = {
    async list(path) {
      calls.push(path);
      return { ok: true, nodes: TREE[path] ?? [] };
    },
    async read() {
      return { ok: true, content: "x", revision: { id: "r" } };
    },
  };
  const names = await searchNames(provider, { path: "", filter: "md" });
  assert.equal("partial" in names, false);
  assert.ok(calls.length > 0);
  const outline = await outlineWorkspace(provider, { path: "", fileTypes: ["markdown"] });
  assert.equal("partial" in outline, false);
  const found = await searchFiles(provider, { path: "", pattern: "x", regex: false, caseSensitive: false, fileTypes: ["markdown"] });
  assert.equal("partial" in found, false);
});
