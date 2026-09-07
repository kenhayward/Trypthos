import { z } from "zod";

/// Finding text - in the document on screen, and in the files under a folder.
///
/// One module for both, in the domain, because the two halves run in different processes and must
/// agree exactly: the renderer matches the buffer it is showing, the main process matches the bytes
/// it reads off disk, and a query that meant one thing in one and something else in the other would
/// be a search that finds a line the editor then cannot highlight.

export interface FindMatch {
  /// Character offsets into the text, which is what CodeMirror wants and what a file hit carries
  /// back so the editor can highlight it after opening the file.
  from: number;
  to: number;
}

export interface FindOptions {
  /// Whether the query is a regular expression or the characters themselves.
  ///
  /// Told, never guessed at. A query that LOOKS like a pattern is not the same as one meant as one -
  /// somebody searching a document for `a.b` means those three characters.
  regex: boolean;
  /// Whether `Cat` and `cat` are the same word.
  ///
  /// Required rather than defaulted, deliberately. It changes which lines come back, and an option
  /// like that left to a default is how a caller ends up quietly asking a different question from
  /// the one it meant. The DIALOG defaults it to off, which is where a default belongs.
  caseSensitive: boolean;
}

/// How many matches one search reports, across every file it looks in.
///
/// A bound on effort rather than on taste: a one-letter query against a large tree would otherwise
/// build a list nobody could walk and hold the window while it did.
export const FIND_MATCH_LIMIT = 500;

/// How many files a search opens before it stops. The same bound the chat folder tools use, and for
/// the same reason.
export const FIND_FILE_LIMIT = 500;

/// How deep the walk goes below the folder it is given.
export const FIND_MAX_DEPTH = 12;

/// How much of a matching line is carried back in a result.
const PREVIEW_LIMIT = 200;

/// Escapes a plain query so a regular expression matches it literally.
function literal(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/// Compiles a query, or answers null when it cannot be compiled.
///
/// `g` to walk the whole text, and `m` so `^` and `$` mean a line rather than the whole document -
/// which is what somebody writing `^import` against a source file expects. `i` is the caller's
/// choice: off is what the rest of the app does, and on is what makes a search of a source file
/// useful, where `state` and `State` are two different things.
function expression(query: string, { regex, caseSensitive }: FindOptions): RegExp | null {
  try {
    return new RegExp(regex ? query : literal(query), caseSensitive ? "gm" : "gim");
  } catch {
    return null;
  }
}

/// Every place `query` occurs in `text`, or null when the query is not a usable expression.
///
/// Null and `[]` are different answers, deliberately: "that is not a pattern" and "nothing here
/// matches" send the user in opposite directions, and a dialog showing the second for the first
/// leaves somebody retyping a query that can never work.
export function findMatches(
  text: string,
  query: string,
  options: FindOptions,
  limit: number = FIND_MATCH_LIMIT,
): FindMatch[] | null {
  if (query === "") return [];

  const pattern = expression(query, options);
  if (pattern === null) return null;

  const matches: FindMatch[] = [];
  let match: RegExpExecArray | null;
  while (matches.length < limit && (match = pattern.exec(text)) !== null) {
    matches.push({ from: match.index, to: match.index + match[0].length });
    // A pattern that can match nothing - `x*`, `\b` - leaves `lastIndex` where it was, so the same
    // empty match is found for ever and the window hangs. Nudging it forward is the whole guard.
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return matches;
}

/// One match, described well enough to be listed and then reopened.
export interface FileHit extends FindMatch {
  /// Workspace-relative, so it is a path the renderer can open.
  path: string;
  /// One-based, as every editor counts them.
  line: number;
  column: number;
  /// The line the match is on, trimmed and shortened - a minified file is one line of forty thousand
  /// characters, and a result nobody can read is not a result.
  preview: string;
}

/// Where `query` occurs in one file's text.
///
/// The offsets are into the text exactly as it was read, CRLF and all: they are what the editor will
/// highlight, so they have to describe the same string the editor is showing.
export function fileHits(
  path: string,
  text: string,
  query: string,
  options: FindOptions,
  limit: number,
): FileHit[] | null {
  const matches = findMatches(text, query, options, limit);
  if (matches === null) return null;

  const hits: FileHit[] = [];
  // Walked once alongside the matches rather than counted per match: `lastIndexOf` from every offset
  // turns a file with many matches into a quadratic scan of itself.
  let line = 1;
  let lineStart = 0;
  let cursor = 0;

  for (const match of matches) {
    while (cursor < match.from) {
      if (text[cursor] === "\n") {
        line += 1;
        lineStart = cursor + 1;
      }
      cursor += 1;
    }

    let lineEnd = text.indexOf("\n", match.from);
    if (lineEnd === -1) lineEnd = text.length;
    const whole = text.slice(lineStart, lineEnd).replace(/\r$/, "").trim();

    hits.push({
      path,
      line,
      column: match.from - lineStart + 1,
      from: match.from,
      to: match.to,
      preview: whole.length > PREVIEW_LIMIT ? `${whole.slice(0, PREVIEW_LIMIT)}...` : whole,
    });
  }

  return hits;
}

/// Which folder a "find in files" looks in.
///
/// The folder the user picked, or - when they have picked none, which is what "" means, since no
/// folder row is then drawn as selected - the folder the document they are reading lives in.
/// Otherwise the whole workspace.
///
/// A document with no file behind it answers the root, and needs no special case to do it: the
/// built-in guide (`trypthos:markdown-guide`) and an unsaved draft both have paths with no folder
/// segment in them, which is the same shape as a file sitting at the top of the workspace.
export function searchScopeFolder(selection: {
  selectedFolder: string;
  activePath: string | null;
}): string {
  if (selection.selectedFolder !== "") return selection.selectedFolder;

  const active = selection.activePath;
  if (active === null) return "";

  const cut = active.lastIndexOf("/");
  return cut === -1 ? "" : active.slice(0, cut);
}

/// Searching the files under a folder. From the renderer, so the main process parses it.
///
/// `path` carries no pattern check, following `ListRequest` and `OutlineRequest`: the boundary is the
/// workspace guard the provider applies when it resolves a path, and a lexical copy written into a
/// schema is the per-caller re-implementation that would eventually be the weaker of the two.
export const FindRequest = z
  .object({
    path: z.string(),
    /// Never empty: an empty query matches every position in every file.
    pattern: z.string().min(1),
    regex: z.boolean(),
    caseSensitive: z.boolean(),
    /// The file types the user has turned on. A search must not read what the browser will not list.
    fileTypes: z.array(z.string()),
  })
  .strict();

export type FindRequest = z.infer<typeof FindRequest>;
