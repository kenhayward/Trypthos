"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { rendererTarget } = require("../src/rendererTarget");

test("loads the dev server when TRYPTHOS_DEV is set", () => {
  assert.deepEqual(rendererTarget({ TRYPTHOS_DEV: "1" }, "/app/index.html"), {
    kind: "url",
    value: "http://localhost:5173",
  });
});

test("honours an overridden dev server URL", () => {
  const target = rendererTarget({ TRYPTHOS_DEV: "1", TRYPTHOS_DEV_URL: "http://localhost:6000" }, "/x");
  assert.equal(target.value, "http://localhost:6000");
});

test("loads the built bundle otherwise", () => {
  assert.deepEqual(rendererTarget({}, "/app/index.html"), {
    kind: "file",
    value: "/app/index.html",
  });
});

test("does not treat any other value of TRYPTHOS_DEV as development", () => {
  assert.equal(rendererTarget({ TRYPTHOS_DEV: "0" }, "/app/index.html").kind, "file");
  assert.equal(rendererTarget({ TRYPTHOS_DEV: "true" }, "/app/index.html").kind, "file");
});
