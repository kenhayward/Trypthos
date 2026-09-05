"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathFromArgv, resolveTarget } = require("../src/launchTarget");

/// What Explorer hands the app when a verb is used, and what that means.
///
/// Two separate questions, kept apart: which argument is a path, and what is at the end of it. The
/// first is pure text, the second touches the disk - so only the second needs a fake.

test("takes the path a packaged app was launched with", () => {
  assert.equal(
    pathFromArgv(["C:\\Programs\\Trypthos.exe", "D:\\Notes"], { packaged: true }),
    "D:\\Notes",
  );
});

// In development the app is started as `electron .`, so the second argument is the app itself rather
// than anything a user picked.
test("skips the app directory in development", () => {
  assert.equal(pathFromArgv(["electron.exe", ".", "D:\\Notes"], { packaged: false }), "D:\\Notes");
  assert.equal(pathFromArgv(["electron.exe", "."], { packaged: false }), null);
});

test("ignores switches, which are Chromium's rather than the user's", () => {
  const argv = ["Trypthos.exe", "--allow-file-access", "D:\\Notes", "--no-sandbox"];
  assert.equal(pathFromArgv(argv, { packaged: true }), "D:\\Notes");
});

test("has nothing to open when the app was simply started", () => {
  assert.equal(pathFromArgv(["Trypthos.exe"], { packaged: true }), null);
});

/// Answers with a fixed shape for a fixed path, so nothing here touches a real disk.
function stats(kinds) {
  return async (target) => {
    const kind = kinds[target];
    if (kind === undefined) throw new Error("ENOENT");
    return { isDirectory: () => kind === "directory", isFile: () => kind === "file" };
  };
}

test("a folder is a workspace to open", async () => {
  const target = await resolveTarget("D:\\Notes", { stat: stats({ "D:\\Notes": "directory" }) });

  assert.deepEqual(target, { root: "D:\\Notes", file: null });
});

// The app edits documents inside ONE open folder, and every path it handles is relative to that
// folder. So a file names two things: the folder to open, and the document to open in it.
test("a file is the folder it lives in, and the file within it", async () => {
  const file = path.join("D:\\Notes", "todo.md");
  const target = await resolveTarget(file, { stat: stats({ [file]: "file" }) });

  assert.deepEqual(target, { root: "D:\\Notes", file: "todo.md" });
});

test("accepts the other markdown extension", async () => {
  const file = path.join("D:\\Notes", "todo.markdown");
  const target = await resolveTarget(file, { stat: stats({ [file]: "file" }) });

  assert.equal(target.file, "todo.markdown");
});

// Nothing registers Trypthos for these, but an argument is somebody else's text and this is the
// process that acts on it.
test("refuses a file it cannot edit", async () => {
  const file = path.join("D:\\Notes", "photo.png");
  assert.equal(await resolveTarget(file, { stat: stats({ [file]: "file" }) }), null);
});

test("refuses a path that is not there", async () => {
  assert.equal(await resolveTarget("D:\\Gone", { stat: stats({}) }), null);
});

test("has nothing to resolve when there was no argument", async () => {
  assert.equal(await resolveTarget(null, { stat: stats({}) }), null);
});
