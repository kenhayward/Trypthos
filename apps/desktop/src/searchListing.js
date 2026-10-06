"use strict";

/// How the filter box and Find in Files list a folder.
///
/// A provider that can answer from what it already knows says so with `listKnown`; Google Drive does,
/// because a Drive workspace can be all of My Drive and a walk of it would be one network request per
/// folder. Such a walk sees only the folders already opened, and `complete: false` is how the
/// provider says "this one was never listed" - the walkers turn that into `partial` on the answer.
/// The chat outline does not come through here either: it is one level, one request, and uses `list`.
/// Local and GitHub have no `listKnown`, so they are listed exactly as before and are always complete.
///
/// The chat's folder tools do NOT come through here: a tool call is a deliberate request for one
/// folder, and it should be answered properly.
async function listForSearch(provider, path) {
  if (typeof provider.listKnown === "function") return provider.listKnown(path);
  const listed = await provider.list(path);
  return listed.ok ? { ...listed, complete: true } : listed;
}

module.exports = { listForSearch };
