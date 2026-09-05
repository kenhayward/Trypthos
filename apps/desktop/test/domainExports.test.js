"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const domain = require("@trypthos/domain");

/// Everything the shell destructures from the domain must actually be there.
///
/// This exists because it was not, and nothing noticed for two releases. `OutlineRequest` was added
/// to `ipc.ts` and never exported from the barrel, so `ipcHandlers.js` bound `undefined` and the
/// handler threw on its first line - which the renderer swallowed, leaving chat's folder silently
/// empty.
///
/// Nothing else can catch it. The shell is plain CommonJS, so TypeScript sees none of it; a missing
/// export is not a syntax error, not a lint error, and not a failure until the one line that uses it
/// runs. The two sides of this boundary are a `.ts` barrel and a `.js` require, and only a test
/// stands between them.

const SRC = path.join(__dirname, "..", "src");

/// The names one file destructures from the domain, from a `const { ... } = require(...)`.
function importedNames(source) {
  const match = /const\s*\{([^}]*)\}\s*=\s*require\("@trypthos\/domain"\)/s.exec(source);
  if (match === null) return [];

  return match[1]
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter((name) => name !== "");
}

function shellFiles() {
  return fs
    .readdirSync(SRC)
    .filter((entry) => entry.endsWith(".js"))
    .map((entry) => path.join(SRC, entry));
}

test("every name the shell imports from the domain is exported by it", () => {
  const missing = [];

  for (const file of shellFiles()) {
    for (const name of importedNames(fs.readFileSync(file, "utf8"))) {
      if (domain[name] === undefined) missing.push(`${path.basename(file)}: ${name}`);
    }
  }

  assert.deepEqual(missing, []);
});

// Proves the scan can see anything at all. A regex that quietly matched nothing would pass this
// suite for ever while checking not one name.
test("the scan finds the names it is meant to check", () => {
  const names = shellFiles().flatMap((file) => importedNames(fs.readFileSync(file, "utf8")));

  assert.ok(names.length > 10, `expected to find many imported names, found ${names.length}`);
  assert.ok(names.includes("createPathGuard"), "expected to see createPathGuard among them");
});
