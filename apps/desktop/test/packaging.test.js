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

test("artifact names contain no spaces", () => {
  // GitHub rewrites spaces to dots on upload, so "Trypthos Setup 0.4.3.exe" is published as
  // "Trypthos.Setup.0.4.3.exe" while latest.yml still names it with hyphens. electron-builder's own
  // publisher normalised that; publishing from a separate job does not.
  assert.ok(config.artifactName, "artifactName must be set, not left to the default");
  assert.ok(!config.artifactName.includes(" "), "artifactName must not contain a space");
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
