"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  explorerEntries,
  explorerRoots,
  createExplorerIntegration,
} = require("../src/explorerIntegration");

/// Trypthos in File Explorer's right-click menu.
///
/// Per-user keys under HKCU, so nothing here needs administrator rights and nothing touches another
/// account. The entries are built as data and written by `reg.exe` through an injected runner, which
/// is what makes the whole thing testable on a machine that is not Windows.

const EXE = "C:\\Users\\ada\\AppData\\Local\\Programs\\Trypthos\\Trypthos.exe";

/// Records what it was asked to run, and answers what the test tells it to.
function runner(answers = {}) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args].join(" "));
    return answers.result ?? { code: 0, stdout: "" };
  };
  return { calls, run };
}

const integration = (over = {}) => {
  const { calls, run } = runner(over);
  return {
    calls,
    integration: createExplorerIntegration({
      platform: over.platform ?? "win32",
      packaged: over.packaged ?? true,
      exePath: over.exePath ?? EXE,
      run,
    }),
  };
};

test("offers a verb on a folder, and inside one", () => {
  const keys = explorerEntries(EXE).map((entry) => entry.key);

  // Right-clicking the folder itself, and right-clicking the empty space inside it. Explorer treats
  // those as different objects, so an entry on one is absent from the other.
  assert.ok(keys.includes("HKCU\\Software\\Classes\\Directory\\shell\\Trypthos"));
  assert.ok(keys.includes("HKCU\\Software\\Classes\\Directory\\Background\\shell\\Trypthos"));
});

test("offers a verb on a markdown file, under both extensions", () => {
  const keys = explorerEntries(EXE).map((entry) => entry.key);

  assert.ok(keys.includes("HKCU\\Software\\Classes\\SystemFileAssociations\\.md\\shell\\Trypthos"));
  assert.ok(
    keys.includes("HKCU\\Software\\Classes\\SystemFileAssociations\\.markdown\\shell\\Trypthos"),
  );
});

test("registers as an application, so it appears under Open with", () => {
  const entries = explorerEntries(EXE);
  const application = entries.find(
    (entry) => entry.key === "HKCU\\Software\\Classes\\Applications\\Trypthos.exe\\SupportedTypes",
  );

  assert.ok(application);
  assert.deepEqual(
    application.values.map((value) => value.name).sort(),
    [".markdown", ".md"],
  );
});

test("passes the folder to the app, and the file to the app", () => {
  const commandFor = (key) =>
    explorerEntries(EXE).find((entry) => entry.key === key).values[0].data;

  // %V for a directory - %1 is empty when the click was on the background of a folder rather than
  // on the folder itself, which is exactly the case that entry exists for.
  assert.equal(
    commandFor("HKCU\\Software\\Classes\\Directory\\Background\\shell\\Trypthos\\command"),
    `"${EXE}" "%V"`,
  );
  assert.equal(
    commandFor("HKCU\\Software\\Classes\\SystemFileAssociations\\.md\\shell\\Trypthos\\command"),
    `"${EXE}" "%1"`,
  );
});

// The label a user reads in Explorer. Written here rather than in the renderer's catalogue for the
// same reason the native menus are: this process has no i18next, and the string is handed to the
// operating system rather than rendered.
test("labels the entries in words rather than leaving the key name", () => {
  const entries = explorerEntries(EXE);
  const label = (key) =>
    entries.find((entry) => entry.key === key).values.find((value) => value.name === "").data;

  assert.equal(label("HKCU\\Software\\Classes\\Directory\\shell\\Trypthos"), "Open folder in Trypthos");
  assert.equal(
    label("HKCU\\Software\\Classes\\SystemFileAssociations\\.md\\shell\\Trypthos"),
    "Open in Trypthos",
  );
});

test("every entry is under the current user, never the machine", () => {
  // HKCU needs no administrator rights and cannot affect another account. A machine-wide write from
  // a settings toggle would be both a privilege prompt and somebody else's problem.
  for (const entry of explorerEntries(EXE)) {
    assert.match(entry.key, /^HKCU\\Software\\Classes\\/);
  }
  for (const root of explorerRoots()) {
    assert.match(root, /^HKCU\\Software\\Classes\\/);
  }
});

test("removing takes away every root it added", () => {
  const roots = explorerRoots();
  const added = explorerEntries(EXE).map((entry) => entry.key);

  // Every key written is beneath a root that is deleted, so turning the integration off leaves
  // nothing behind.
  for (const key of added) {
    assert.ok(
      roots.some((root) => key === root || key.startsWith(`${root}\\`)),
      `${key} is under no root that unregister deletes`,
    );
  }
});

test("writes each value with reg.exe", async () => {
  const { integration: shell, calls } = integration();

  await shell.register();

  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => call.startsWith("reg add ")));
  assert.ok(calls.some((call) => call.includes("Directory\\shell\\Trypthos")));
});

test("deletes the roots, quietly, when turned off", async () => {
  const { integration: shell, calls } = integration();

  await shell.unregister();

  assert.equal(calls.length, explorerRoots().length);
  // /f so a root that is not there is not an error: turning off something already off must succeed.
  assert.ok(calls.every((call) => call.startsWith("reg delete ") && call.includes(" /f")));
});

test("reports whether it is registered by asking the registry", async () => {
  const present = integration();
  assert.equal(await present.integration.isRegistered(), true);
  assert.ok(present.calls[0].startsWith("reg query "));

  const absent = integration({ result: { code: 1, stdout: "" } });
  assert.equal(await absent.integration.isRegistered(), false);
});

test("is unavailable anywhere but Windows", async () => {
  const { integration: shell, calls } = integration({ platform: "darwin" });

  assert.equal(shell.supported(), false);
  assert.equal(await shell.isRegistered(), false);
  // And does nothing rather than shelling out to a program that is not there.
  assert.deepEqual(calls, []);
});

// In development the executable is Electron's own, which does not know how to start Trypthos on its
// own. Registering it would put an entry in Explorer that opens an empty Electron window.
test("is unavailable until the app is packaged", () => {
  assert.equal(integration({ packaged: false }).integration.supported(), false);
});

test("refuses to act when it is not supported", async () => {
  const { integration: shell, calls } = integration({ packaged: false });

  const result = await shell.register();

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported");
  assert.deepEqual(calls, []);
});
