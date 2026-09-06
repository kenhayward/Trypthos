"use strict";

const {
  DIFF_LINE_LIMIT,
  DIFF_TOOL_NAME,
  LIST_ENTRY_LIMIT,
  LIST_TOOL_NAME,
  SEARCH_LINE_LIMIT,
  SEARCH_MATCH_LIMIT,
  SEARCH_TOOL_NAME,
  diffArguments,
  diffLines,
  isOpenable,
  listArguments,
  searchArguments,
  searchExpression,
  withinFolder,
} = require("@trypthos/domain");

/// Carrying out the tools that let a model look around the attached folder.
///
/// **Two fences, and both are here.** Every path goes through the workspace provider, which applies
/// the lexical guard and the realpath check exactly as it does for a file the user opened - and then
/// `withinFolder` requires it to be inside the folder the user attached. The second is not a
/// substitute for the first: attaching a folder is the consent gesture this app has, and the guard
/// is what keeps that folder inside the workspace.
///
/// **Every answer is capped, and every cap is announced.** A model told it has the whole listing
/// when it has the first two hundred entries will answer confidently and wrongly, which is worse
/// than being told the answer was cut short.

/// How many files one search will open before it stops.
///
/// A search is the one tool here that can touch a whole tree, so it needs a bound that is about
/// EFFORT rather than about output: a folder of fifty thousand files would otherwise hold a turn
/// open for minutes with the user watching a spinner.
const SEARCH_FILE_LIMIT = 500;

/// How deep a search or a listing walks. Deep enough for a real project, shallow enough that a
/// symlink loop the realpath check somehow admitted cannot run forever.
const MAX_DEPTH = 12;

function refuse(text) {
  return { ok: true, content: text };
}

/// Lists one directory.
async function list(provider, folder, argumentsJson) {
  const args = listArguments(argumentsJson);
  if (args === null) return refuse("That call could not be read. Send the path as a string.");

  const path = args.path ?? folder;
  if (!withinFolder(folder, path)) {
    return refuse(`${path} is outside the folder attached to this conversation.`);
  }

  const result = await provider.list(path);
  if (!result.ok) return refuse(`${path} could not be listed.`);

  // Sorted, and sorted the same way twice: an unsorted listing changes between turns with nothing
  // having changed on disk, and a model cannot tell that from something moving.
  const entries = [...result.nodes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((node) => (node.kind === "directory" ? `${node.name}/` : node.name));

  if (entries.length === 0) return refuse(`${path || "The attached folder"} is empty.`);

  const shown = entries.slice(0, LIST_ENTRY_LIMIT);
  const cut =
    shown.length < entries.length
      ? `\n(${entries.length - shown.length} more entries not shown.)`
      : "";
  return refuse(`${path || "."}:\n${shown.join("\n")}${cut}`);
}

/// Every file under a directory whose type the user has turned on, breadth first.
///
/// Breadth first on purpose: a search that runs out of budget should have looked at the folder the
/// user pointed at before it looked ten levels down one branch of it.
async function filesUnder(provider, path, fileTypes) {
  const found = [];
  let queue = [{ path, depth: 0 }];

  while (queue.length > 0 && found.length < SEARCH_FILE_LIMIT) {
    const next = [];
    for (const { path: directory, depth } of queue) {
      const result = await provider.list(directory);
      if (!result.ok) continue;

      for (const node of [...result.nodes].sort((a, b) => a.name.localeCompare(b.name))) {
        if (node.kind === "directory") {
          if (depth + 1 <= MAX_DEPTH) next.push({ path: node.id, depth: depth + 1 });
        } else if (isOpenable(node.name, fileTypes) && found.length < SEARCH_FILE_LIMIT) {
          found.push(node.id);
        }
      }
    }
    queue = next;
  }

  return found;
}

async function search(provider, folder, fileTypes, argumentsJson) {
  const args = searchArguments(argumentsJson);
  if (args === null) {
    return refuse("That call could not be read. Send a pattern as a string.");
  }

  const path = args.path ?? folder;
  if (!withinFolder(folder, path)) {
    return refuse(`${path} is outside the folder attached to this conversation.`);
  }

  const expression = searchExpression(args.pattern);
  // Told, not guessed at. Falling back to a literal search would quietly answer a different
  // question from the one that was asked.
  if (expression === null) return refuse(`${args.pattern} is not a valid regular expression.`);

  const files = await filesUnder(provider, path, fileTypes);
  const matches = [];
  let scanned = 0;

  for (const file of files) {
    if (matches.length >= SEARCH_MATCH_LIMIT) break;
    const read = await provider.read(file);
    // A file that cannot be read is skipped rather than reported: it is nearly always one that is
    // not text, and a search answer full of apologies about binary files is worse than one without.
    if (!read.ok) continue;
    scanned += 1;

    const lines = read.content.split(/\r?\n/);
    for (let n = 0; n < lines.length && matches.length < SEARCH_MATCH_LIMIT; n += 1) {
      const line = lines[n];
      if (!expression.test(line)) continue;

      const trimmed = line.trim();
      const shown =
        trimmed.length > SEARCH_LINE_LIMIT ? `${trimmed.slice(0, SEARCH_LINE_LIMIT)}...` : trimmed;
      matches.push(`${file}:${n + 1}: ${shown}`);
    }
  }

  if (matches.length === 0) {
    return refuse(`No line in ${scanned} file(s) under ${path || "the attached folder"} matched.`);
  }

  const capped =
    matches.length >= SEARCH_MATCH_LIMIT
      ? `\n(Stopped at ${SEARCH_MATCH_LIMIT} matches. Narrow the search for the rest.)`
      : "";
  const partial =
    files.length >= SEARCH_FILE_LIMIT
      ? `\n(Stopped after ${SEARCH_FILE_LIMIT} files. There may be more.)`
      : "";
  return refuse(`${matches.join("\n")}${capped}${partial}`);
}

async function diff(provider, folder, argumentsJson) {
  const args = diffArguments(argumentsJson);
  if (args === null) {
    return refuse("That call could not be read. Send two file paths as strings.");
  }

  for (const side of [args.left, args.right]) {
    if (!withinFolder(folder, side)) {
      return refuse(`${side} is outside the folder attached to this conversation.`);
    }
  }

  const left = await provider.read(args.left);
  if (!left.ok) return refuse(`${args.left} could not be read.`);
  const right = await provider.read(args.right);
  if (!right.ok) return refuse(`${args.right} could not be read.`);

  const result = diffLines(left.content, right.content, { limit: DIFF_LINE_LIMIT });
  if (result.identical) return refuse(`${args.left} and ${args.right} are identical.`);

  const cut = result.truncated ? `\n(Stopped at ${DIFF_LINE_LIMIT} lines.)` : "";
  return refuse(`--- ${args.left}\n+++ ${args.right}\n${result.text}${cut}`);
}

/// The tools, bound to one conversation's folder.
///
/// Returns null for a name it does not carry out, which is how the caller tells "this is not one of
/// mine" from "this failed" - the read tool is answered elsewhere, and an unknown name from a model
/// is a thing to report rather than to guess at.
function createFolderToolRunner({ provider, folder, fileTypes }) {
  return async (name, argumentsJson) => {
    if (name === LIST_TOOL_NAME) return await list(provider, folder, argumentsJson);
    if (name === SEARCH_TOOL_NAME) return await search(provider, folder, fileTypes, argumentsJson);
    if (name === DIFF_TOOL_NAME) return await diff(provider, folder, argumentsJson);
    return null;
  };
}

module.exports = { createFolderToolRunner, MAX_DEPTH, SEARCH_FILE_LIMIT };
