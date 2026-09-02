"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { DEFAULT_SETTINGS, loadSettings } = require("@trypthos/domain");

/// Reading and writing the settings file.
///
/// Nothing here is the user's work - a panel width, which folder was last open - so every failure
/// answers with defaults rather than stopping the app. An unopenable editor because a remembered
/// width is malformed would be a far worse bug than forgetting the width.

function settingsPath(userDataDir) {
  return path.join(userDataDir, "settings.json");
}

async function readSettings(userDataDir) {
  let text;
  try {
    text = await fs.readFile(settingsPath(userDataDir), "utf8");
  } catch {
    // Missing on first run, unreadable if something else holds it. Neither is worth reporting.
    return DEFAULT_SETTINGS;
  }

  try {
    return loadSettings(JSON.parse(text));
  } catch {
    // Not valid JSON. loadSettings handles every wrong SHAPE; this catches a truncated or corrupt
    // file, which is exactly what the atomic write below exists to prevent creating.
    return DEFAULT_SETTINGS;
  }
}

/// Writes via a temporary file and a rename.
///
/// A rename is atomic, so a reader sees either the old file or the new one - never a half-written
/// one. Writing in place risks a crash or a power cut leaving a truncated file, and settings are
/// written often enough (every panel drag settles) that "rarely" is not an argument.
async function writeSettings(userDataDir, settings) {
  const target = settingsPath(userDataDir);
  const temporary = `${target}.tmp`;

  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

module.exports = { readSettings, writeSettings, settingsPath };
