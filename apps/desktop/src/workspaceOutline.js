"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { OUTLINE_PATH_LIMIT, isHidden, isMarkdownFile } = require("@trypthos/domain");

/// Listing the markdown files in the open folder, for chat to use as a map.
///
/// **In the main process because a recursive walk is not cheap.** Measured on a home directory, one
/// took 39 seconds across 113,553 folders. Everything here exists to make sure that never happens
/// to somebody mid-question: a cap on how many paths are collected, hidden directories skipped, and
/// the folders nobody means by "my notes" never descended into at all.
///
/// Paths only, never contents. A notes folder can be thousands of files; sending them would blow any
/// context window, cost real money on a hosted endpoint, and bury the document the question was
/// actually about. A map turns "I don't know what you have" into a conversation the user can steer.

/// Directories that are somebody else's business.
///
/// A folder a person opens will often contain a repository or a package tree, and descending into
/// one would spend the whole cap on files nobody was asking about. Hidden directories are excluded
/// separately, by the same rule the workspace tree uses.
const SKIP = new Set(["node_modules", "dist", "build", "out", "coverage", "target", "vendor"]);

/// The markdown files under `root`, relative to it.
///
/// Total: it never throws. One unreadable directory - a permissions problem, a device that went
/// away - must not cost the listing of everything beside it, and a folder that has been deleted
/// answers with an empty outline rather than an error nobody can act on.
async function outlineWorkspace(root) {
  const paths = [];
  let truncated = false;

  /// Breadth-first, so a deep corner of the tree cannot consume the cap before the top level is
  /// listed. What the user sees first should be what they would see first in the panel.
  const queue = [""];

  while (queue.length > 0 && !truncated) {
    const relative = queue.shift();

    let entries;
    try {
      entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      // Forward slashes on both platforms: these paths go to a model and come back in its answer,
      // and a mixture would be one more thing for the user to reconcile.
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;

      if (entry.isDirectory()) {
        if (!isHidden(entry.name) && !SKIP.has(entry.name)) queue.push(child);
        continue;
      }

      if (!entry.isFile() || !isMarkdownFile(entry.name)) continue;

      if (paths.length >= OUTLINE_PATH_LIMIT) {
        // Reported rather than silently short: an outline that stopped without saying so would have
        // the model answering as though it had seen the whole folder.
        truncated = true;
        break;
      }
      paths.push(child);
    }
  }

  return { paths, truncated };
}

module.exports = { outlineWorkspace };
