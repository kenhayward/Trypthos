"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { builtIndexPath } = require("../src/builtIndex");

test("reads from the app workspace when running from the repo", () => {
  const result = builtIndexPath({ isPackaged: false, shellDir: path.join("/repo", "apps", "desktop", "src") });
  assert.equal(result, path.join("/repo", "apps", "desktop", "src", "..", "..", "app", "dist", "index.html"));
});

test("reads from resources when packaged", () => {
  const result = builtIndexPath({ isPackaged: true, resourcesPath: path.join("/opt", "Trypthos", "resources") });
  assert.equal(result, path.join("/opt", "Trypthos", "resources", "app", "index.html"));
});

test("ignores the shell directory when packaged", () => {
  const result = builtIndexPath({ isPackaged: true, resourcesPath: "/res", shellDir: "/somewhere/else" });
  assert.ok(!result.includes("else"));
});
