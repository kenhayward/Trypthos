"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadGoogleClient, CLIENT_FILE, DEV_CLIENT_ENV } = require("../src/googleClient");

/// Where the Google OAuth client comes from: a file shipped beside the app when packaged, a file the
/// developer names in development, and nothing at all otherwise - which is a build without Google
/// Drive, not a crash.

const DESKTOP_CLIENT = JSON.stringify({
  installed: { client_id: "123-abc.apps.googleusercontent.com", client_secret: "invented-secret" },
});

function collectingLogger() {
  const lines = [];
  return { lines, error: (line) => lines.push(line) };
}

test("a packaged build reads the client from its resources", () => {
  const read = [];
  const client = loadGoogleClient({
    packaged: true,
    resourcesPath: path.join("R", "resources"),
    env: {},
    readFile: (file) => {
      read.push(file);
      return DESKTOP_CLIENT;
    },
  });

  assert.deepEqual(read, [path.join("R", "resources", "build", CLIENT_FILE)]);
  assert.deepEqual(client, { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "invented-secret" });
});

test("development reads the file the environment names", () => {
  const read = [];
  const client = loadGoogleClient({
    packaged: false,
    resourcesPath: "ignored",
    env: { [DEV_CLIENT_ENV]: path.join("D", "secrets", "client.json") },
    readFile: (file) => {
      read.push(file);
      return DESKTOP_CLIENT;
    },
  });

  assert.deepEqual(read, [path.join("D", "secrets", "client.json")]);
  assert.equal(client.clientId, "123-abc.apps.googleusercontent.com");
});

// A fork, or a developer who never set one up, builds an app that says Google Drive is not
// available. Nothing is logged: it is a normal state, not a fault.
test("no environment variable in development is no client, quietly", () => {
  const logger = collectingLogger();
  assert.equal(loadGoogleClient({ packaged: false, resourcesPath: "x", env: {}, readFile: () => DESKTOP_CLIENT, logger }), null);
  assert.deepEqual(logger.lines, []);
});

test("a missing file is no client, quietly", () => {
  const logger = collectingLogger();
  const client = loadGoogleClient({
    packaged: true,
    resourcesPath: "R",
    env: {},
    readFile: () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    logger,
  });
  assert.equal(client, null);
  assert.deepEqual(logger.lines, []);
});

// A file that is there and wrong is a broken build, and someone needs to be told - without the
// file's contents, which hold the client secret.
test("a malformed file is no client, logged without its contents", () => {
  for (const contents of ["not json", JSON.stringify({ web: { client_id: "x", client_secret: "invented-secret" } })]) {
    const logger = collectingLogger();
    const client = loadGoogleClient({ packaged: true, resourcesPath: "R", env: {}, readFile: () => contents, logger });

    assert.equal(client, null);
    assert.equal(logger.lines.length, 1);
    assert.ok(!logger.lines[0].includes("invented-secret"));
  }
});
