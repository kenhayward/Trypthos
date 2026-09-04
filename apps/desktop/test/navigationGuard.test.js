"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { navigationDecision } = require("../src/navigationGuard");

/// The last line under the link handling in the renderer.
///
/// The renderer decides what a clicked link means, but the window is what actually navigates - so if
/// anything at all gets past the renderer (a form, an anchor the app draws later, a page in a chat
/// reply nobody anticipated), this is where it stops. A frameless window has no address bar and no
/// back button: a navigation away from the app is a state with no way out of it.

const DEV = "http://localhost:5173/";
const BUILT = "file:///C:/Program%20Files/Trypthos/resources/app/dist/index.html";

test("allows the app to reload itself in development", () => {
  assert.equal(navigationDecision(DEV, "http://localhost:5173/"), "allow");
  assert.equal(navigationDecision(DEV, "http://localhost:5173/?v=2"), "allow");
});

test("allows the app to reload itself in a packaged build", () => {
  assert.equal(navigationDecision(BUILT, BUILT), "allow");
});

test("sends a web address to the browser rather than loading it over the app", () => {
  assert.equal(navigationDecision(DEV, "https://example.com/a"), "external");
  assert.equal(navigationDecision(BUILT, "http://example.com"), "external");
});

test("refuses another page on the dev server, which is not a page this app has", () => {
  assert.equal(navigationDecision(DEV, "http://localhost:5173/somewhere-else"), "external");
});

test("refuses a local file, which would put the whole disk inside the app's origin", () => {
  assert.equal(navigationDecision(BUILT, "file:///C:/Users/ada/.ssh/id_rsa"), "deny");
  assert.equal(navigationDecision(DEV, "file:///etc/passwd"), "deny");
});

test("refuses anything the operating system would act on", () => {
  for (const url of ["ms-msdt:/id", "javascript:alert(1)", "data:text/html,x", ""]) {
    assert.equal(navigationDecision(DEV, url), "deny", `${url} was not denied`);
  }
});

test("refuses a target that is not a URL at all rather than throwing", () => {
  assert.equal(navigationDecision(DEV, "not a url"), "deny");
  assert.equal(navigationDecision("not a url", "https://example.com"), "external");
});
