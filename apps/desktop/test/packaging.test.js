"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../electron-builder.config.cjs");

/// Packaging rules that are invisible when broken.
///
/// A wrong artifact name does not fail a build, fail a test, or fail a release. It produces a
/// published installer whose name no longer matches the updater feed pointing at it, and the only
/// symptom is a 404 for whoever tries to update - months later, and only for the people who already
/// installed it.

const TARGETS = ["win", "mac"];

test("every platform sets its own artifact name, with no spaces", () => {
  // GitHub rewrites spaces to dots on upload, so "Trypthos Setup 0.4.3.exe" is published as
  // "Trypthos.Setup.0.4.3.exe" while latest.yml still names it with hyphens. electron-builder's own
  // publisher normalised that; publishing from a separate job does not.
  for (const target of TARGETS) {
    const name = config[target].artifactName;
    assert.ok(name, `${target} must set artifactName rather than leave it to the default`);
    assert.ok(!name.includes(" "), `${target} artifactName must not contain a space`);
  }
});

test("the macOS artifact name is qualified by architecture", () => {
  // Without it, an arm64 and an x64 build produce the same filename and collide in one release.
  assert.match(config.mac.artifactName, /\$\{arch\}/);
});

test("no global artifactName overrides the per-target ones", () => {
  // A global name applies to every target, which is how the .dmg lost its architecture suffix.
  assert.equal(config.artifactName, undefined);
});

test("the updater feed has somewhere to be written to", () => {
  // The publish block is what makes electron-builder emit latest.yml and latest-mac.yml. It does not
  // publish - the workflow does that from one job - but removing it silently drops the feed.
  assert.ok(Array.isArray(config.publish) && config.publish.length > 0);
  assert.equal(config.publish[0].provider, "github");
});

test("the renderer is packaged with the app", () => {
  const resources = config.extraResources ?? [];
  assert.ok(
    resources.some((entry) => entry.to === "app"),
    "the built renderer must be copied into resources/app, or the window opens blank",
  );
});

test("macOS builds are explicitly unsigned rather than accidentally so", () => {
  // Stated in the config and in the README. If signing is ever set up, this test is the reminder
  // that the README claim needs changing too.
  assert.equal(config.mac.identity, null);
});

test("the tray icons are packed outside the asar", () => {
  // Electron's Tray reads its icon from disk and cannot open an archive, so an icon packed inside
  // app.asar produces a tray with no icon - which looks like the feature not working at all.
  const resources = config.extraResources ?? [];
  assert.ok(
    resources.some((entry) => entry.to === "build"),
    "tray icons must be packed as extraResources, not into the asar",
  );
});
