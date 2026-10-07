"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DEFAULT_SETTINGS, SETTINGS_VERSION } = require("@trypthos/domain");
const { readSettings, writeSettings, settingsPath } = require("../src/settingsStore");

const silent = { error: () => {}, warn: () => {} };

/// A logger that keeps what it was told, so a test can check a line names the step and the reason
/// and carries nothing from the file.
function recordingLogger() {
  const lines = [];
  const record = (...args) => lines.push(args.join(" "));
  return { lines, logger: { error: record, warn: record } };
}

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
    const settings = { ...DEFAULT_SETTINGS, workspaces: [{ kind: "local", root: "D:/Notes" }] };
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

/// The main process needs closeToTray at window-close time, and the file on disk may still be the
/// version that predates it - so it must migrate rather than read as missing.
test("reads closeToTray, migrating a version 1 file rather than ignoring it", async () => {
  await withDir(async (dir) => {
    const { readCloseToTray } = require("../src/settingsStore");
    await fs.writeFile(
      settingsPath(dir),
      JSON.stringify({
        schemaVersion: 1,
        panels: { workspaceWidth: 326, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: true },
        workspaces: ["D:/Notes"],
      }),
      "utf8",
    );

    assert.equal(await readCloseToTray(dir), false);
  });
});

test("tells listeners when settings are written", async () => {
  const { onSettingsWritten, notifySettingsWritten } = require("../src/settingsStore");
  const seen = [];
  const stop = onSettingsWritten((settings) => seen.push(settings.window.closeToTray));

  notifySettingsWritten({ ...DEFAULT_SETTINGS, window: { closeToTray: true } });
  assert.deepEqual(seen, [true]);

  // Otherwise the main process would act on a preference the user changed a moment ago.
  stop();
  notifySettingsWritten({ ...DEFAULT_SETTINGS, window: { closeToTray: false } });
  assert.deepEqual(seen, [true], "a removed listener must stop hearing");
});

// ---- Issue #235: an older build must never write over a newer build's settings ----

/// What a newer build would leave behind: a version this build has never heard of, holding things
/// this build cannot read. Written as exact bytes so "survives" can be checked byte for byte.
const FUTURE_TEXT = `${JSON.stringify(
  { ...DEFAULT_SETTINGS, schemaVersion: SETTINGS_VERSION + 1, somethingNew: { kept: true } },
  null,
  2,
)}\n`;

/// The downgrade: an older build reads the newer file, falls back to defaults, and the renderer
/// writes those defaults back 400 ms later. Before the fix that write replaced every setting.
test("a settings file from a newer build survives a load and a write, byte for byte", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(settingsPath(dir), FUTURE_TEXT, "utf8");

    assert.deepEqual(await readSettings(dir, { logger: silent }), DEFAULT_SETTINGS);
    const result = await writeSettings(dir, DEFAULT_SETTINGS, { logger: silent });

    assert.deepEqual(result, { ok: false, reason: "from-the-future" });
    assert.equal(await fs.readFile(settingsPath(dir), "utf8"), FUTURE_TEXT);
    // Never touched at all: no backup, no temporary file.
    assert.deepEqual(await fs.readdir(dir), ["settings.json"]);
  });
});

test("a refused write says so in one line, naming the step and the reason and nothing stored", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(settingsPath(dir), FUTURE_TEXT, "utf8");
    const { lines, logger } = recordingLogger();

    await writeSettings(dir, DEFAULT_SETTINGS, { logger });

    assert.equal(lines.length, 1);
    assert.match(lines[0], /settings write/i);
    assert.match(lines[0], /from-the-future/);
    assert.doesNotMatch(lines[0], /somethingNew|settings\.json/);
  });
});

/// A corrupt file holds nothing this build - or any build - can read, so refusing to write would
/// leave the user unable to save a setting ever again. It is kept, renamed aside, and then replaced.
test("an unparseable file is backed up beside itself, then replaced", async () => {
  await withDir(async (dir) => {
    const corrupt = "{ this is not json";
    await fs.writeFile(settingsPath(dir), corrupt, "utf8");
    const settings = { ...DEFAULT_SETTINGS, panels: { ...DEFAULT_SETTINGS.panels, workspaceWidth: 271 } };

    assert.deepEqual(await readSettings(dir, { logger: silent }), DEFAULT_SETTINGS);
    const result = await writeSettings(dir, settings, { logger: silent });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(await readSettings(dir, { logger: silent }), settings);

    const backups = (await fs.readdir(dir)).filter((name) => name.startsWith("settings.json.unreadable-"));
    assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(dir, backups[0]), "utf8"), corrupt);
    assert.deepEqual((await fs.readdir(dir)).sort(), ["settings.json", backups[0]].sort());
  });
});

test("a file of the wrong shape takes the same path as a corrupt one", async () => {
  await withDir(async (dir) => {
    const wrong = JSON.stringify({ panels: "wrong" });
    await fs.writeFile(settingsPath(dir), wrong, "utf8");

    assert.deepEqual(await writeSettings(dir, DEFAULT_SETTINGS, { logger: silent }), { ok: true });

    const backups = (await fs.readdir(dir)).filter((name) => name.startsWith("settings.json.unreadable-"));
    assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(dir, backups[0]), "utf8"), wrong);
    assert.deepEqual(await readSettings(dir), DEFAULT_SETTINGS);
  });
});

/// Once replaced, the file is current again, so later writes are ordinary ones - one backup, not one
/// per panel drag.
test("the backup is taken once, not on every later write", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(settingsPath(dir), "{ this is not json", "utf8");

    await writeSettings(dir, DEFAULT_SETTINGS, { logger: silent });
    await writeSettings(dir, DEFAULT_SETTINGS, { logger: silent });
    await writeSettings(dir, DEFAULT_SETTINGS, { logger: silent });

    assert.equal((await fs.readdir(dir)).length, 2);
  });
});

test("a current file still saves normally, and says so", async () => {
  await withDir(async (dir) => {
    await writeSettings(dir, DEFAULT_SETTINGS);
    const settings = { ...DEFAULT_SETTINGS, workspaces: [{ kind: "local", root: "D:/Notes" }] };

    assert.deepEqual(await writeSettings(dir, settings), { ok: true });
    assert.deepEqual(await readSettings(dir), settings);
    assert.deepEqual(await fs.readdir(dir), ["settings.json"]);
  });
});

/// One line per load that falls back, naming the step and the reason - never the file's contents or
/// its path, which carries the user's name on every platform.
test("a load that falls back logs one line naming the step and the reason", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(settingsPath(dir), FUTURE_TEXT, "utf8");
    const future = recordingLogger();
    await readSettings(dir, { logger: future.logger });
    assert.equal(future.lines.length, 1);
    assert.match(future.lines[0], /settings load/i);
    assert.match(future.lines[0], /from-the-future/);
    assert.doesNotMatch(future.lines[0], /somethingNew|settings\.json/);

    await fs.writeFile(settingsPath(dir), "{ secret-looking text", "utf8");
    const corrupt = recordingLogger();
    await readSettings(dir, { logger: corrupt.logger });
    assert.equal(corrupt.lines.length, 1);
    assert.match(corrupt.lines[0], /settings load/i);
    assert.match(corrupt.lines[0], /not-json/);
    assert.doesNotMatch(corrupt.lines[0], /secret-looking/);
  });
});

test("a first run, with no file, logs nothing", async () => {
  await withDir(async (dir) => {
    const { lines, logger } = recordingLogger();
    await readSettings(dir, { logger });
    assert.deepEqual(lines, []);
  });
});
