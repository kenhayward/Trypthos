"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { GoogleClientConfigSchema } = require("@trypthos/domain");

/// The Google OAuth client this build signs in with, or null for a build without one.
///
/// **Packaged:** `resources/build/google-oauth-client.json`, written by the release workflow from the
/// `GOOGLE_OAUTH_CLIENT_JSON` repository secret before packaging. Google treats a Desktop client's
/// secret as not confidential - it ships in every installer - but it does not belong in a public
/// repository, which is why it is injected rather than committed.
///
/// **Development:** the file named by `TRYPTHOS_GOOGLE_CLIENT`, which is the JSON Google's console
/// downloads, kept outside the repository.
///
/// Null is a normal answer, not a fault: a fork, or a developer who has not set one up, gets an app
/// that says Google Drive is not available in this build.

const CLIENT_FILE = "google-oauth-client.json";
const DEV_CLIENT_ENV = "TRYPTHOS_GOOGLE_CLIENT";

function clientFileFor({ packaged, resourcesPath, env }) {
  if (packaged) return path.join(resourcesPath, "build", CLIENT_FILE);
  const named = env[DEV_CLIENT_ENV];
  return typeof named === "string" && named !== "" ? named : null;
}

function loadGoogleClient({
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
    // Absent is the build without Google. Nothing to report.
    return null;
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // Never the contents: they hold the client secret.
    logger.error?.("The Google OAuth client file is not JSON, so Google Drive is unavailable.");
    return null;
  }

  const parsed = GoogleClientConfigSchema.safeParse(json);
  if (!parsed.success) {
    logger.error?.("The Google OAuth client file is not a Desktop app client, so Google Drive is unavailable.");
    return null;
  }
  return parsed.data;
}

module.exports = { loadGoogleClient, CLIENT_FILE, DEV_CLIENT_ENV };
