"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const here = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));

/// Everything src/ requires from outside itself must be declared as a dependency.
///
/// This is the check that was missing when every release up to 0.8.0 shipped an app that died on
/// launch with "Cannot find module '@trypthos/domain'". Running from source hides it completely:
/// npm workspaces hoist packages to the repo root, so an UNDECLARED dependency resolves perfectly
/// well in development and is simply absent once packaged, because electron-builder has no reason to
/// bundle something nothing claims to need.
///
/// Static, so it runs in ordinary CI rather than only on a tag.

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

/// Bare specifiers only: "./thing" is a local file, "node:fs" and "electron" are provided by the
/// runtime rather than by node_modules.
const BUILT_IN = new Set(["electron"]);

function externalRequires() {
  const found = new Map();
  for (const file of sourceFiles(path.join(here, "src"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/require\(\s*"([^"]+)"\s*\)/g)) {
      const id = match[1];
      if (id.startsWith(".") || id.startsWith("node:") || BUILT_IN.has(id)) continue;
      found.set(id, [...(found.get(id) ?? []), path.relative(here, file)]);
    }
  }
  return found;
}

test("every module the shell requires is declared as a dependency", () => {
  const declared = new Set(Object.keys(manifest.dependencies ?? {}));
  const missing = [...externalRequires().entries()]
    .filter(([id]) => !declared.has(id))
    .map(([id, files]) => `${id} (required by ${files.join(", ")})`);

  assert.deepEqual(missing, [], "undeclared dependencies are absent from the packaged app");
});

test("dependencies are runtime, not dev", () => {
  // A runtime requirement listed under devDependencies is not packaged either - the same failure
  // wearing a different hat.
  const dev = Object.keys(manifest.devDependencies ?? {});
  for (const id of externalRequires().keys()) {
    assert.ok(!dev.includes(id), `${id} is required at runtime but listed under devDependencies`);
  }
});
