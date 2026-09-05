"use strict";

const { DEFAULT_OUTLINE_FILE_LIMIT, isOpenable } = require("@trypthos/domain");

/// The files chat is offered, and may then ask to read.
///
/// **One level only.** Not a recursive walk: measured on a home directory, one took 39 seconds
/// across 113,553 folders, and the result was a list far too long to be useful as a menu. The
/// outline is a menu the model reads and then orders from, so a short, predictable one beats a
/// complete one.
///
/// **This list is also the allowlist.** The model may read a file only if it appears here, so what
/// this returns is exactly what `get_file_contents` will serve. Keeping those two the same function
/// is deliberate: a separate check would be a second definition of "which files are readable", and
/// the two would drift.
///
/// **It walks the folder the user selected in the tree**, which is a path from the renderer and
/// therefore untrusted - so it goes through the workspace PROVIDER rather than `fs`, and inherits
/// the lexical guard and the realpath check every other path gets. The boundary is the workspace
/// root; which folder inside it is a choice, not a permission. A folder that cannot be listed -
/// outside the workspace, deleted, unreadable - answers with an empty outline rather than an error
/// nobody can act on.

/// The files directly inside `path`, named from the workspace ROOT so a file can be read back.
///
/// `fileTypes` widens an allowlist, which is why it is required and comes from settings read in the
/// main process rather than from anything the renderer sends. A type that is off is a file the model
/// is neither shown nor able to ask for.
///
/// Total: it never throws.
async function outlineWorkspace(provider, { path, fileTypes, limit = DEFAULT_OUTLINE_FILE_LIMIT }) {
  const listing = await provider.list(path);
  if (!listing.ok) return { path: "", paths: [], truncated: false };

  // Sorted so the same folder produces the same menu twice running. Without it the order is the
  // provider's, and which files the model can see would drift between turns.
  const files = listing.nodes
    .filter((node) => node.kind === "file" && isOpenable(node.name, fileTypes))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((node) => node.id);

  return {
    path,
    paths: files.slice(0, limit),
    // Reported rather than silently short: an outline that stopped without saying so would have the
    // model answering as though it had seen the whole folder.
    truncated: files.length > limit,
  };
}

module.exports = { outlineWorkspace };
