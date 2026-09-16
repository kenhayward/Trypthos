"use strict";

const {
  DEFAULT_OUTLINE_FILE_LIMIT,
  OUTLINE_PATH_LIMIT,
  isOpenable,
  isSkippedWhenWalking,
} = require("@trypthos/domain");

/// The files and folders chat is shown when a folder is attached - the model's map of it.
///
/// **One level only.** Not a recursive walk: measured on a home directory, one took 39 seconds
/// across 113,553 folders, and the result was a list far too long to be useful as a menu. The
/// outline is a menu the model reads and then orders from, so a short, predictable one beats a
/// complete one. It names the folders directly inside as well as the files, so the model knows there
/// is more below - and, with tools, can list or search there.
///
/// **This is NOT the allowlist.** It once was, when the model could read only what was named here.
/// What the model may read now is any enabled file inside the attached folder, checked when a read
/// is asked for - `readForModel` in ipcHandlers, over the same guarded provider. Nothing here
/// widens or narrows that; it only decides what the model is told about up front.
///
/// **It walks the folder the user selected in the tree**, which is a path from the renderer and
/// therefore untrusted - so it goes through the workspace PROVIDER rather than `fs`, and inherits
/// the lexical guard and the realpath check every other path gets. The boundary is the workspace
/// root; which folder inside it is a choice, not a permission. A folder that cannot be listed -
/// outside the workspace, deleted, unreadable - answers with an empty outline rather than an error
/// nobody can act on.

/// The files and folders directly inside `path`, named from the workspace ROOT so a file can be
/// read back.
///
/// `fileTypes` decides which files are named, and comes from settings read in the main process
/// rather than from anything the renderer sends. A type that is off is not shown - and is refused
/// separately if the model asks for it. Folders are named whatever types are on, except `.git` and
/// `node_modules` (see `isSkippedWhenWalking`), and capped at what the wire schema allows.
///
/// Total: it never throws.
async function outlineWorkspace(provider, { path, fileTypes, limit = DEFAULT_OUTLINE_FILE_LIMIT }) {
  const listing = await provider.list(path);
  if (!listing.ok) return { path: "", paths: [], folders: [], truncated: false };

  // Sorted so the same folder produces the same menu twice running. Without it the order is the
  // provider's, and which files the model can see would drift between turns.
  const files = listing.nodes
    .filter((node) => node.kind === "file" && isOpenable(node.name, fileTypes))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((node) => node.id);

  const folders = listing.nodes
    .filter((node) => node.kind === "directory" && !isSkippedWhenWalking(node.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((node) => node.id);

  return {
    path,
    paths: files.slice(0, limit),
    folders: folders.slice(0, OUTLINE_PATH_LIMIT),
    // Reported rather than silently short: an outline that stopped without saying so would have the
    // model answering as though it had seen the whole folder.
    truncated: files.length > limit || folders.length > OUTLINE_PATH_LIMIT,
  };
}

module.exports = { outlineWorkspace };
