"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadMicrosoftClient, CLIENT_FILE, DEV_CLIENT_ENV } = require("../src/microsoftClient");

const ID = "00000000-1111-2222-3333-444444444444";
const quiet = () => {
  const logged = [];
  return { logged, logger: { error: (line) => logged.push(line) } };
};

test("a packaged build reads resources/build/onedrive-client.json", () => {
  const read = [];
  const client = loadMicrosoftClient({
    packaged: true,
    resourcesPath: "/app/resources",
    env: {},
    readFile: (file) => (read.push(file), JSON.stringify({ clientId: ID })),
  });
  assert.deepEqual(client, { clientId: ID });
  assert.deepEqual(read, [path.join("/app/resources", "build", CLIENT_FILE)]);
});

test("development reads the file the environment names", () => {
  const client = loadMicrosoftClient({
    packaged: false,
    resourcesPath: "/unused",
    env: { [DEV_CLIENT_ENV]: "/secrets/onedrive-client.json" },
    readFile: (file) => (assert.equal(file, "/secrets/onedrive-client.json"), JSON.stringify({ clientId: ID })),
  });
  assert.deepEqual(client, { clientId: ID });
});

test("no file, or no variable, is a build without OneDrive - and says nothing", () => {
  const { logged, logger } = quiet();
  assert.equal(loadMicrosoftClient({ packaged: false, resourcesPath: "/r", env: {}, logger }), null);
  assert.equal(
    loadMicrosoftClient({
      packaged: true,
      resourcesPath: "/r",
      env: {},
      logger,
      readFile: () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    }),
    null,
  );
  assert.deepEqual(logged, []);
});

test("a file that is not JSON, or not a client id, is refused with one line naming neither its contents", () => {
  const { logged, logger } = quiet();
  assert.equal(loadMicrosoftClient({ packaged: true, resourcesPath: "/r", env: {}, logger, readFile: () => "{nope" }), null);
  assert.equal(
    loadMicrosoftClient({ packaged: true, resourcesPath: "/r", env: {}, logger, readFile: () => JSON.stringify({ clientId: "abc" }) }),
    null,
  );
  assert.equal(logged.length, 2);
  assert.equal(logged.some((line) => line.includes("abc") || line.includes("nope")), false);
});
