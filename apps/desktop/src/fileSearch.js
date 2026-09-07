"use strict";

const {
  FIND_FILE_LIMIT,
  FIND_MATCH_LIMIT,
  FIND_MAX_DEPTH,
  fileHits,
  isOpenable,
} = require("@trypthos/domain");

/// Find in Files: the walk, and the matching.
///
/// **Every path goes through the workspace provider**, never through `fs`. That is what applies the
/// boundary guard - including the realpath check that a lexical test cannot make - so a folder that
/// climbs out of the workspace is refused by `list` rather than by a second implementation here.
///
/// **Only the file types the user has turned on are opened.** A type that is off is not listed in
/// the browser and does not open on a click; a search that read it anyway would be a way to see
/// inside a file the app says it does not open.
///
/// **The answer is capped and says so.** A search is the one thing in the app that can touch a whole
/// tree, so it needs a bound about EFFORT, and a result list silently cut short is a wrong answer
/// given confidently.

/// Every file under a directory whose type is turned on, breadth first.
///
/// Breadth first on purpose, as in `folderToolRunner`: a search that runs out of budget should have
/// looked at the folder the user pointed at before it looked twelve levels down one branch of it.
async function filesUnder(provider, start, fileTypes) {
  const found = [];
  let queue = [{ path: start, depth: 0 }];
  /// True when the walk itself ran out of budget, which is a different thing from the MATCHES
  /// running out - one means "there may be more files", the other "there are more matches".
  let truncated = false;

  while (queue.length > 0 && found.length < FIND_FILE_LIMIT) {
    const next = [];
    for (const { path: directory, depth } of queue) {
      const result = await provider.list(directory);
      // A directory that cannot be listed is skipped rather than failing the whole search: one
      // unreadable folder deep in a tree must not take the answer away from every other.
      if (!result.ok) continue;

      for (const node of [...result.nodes].sort((a, b) => a.name.localeCompare(b.name))) {
        if (node.kind === "directory") {
          if (depth + 1 <= FIND_MAX_DEPTH) next.push({ path: node.id, depth: depth + 1 });
          else truncated = true;
        } else if (isOpenable(node.name, fileTypes)) {
          if (found.length < FIND_FILE_LIMIT) found.push(node.id);
          else truncated = true;
        }
      }
    }
    queue = next;
  }

  return { files: found, truncated: truncated || found.length >= FIND_FILE_LIMIT };
}

/// Searches the files under `start` for `pattern`.
///
/// The refusals are named rather than collapsed into one failure, because they send the user in
/// different directions: `bad-pattern` means retype the expression, and a folder that cannot be
/// listed at all means the folder is gone or outside the workspace.
async function searchFiles(provider, { path: start, pattern, regex, caseSensitive, fileTypes }) {
  // Asked before the walk, so a folder outside the workspace is refused without reading anything at
  // all. The guard lives in the provider; this is where its answer is turned into a refusal.
  const opened = await provider.list(start);
  if (!opened.ok) return { ok: false, reason: opened.reason ?? "not-found" };

  const { files, truncated } = await filesUnder(provider, start, fileTypes);

  const hits = [];
  let capped = truncated;

  for (const file of files) {
    if (hits.length >= FIND_MATCH_LIMIT) {
      capped = true;
      break;
    }

    const read = await provider.read(file);
    // A file that cannot be read is skipped rather than reported: it is nearly always one that is
    // not text, and a result list full of apologies about binary files is worse than one without.
    if (!read.ok) continue;

    const found = fileHits(
      file,
      read.content,
      pattern,
      { regex, caseSensitive },
      FIND_MATCH_LIMIT - hits.length,
    );
    // Null is the pattern failing to compile, which it does identically for every file - so it is
    // reported once, as itself, rather than as an empty result repeated.
    if (found === null) return { ok: false, reason: "bad-pattern" };

    hits.push(...found);
  }

  return { ok: true, hits, capped: capped || hits.length >= FIND_MATCH_LIMIT };
}

module.exports = { searchFiles, filesUnder };
