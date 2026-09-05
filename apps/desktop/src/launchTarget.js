"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");

/// What Explorer handed the app, and what to do with it.
///
/// The right-click entries start Trypthos with a path - a folder, or a markdown file. Both arrive
/// the same way, as an argument, and both have to become the one thing this app can act on: a folder
/// to open, and optionally a document inside it.
///
/// Untrusted, like every other input from outside. Nothing here believes the argument names anything
/// at all until it has been looked at, and a file it cannot edit is refused rather than opened
/// hopefully.

/// The markdown extensions the file verb is registered for, and the only ones accepted here. The two
/// lists are the same on purpose - accepting more than was registered would mean acting on arguments
/// the app never asked to receive.
const MARKDOWN = [".md", ".markdown"];

/// The path an invocation carried, or null.
///
/// Pure text: whether anything is there is the next question, not this one. Switches are dropped
/// because Chromium adds its own and a user never types one.
function pathFromArgv(argv, { packaged }) {
  // Packaged: [exe, ...arguments]. In development: [electron, appDirectory, ...arguments], where the
  // second entry is the app itself rather than anything a user picked.
  const args = argv.slice(packaged ? 1 : 2);
  return args.find((argument) => !argument.startsWith("-")) ?? null;
}

/// The folder to open, and the document within it - or null when there is nothing to open.
///
/// A FILE resolves to both, because every path this app handles is relative to one open folder: a
/// document names the folder it lives in as much as it names itself.
async function resolveTarget(target, { stat = fs.stat } = {}) {
  if (typeof target !== "string" || target === "") return null;

  let entry;
  try {
    entry = await stat(target);
  } catch {
    // A path that has been deleted or renamed since the menu was drawn. Ordinary, not exceptional.
    return null;
  }

  if (entry.isDirectory()) return { root: target, file: null };
  if (!entry.isFile()) return null;

  const extension = path.extname(target).toLowerCase();
  if (!MARKDOWN.includes(extension)) return null;

  return { root: path.dirname(target), file: path.basename(target) };
}

module.exports = { MARKDOWN, pathFromArgv, resolveTarget };
