"use strict";

const fs = require("node:fs/promises");
const { obsidianVaultsFrom } = require("@trypthos/domain");

/// Obsidian's list of vaults, read from its own settings file.
///
/// `obsidian.json` sits in Obsidian's folder under the platform's app-data directory - `%APPDATA%` on
/// Windows, `~/Library/Application Support` on macOS - and main.js names it. Whether the file exists
/// is the whole answer to "is Obsidian installed": an installation that has never opened a vault
/// still writes one, and without it there is nothing to offer.
///
/// Read fresh on every call. Obsidian can add, remove and move vaults while this app is open, and
/// the list is small.

/// Whether the file is there at all, and every vault it lists with whether its folder still is.
///
/// Never throws. A file that is missing answers not installed; one that is there and unreadable, or
/// not Obsidian's shape, answers installed with nothing to choose.
async function readObsidianVaults(configPath) {
  if (typeof configPath !== "string" || configPath === "") return { installed: false, vaults: [] };

  let text;
  try {
    text = await fs.readFile(configPath, "utf8");
  } catch {
    return { installed: false, vaults: [] };
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { installed: true, vaults: [] };
  }

  const vaults = await Promise.all(
    obsidianVaultsFrom(raw).map(async (vault) => ({ ...vault, available: await isDirectory(vault.path) })),
  );
  return { installed: true, vaults };
}

async function isDirectory(folder) {
  try {
    return (await fs.stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

module.exports = { readObsidianVaults };
