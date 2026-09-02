"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createUpdater } = require("../src/updater");

/// Drives the updater against a fake Electron. What matters here is not the download - that is
/// electron-updater's job - but the DECISIONS: what a check does, and which trigger asks first.

function harness({ version = "0.9.0", releases = [], fetchFails = false, packaged = true } = {}) {
  const shown = [];
  const notifications = [];
  const opened = [];

  global.fetch = async () => {
    if (fetchFails) throw new Error("offline");
    return { ok: true, json: async () => releases };
  };

  class FakeNotification {
    constructor(options) {
      this.options = options;
      // Keyed by event. Storing only the last handler made this fake lie the moment a second one was
      // registered: firing "the handler" ran whichever happened to be registered last.
      this.handlers = new Map();
      notifications.push(this);
    }
    static isSupported() {
      return true;
    }
    on(event, handler) {
      this.handlers.set(event, handler);
    }
    emit(event, ...args) {
      return this.handlers.get(event)?.(...args);
    }
    show() {}
  }

  const updater = createUpdater({
    app: { isPackaged: packaged, getVersion: () => version },
    dialog: {
      showMessageBox: async (_window, options) => {
        shown.push(options);
        return { response: 1 };
      },
    },
    shell: { openExternal: async (url) => opened.push(url) },
    Notification: FakeNotification,
    getWindow: () => null,
    logger: { error: () => {} },
  });

  return { updater, shown, notifications, opened };
}

const release = (tag) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  html_url: `https://example.com/${tag}`,
});

test("a startup check that finds nothing says nothing", async () => {
  const { updater, shown, notifications } = harness({ releases: [release("v0.9.0")] });

  const result = await updater.check("startup");

  assert.equal(result.state, "up-to-date");
  assert.deepEqual(shown, [], "an app that announces being up to date every launch trains people to dismiss it");
  assert.equal(notifications.length, 0);
});

test("a manual check that finds nothing still answers", async () => {
  const { updater, shown } = harness({ releases: [release("v0.9.0")] });

  await updater.check("manual");

  // They asked, so silence would read as the check having failed.
  assert.equal(shown.length, 1);
  assert.match(shown[0].message, /up to date/i);
});

test("a startup check with an update notifies rather than asking", async () => {
  const { updater, shown, notifications } = harness({
    releases: [release("v0.10.0"), release("v0.9.0")],
  });

  const result = await updater.check("startup");

  assert.equal(result.state, "update-available");
  assert.equal(result.version, "0.10.0");
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].options.title, /0\.10\.0/);
  assert.deepEqual(shown, [], "startup must not interrupt with a dialog");
});

test("clicking the startup notification downloads without asking again", async () => {
  const { updater, notifications, opened, shown } = harness({ releases: [release("v0.10.0")] });
  await updater.check("startup");

  // The click IS the consent.
  await notifications[0].emit("click");

  assert.deepEqual(shown, [], "no further question after the click");
  // Not packaged for Windows in this harness, so it falls back to opening the page.
  assert.equal(opened.length, 1);
});

/// Windows answers isSupported() with true and then declines delivery when the user has
/// notifications switched off. Nothing is shown and nothing throws, so a handler is the only signal
/// there is - and the tray is what the user is left with.
test("survives a notification that is accepted and then not delivered", async () => {
  const { updater, notifications } = harness({ releases: [release("v0.10.0")] });
  await updater.check("startup");

  notifications[0].emit("failed", null, "Settings prevent the notification type from being delivered.");

  assert.equal(updater.getAvailable().version, "0.10.0", "the tray must still be able to offer it");
});

test("a manual check with an update asks before downloading", async () => {
  const { updater, shown, opened } = harness({ releases: [release("v0.10.0")] });

  await updater.check("manual");

  assert.equal(shown.length, 1);
  assert.match(shown[0].message, /0\.10\.0/);
  assert.deepEqual(shown[0].buttons, ["Download", "Not now"]);
  // The fake answers "Not now", so nothing is fetched.
  assert.deepEqual(opened, [], "declining must not download anything");
});

test("a failed startup check is silent, a failed manual check is not", async () => {
  const quiet = harness({ fetchFails: true });
  const result = await quiet.updater.check("startup");
  assert.equal(result.ok, false);
  assert.deepEqual(quiet.shown, [], "nothing the user can act on at the moment the app opens");

  const loud = harness({ fetchFails: true });
  await loud.updater.check("manual");
  assert.equal(loud.shown.length, 1);
  assert.match(loud.shown[0].message, /Could not check/i);
});

test("a second check while one is running is refused rather than doubled", async () => {
  const { updater } = harness({ releases: [release("v0.10.0")] });

  const [first, second] = await Promise.all([updater.check("startup"), updater.check("manual")]);
  const outcomes = [first, second].map((r) => r.reason ?? r.state);

  assert.ok(outcomes.includes("already-checking"), "the startup check and an impatient tray click must not race");
});

/// The case this machine is actually in: Windows reports notifications as supported and then refuses
/// to deliver them. Nothing is shown and nothing throws, so without the tray the startup check would
/// be silent and dead - the user would simply never learn there was an update.
test("remembers the update it found, so the tray can show it when a toast cannot", async () => {
  const { updater } = harness({ releases: [release("v0.10.0")] });

  assert.equal(updater.getAvailable(), null);
  await updater.check("startup");

  assert.equal(updater.getAvailable().version, "0.10.0");
  assert.equal(updater.isDownloaded(), false);
});

test("tells the tray to rebuild when an update appears", async () => {
  const { updater } = harness({ releases: [release("v0.10.0")] });
  let changes = 0;
  updater.onChange(() => (changes += 1));

  await updater.check("startup");
  assert.equal(changes, 1);
});

test("finding nothing leaves the tray with nothing to offer", async () => {
  const { updater } = harness({ releases: [release("v0.9.0")] });
  await updater.check("startup");
  assert.equal(updater.getAvailable(), null);
});

test("a development build never checks on startup", async () => {
  const { updater, notifications } = harness({ packaged: false, releases: [release("v0.10.0")] });

  updater.start();
  await new Promise((resolve) => setImmediate(resolve));

  // In development the version is whatever the repo says, so every run would announce an update to
  // the release matching the source already checked out.
  assert.equal(notifications.length, 0);
});
