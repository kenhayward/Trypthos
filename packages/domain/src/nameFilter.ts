import { z } from "zod";

/// Matching a file name against the browser's filter box.
///
/// One module, in the domain, because the two halves run in different processes and must agree
/// exactly: the main process walks the tree and decides what matched, and the renderer draws what
/// came back beside a box the user is still typing in. A filter that meant one thing in the walk and
/// another in the panel would be a list that disagrees with the word above it.
///
/// **The Windows search box is the model**, because that is what a Windows user has already learned:
/// plain text matches anywhere in a name, and `*` (any run of characters) or `?` (exactly one) turn
/// the filter into a pattern that has to match the WHOLE name. `*.md` therefore means "ends in .md"
/// rather than "contains .md", which is the distinction that makes wildcards worth having at all.

/// The characters that turn a filter into a pattern.
const WILDCARDS = /[*?]/;

export function hasWildcards(filter: string): boolean {
  return WILDCARDS.test(filter);
}

/// Escapes everything a regular expression would otherwise read as syntax.
///
/// `*` and `?` are escaped here too and replaced afterwards, so the substitution can never land on
/// characters that came out of an escape - the ordering trap in every hand-rolled glob.
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/// Compiles a filter into the expression that answers it.
///
/// Anchored, because a wildcard filter is a description of a whole name. Case-insensitive, because
/// the box above the tree is not the place to make somebody hold Shift - and because a Windows user
/// filtering `readme` and being shown nothing for `README.md` would call that broken.
function expression(filter: string): RegExp {
  const pattern = literal(filter).replace(/\\\*/g, "[^/]*").replace(/\\\?/g, "[^/]");
  return new RegExp(`^${pattern}$`, "i");
}

/// Whether one file's name answers the filter.
///
/// The NAME, never a path: the tree filters entries, and a filter carrying a separator describes
/// something a single entry cannot be. `[^/]` in the compiled pattern is what keeps `*` from
/// quietly spanning one - the walk feeds this names, and this stays true if somebody ever feeds it
/// a path.
export function matchesName(name: string, filter: string): boolean {
  const query = filter.trim();
  if (query === "") return true;

  if (!hasWildcards(query)) return name.toLowerCase().includes(query.toLowerCase());
  return expression(query).test(name);
}

/// How many matching files one filter reports.
///
/// A bound on effort, like Find in Files': a filter of `*` describes every file in the tree, and a
/// list nobody can scroll is not an answer. What is cut short says so on screen.
export const FILTER_MATCH_LIMIT = 500;

/// How many folders one filter opens before it gives up.
///
/// Separate from the match limit, and the reason a filter that matches nothing still ends: the walk
/// costs a listing per folder whether or not anything in it matches. Measured on a home directory, a
/// full walk took 39 seconds across 113,000 folders - so this is what stands between a filter and
/// that.
export const FILTER_FOLDER_LIMIT = 4000;

/// Filtering the files under one folder of the workspace. From the renderer, so the main process
/// parses it.
///
/// `path` carries no pattern check, following `FindRequest`: the boundary is the workspace guard the
/// provider applies when it resolves a path, and a lexical copy written into a schema is the
/// per-caller re-implementation that would eventually be the weaker of the two.
export const FilterRequest = z
  .object({
    path: z.string(),
    /// Never empty: an empty filter describes every file there is, and asking for that is a walk of
    /// the whole tree to answer a question nobody asked.
    filter: z.string().min(1),
  })
  .strict();

export type FilterRequest = z.infer<typeof FilterRequest>;
