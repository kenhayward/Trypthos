"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { webPreferencesFor } = require("../src/windowOptions");

test("the renderer is created without Node access", () => {
  const prefs = webPreferencesFor("/app/preload.js");
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
});

test("web security and the webview tag are not weakened", () => {
  const prefs = webPreferencesFor("/app/preload.js");
  assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.webviewTag, false);
});

test("the preload path is passed through", () => {
  assert.equal(webPreferencesFor("/app/preload.js").preload, "/app/preload.js");
});
