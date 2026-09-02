"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DEFAULT_SETTINGS } = require("@trypthos/domain");
const { readSettings, writeSettings, settingsPath } = require("../src/settingsStore");

async function withDir(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-settings-"));
  try {
    await body(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("returns defaults on a first run, with no file present", async () => {
  await withDir(async (dir) => {
    assert.deepEqual(await readSettings(dir), DEFAULT_SETTINGS);
  });
});

test("round-trips what it was given", async () => {
  await withDir(async (dir) => {
    const settings = { ...DEFAULT_SETTINGS, lastWorkspace: "D:/Notes" };
    await writeSettings(dir, settings);
    assert.deepEqual(await readSettings(dir), settings);
  });
});

test("creates the directory if it does not exist yet", async () => {
  await withDir(async (dir) => {
    const nested = path.join(dir, "does", "not", "exist");
    await writeSettings(nested, DEFAULT_SETTINGS);
    assert.deepEqual(await readSettings(nested), DEFAULT_SETTINGS);
  });
});

/// Settings are a convenience. Refusing to start because a remembered panel width is malformed would
/// be a far worse bug than forgetting the width.
test("falls back to defaults on a corrupt file rather than throwing", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(settingsPath(dir), "{ this is not json", "utf8");
    assert.deepEqual(await readSettings(dir), DEFAULT_SETTINGS);
  });
});

test("falls back to defaults on a file of the wrong shape", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(settingsPath(dir), JSON.stringify({ panels: "wrong" }), "utf8");
    assert.deepEqual(await readSettings(dir), DEFAULT_SETTINGS);
  });
});

/// The rename is what makes this true. Writing in place would let a crash mid-write leave a
/// truncated file, and settings are written whenever a panel drag settles - often enough that
/// "rarely" is not an argument.
test("leaves no temporary file behind, so a reader never sees a half-written one", async () => {
  await withDir(async (dir) => {
    await writeSettings(dir, DEFAULT_SETTINGS);
    const entries = await fs.readdir(dir);
    assert.deepEqual(entries, ["settings.json"]);
  });
});

test("overwrites cleanly when written repeatedly", async () => {
  await withDir(async (dir) => {
    for (let i = 1; i <= 5; i += 1) {
      await writeSettings(dir, {
        ...DEFAULT_SETTINGS,
        panels: { ...DEFAULT_SETTINGS.panels, workspaceWidth: 200 + i },
      });
    }
    const settings = await readSettings(dir);
    assert.equal(settings.panels.workspaceWidth, 205);
    assert.deepEqual(await fs.readdir(dir), ["settings.json"]);
  });
});
