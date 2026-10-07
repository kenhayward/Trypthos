"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { MicrosoftClientConfigSchema } = require("@trypthos/domain");

/// The Microsoft app registration this build signs in with, or null for a build without one.
///
/// **Packaged:** `resources/build/onedrive-client.json`, written by the release workflow from the
/// `ONEDRIVE_CLIENT_ID` repository secret. A public client has no secret, but the id is still
/// injected rather than committed, so a fork does not sign its users in as this registration.
///
/// **Development:** the file named by `TRYPTHOS_ONEDRIVE_CLIENT`, `{ "clientId": "<guid>" }`.
///
/// Null is a normal answer: the interface then says OneDrive is not available in this build.

const CLIENT_FILE = "onedrive-client.json";
const DEV_CLIENT_ENV = "TRYPTHOS_ONEDRIVE_CLIENT";

function clientFileFor({ packaged, resourcesPath, env }) {
  if (packaged) return path.join(resourcesPath, "build", CLIENT_FILE);
  const named = env[DEV_CLIENT_ENV];
  return typeof named === "string" && named !== "" ? named : null;
}

function loadMicrosoftClient({
  packaged,
  resourcesPath,
  env = process.env,
  readFile = (file) => fs.readFileSync(file, "utf8"),
  logger = console,
}) {
  const file = clientFileFor({ packaged, resourcesPath, env });
  if (file === null) return null;

  let text;
  try {
    text = readFile(file);
  } catch {
    // Absent is the build without OneDrive. Nothing to report.
    return null;
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    logger.error?.("The OneDrive client file is not JSON, so OneDrive is unavailable.");
    return null;
  }

  const parsed = MicrosoftClientConfigSchema.safeParse(json);
  if (!parsed.success) {
    logger.error?.("The OneDrive client file does not hold a client id, so OneDrive is unavailable.");
    return null;
  }
  return parsed.data;
}

module.exports = { loadMicrosoftClient, CLIENT_FILE, DEV_CLIENT_ENV };
