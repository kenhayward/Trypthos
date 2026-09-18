"use strict";

const ignore = require("ignore");

/// What a folder's graph leaves out.
///
/// A vault is a folder somebody curates. An arbitrary folder is not: a project checkout holds its
/// dependencies and its build output, and on this repository that is a hundred times more markdown
/// than the project itself. Two rules, applied together rather than as alternatives.
///
/// **A floor**, always: directory names that are never a person's own writing.
///
/// **The folder's own `.gitignore`**, when it has one - exactly the set a developer already curates.
/// Parsed with the `ignore` package rather than by hand: gitignore has negation, anchoring and
/// directory-only patterns, and a hand-rolled reading of those is a source of wrong answers nobody
/// would think to test.
///
/// The floor sits BENEATH the `.gitignore`. A `.gitignore` in a nested package, or in a repository
/// that vendors its dependencies, may never mention `node_modules`, and treating the two as
/// alternatives would let the whole problem back in. The cost - a `!` rule reaching into a denied
/// directory is ignored - is recorded in the spec.
///
/// Main process only. It lives here rather than in the domain package because the domain is also
/// compiled into the renderer, and nothing there has any use for a gitignore parser.

const DENIED_DIRECTORIES = new Set(
  [
    "node_modules",
    "dist",
    "build",
    "out",
    "target",
    "vendor",
    "coverage",
    "venv",
    ".venv",
    "__pycache__",
    "bin",
    "obj",
    "Pods",
    "DerivedData",
  ].map((name) => name.toLowerCase()),
);

/// `ignore` refuses an empty path and one with a leading slash, by throwing. A walk must never stop
/// because of what one entry is called, so those are simply not skipped.
function askable(path) {
  return typeof path === "string" && path !== "" && !path.startsWith("/");
}

function lastSegment(path) {
  const at = path.lastIndexOf("/");
  return at === -1 ? path : path.slice(at + 1);
}

function createIgnoreRules(gitignoreText) {
  let matcher = null;
  if (typeof gitignoreText === "string" && gitignoreText.trim() !== "") {
    try {
      matcher = ignore().add(gitignoreText);
    } catch {
      // A .gitignore this package cannot read leaves the floor on its own. There is nothing to say
      // to the user about it: the graph is still built, just with less excluded.
      matcher = null;
    }
  }

  const gitignores = (path) => {
    if (matcher === null || !askable(path)) return false;
    try {
      return matcher.ignores(path);
    } catch {
      return false;
    }
  };

  return {
    /// `ignore` matches a directory-only pattern such as `drafts/` only when asked about `drafts/`,
    /// so a directory is always asked about with its trailing slash.
    skipsDirectory(path) {
      if (DENIED_DIRECTORIES.has(lastSegment(path).toLowerCase())) return true;
      return gitignores(`${path}/`);
    },
    skipsFile(path) {
      return gitignores(path);
    },
  };
}

module.exports = { createIgnoreRules, DENIED_DIRECTORIES };
