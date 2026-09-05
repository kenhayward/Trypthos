"use strict";

const fs = require("node:fs/promises");
const { DEFAULT_OUTLINE_FILE_LIMIT, isOpenable } = require("@trypthos/domain");

/// The files chat is offered, and may then ask to read.
///
/// **One level only.** Not a recursive walk: measured on a home directory, one took 39 seconds
/// across 113,553 folders, and the result was a list far too long to be useful as a menu. The
/// outline is a menu the model reads and then orders from, so a short, predictable one beats a
/// complete one - and the top level of a notes folder is usually what somebody means by "my notes".
/// Subfolders are not listed, and their files cannot be read.
///
/// **This list is also the allowlist.** The model may read a file only if it appears here, so what
/// this returns is exactly what `get_file_contents` will serve. Keeping those two the same function
/// is deliberate: a separate check would be a second definition of "which files are readable", and
/// the two would drift.

/// The files directly inside `root`, relative to it, of the types the user has turned on.
///
/// **`fileTypes` widens an allowlist**, which is why it is required and why it comes from settings
/// read in the main process rather than from anything the renderer sends. A type that is off is a
/// file the model is neither shown nor able to ask for.
///
/// Total: it never throws. A folder that has been deleted answers with an empty outline rather than
/// an error nobody can act on.
async function outlineWorkspace(root, { fileTypes, limit = DEFAULT_OUTLINE_FILE_LIMIT }) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return { paths: [], truncated: false };
  }

  // Sorted so the same folder produces the same menu twice running. Without it the order is the
  // filesystem's, and which files the model can see would drift between turns.
  const files = entries
    .filter((entry) => entry.isFile() && isOpenable(entry.name, fileTypes))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return {
    paths: files.slice(0, limit),
    // Reported rather than silently short: an outline that stopped without saying so would have the
    // model answering as though it had seen the whole folder.
    truncated: files.length > limit,
  };
}

module.exports = { outlineWorkspace };
