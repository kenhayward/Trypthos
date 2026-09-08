"use strict";

const {
  FILTER_FOLDER_LIMIT,
  FILTER_MATCH_LIMIT,
  FIND_MAX_DEPTH,
  isHidden,
  matchesName,
  sortNodes,
} = require("@trypthos/domain");

/// The browser's filter box: the walk behind it.
///
/// **Every path goes through the workspace provider**, never through `fs` - the same rule as Find in
/// Files, and for the same reason: the provider is what applies the boundary guard, including the
/// realpath check a lexical test cannot make.
///
/// **Nothing here reads a file.** It matches names, so a type the user has turned off is matched
/// like any other - the browser LISTS those files and draws them grey, and a filter that could not
/// find them would disagree with the tree it sits above. That is also why this is not `searchFiles`
/// with a different matcher: that one opens every file it looks at, and must not.
///
/// **The answer is capped and says so.** A filter of `*` describes every file in the tree, and a
/// walk of a whole home directory took 39 seconds when it was measured. A list silently cut short is
/// a wrong answer given confidently.

/// Files under `path` whose name answers `filter`, breadth first.
///
/// Breadth first on purpose, as in `fileSearch`: a walk that runs out of budget should have looked
/// at the folder the user is standing in before it looked twelve levels down one branch of it.
///
/// `limits` exists for the tests, which cannot afford to build four thousand folders to prove that
/// the walk stops.
async function searchNames(provider, { path: start, filter }, limits = {}) {
  const matchLimit = limits.matches ?? FILTER_MATCH_LIMIT;
  const folderLimit = limits.folders ?? FILTER_FOLDER_LIMIT;

  // Asked before the walk, so a folder outside the workspace is refused without reading anything at
  // all. The guard lives in the provider; this is where its answer is turned into a refusal.
  const opened = await provider.list(start);
  if (!opened.ok) return { ok: false, reason: opened.reason ?? "not-found" };

  const paths = [];
  let queue = [{ path: start, depth: 0 }];
  let listed = 0;
  /// True when the walk ran out of budget, which is a different thing from having found everything.
  let truncated = false;

  while (queue.length > 0 && paths.length < matchLimit && listed < folderLimit) {
    const next = [];

    for (const { path: directory, depth } of queue) {
      if (listed >= folderLimit) {
        truncated = true;
        break;
      }

      const result = await provider.list(directory);
      listed += 1;
      // A folder that cannot be listed is skipped rather than failing the whole filter: one
      // unreadable folder deep in a tree must not take the answer away from every other.
      if (!result.ok) continue;

      for (const node of sortNodes(result.nodes)) {
        // The browser does not list these, so the filter must not find inside them - `.git` alone is
        // thousands of files nobody opened this app to read.
        if (isHidden(node.name)) continue;

        if (node.kind === "directory") {
          if (depth + 1 <= FIND_MAX_DEPTH) next.push({ path: node.id, depth: depth + 1 });
          else truncated = true;
          continue;
        }

        if (!matchesName(node.name, filter)) continue;
        if (paths.length < matchLimit) paths.push(node.id);
        else truncated = true;
      }
    }

    queue = next;
  }

  return { ok: true, paths, truncated: truncated || queue.length > 0 };
}

module.exports = { searchNames };
