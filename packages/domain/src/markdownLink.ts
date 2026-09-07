import { isOpenable } from "./fileTypes";
import { qualifyPath, splitQualified } from "./qualifiedPath";

/// What clicking a link in rendered markdown should do.
///
/// One decision, made once, for every surface that renders markdown: Preview mode, the chat panel's
/// replies, the About box. Pure, so the rule can be exercised without a DOM and without a shell -
/// and shared with the main process, which asks `isExternalUrl` again before handing anything to the
/// operating system.
///
/// The default an anchor has in a page is the one thing this exists to prevent. A frameless window
/// with no address bar and no back button that navigates to a remote page has replaced the
/// application with that page, and given it the app's own origin on the way.

export type LinkAction =
  /// A file inside the open workspace, of a type the user has turned on. The path is
  /// workspace-relative, exactly as the folder browser names one, and is validated again in the
  /// main process before anything is read.
  | { kind: "document"; path: string }
  /// A web address, for the user's browser.
  | { kind: "external"; url: string }
  /// A fragment on the page being read.
  | { kind: "anchor"; fragment: string }
  /// Nothing happens, and the reason says why.
  | { kind: "none"; reason: LinkRejection };

export type LinkRejection =
  /// Nothing, or only whitespace, or a bare `#`.
  | "empty"
  /// A NUL byte, or percent-encoding that does not decode.
  | "invalid-characters"
  /// A scheme that is neither a web address nor a workspace path.
  | "unsupported-scheme"
  /// Lexically well-formed, but `..` walks above the workspace root.
  | "escapes-workspace"
  /// Relative, in a document that is not in a workspace - the scratch buffer, the built-in guide, or
  /// a chat reply with no folder attached. There is no folder for it to be relative TO.
  | "no-workspace"
  /// Inside the workspace, but not a file the editor opens - either no file type describes it, or
  /// the type that does is turned off. Both mean the same thing to a click: nothing happens.
  | "not-openable";

/// The schemes handed to the operating system, and the complete list of them.
///
/// An allow-list rather than a deny-list, because the interesting ones are the schemes nobody
/// thought of: `file:` reads anything on the machine, and Windows in particular registers handlers
/// (`ms-msdt:`, `search-ms:`) that do rather more than open a page.
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/// A scheme, in the sense the URL grammar means: a letter followed by letters, digits and `+-.`,
/// then a colon. A Windows drive letter matches, which is correct - `C:\notes.md` is not
/// workspace-relative and must not be resolved as though it were.
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/// Whether this is a URL the shell may open.
///
/// Exported because the main process asks it again on arrival: the renderer is untrusted, so the
/// renderer having already decided is not a decision. Same function rather than a second list, which
/// is the only way the two answers cannot drift apart.
export function isExternalUrl(url: string): boolean {
  const match = SCHEME.exec(url.trim());
  return match !== null && EXTERNAL_SCHEMES.has(match[0].toLowerCase());
}

/// The parent folder of a workspace-relative file path. "" for a file at the root.
function folderOf(filePath: string): string {
  const cut = filePath.lastIndexOf("/");
  return cut === -1 ? "" : filePath.slice(0, cut);
}

/// Whether a link names a scheme the app will not hand anywhere.
///
/// Split out because one caller asks only this and cannot answer anything else: `renderMarkdown`
/// decides whether to show a link's target in its hover text, and it renders the same markdown in
/// Preview, in chat replies and in the About box - so it does not know which document is open, and
/// must not be handed a question about file types that has no answer where it stands.
export function isUnsupportedScheme(href: string): boolean {
  const trimmed = href.trim();

  // Two leading separators are a host, not a path: `//example.com/a` is a URL whose scheme is
  // inherited from the page, and `\\server\share` is a Windows network share. Neither is inside the
  // workspace, and both would survive the walk below as an ordinary-looking relative path once the
  // separators were unified - which is precisely the reading that must not happen.
  if (/^[/\\]{2}/.test(trimmed)) return true;

  const scheme = SCHEME.exec(trimmed);
  return scheme !== null && !EXTERNAL_SCHEMES.has(scheme[0].toLowerCase());
}

/// What clicking this link should do.
///
/// `enabled` is the user's file types, by id. It is required rather than defaulted because there is
/// no safe default: a link the folder browser would not show must not be a link the editor opens,
/// and a caller that cannot answer the question is a caller asking the wrong function - see
/// `isUnsupportedScheme`.
export function linkAction(
  href: string,
  fromPath: string | null,
  enabled: readonly string[],
  /// Which workspace a link with no folder of its own belongs to.
  ///
  /// Two cases need it, and both are cases where `fromPath` cannot answer: a link written with a
  /// leading separator, which means "the root" and has to be told WHICH root, and a link in a
  /// document that is not in a workspace at all - the scratch buffer, or a reply in the chat panel.
  /// Null with nothing else to go on makes the link nothing at all, which is the honest answer.
  workspaceId: string | null = null,
): LinkAction {
  const trimmed = href.trim();
  if (trimmed === "") return { kind: "none", reason: "empty" };

  if (trimmed.startsWith("#")) {
    const fragment = trimmed.slice(1);
    return fragment === ""
      ? { kind: "none", reason: "empty" }
      : { kind: "anchor", fragment };
  }

  if (isUnsupportedScheme(trimmed)) return { kind: "none", reason: "unsupported-scheme" };
  if (isExternalUrl(trimmed)) return { kind: "external", url: trimmed };

  // Everything from here is workspace-relative. The fragment and query are dropped rather than
  // carried: what is wanted is the file, and neither has a meaning the editor could honour yet.
  const withoutFragment = trimmed.split("#")[0]!.split("?")[0]!;

  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // `decodeURIComponent` throws on a truncated escape. A link nobody can spell is not a link.
    return { kind: "none", reason: "invalid-characters" };
  }

  if (decoded.includes("\u0000")) return { kind: "none", reason: "invalid-characters" };
  if (decoded.trim() === "") return { kind: "none", reason: "empty" };

  // Separators are unified first, so a backslash cannot smuggle traversal past a slash-only walk -
  // the same reason `workspacePath` does it. A leading separator means the workspace root, which is
  // the only reading available: there is no drive and no filesystem root inside a workspace.
  const unified = decoded.replace(/\\/g, "/");
  // Which workspace this link lands in, and where inside it the walk starts.
  //
  // The two are held apart deliberately. A link resolves WITHIN one workspace, so the workspace is
  // taken off the front first and put back at the end - which means the `..` guard below counts only
  // the folders inside it, and a link that climbs past the workspace root is refused by exactly the
  // check that always refused climbing past the root. Joining first and inspecting afterwards would
  // let `../../elsewhere.md` become a plausible-looking path in no workspace at all.
  const source = fromPath === null ? null : splitQualified(fromPath);
  const workspace = source?.workspaceId ?? workspaceId;
  // Nothing to resolve against. A relative link in a document that is not in a folder - the scratch
  // buffer, the built-in guide - names no file, so it is not a link.
  if (workspace === null) return { kind: "none", reason: "no-workspace" };

  const base = unified.startsWith("/") || source === null ? "" : folderOf(source.path);

  const segments = base === "" ? [] : base.split("/");
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Caught here rather than by inspecting the joined path afterwards, which is too late: by then
      // "book/../../notes.md" has become an ordinary-looking relative path.
      if (segments.length === 0) return { kind: "none", reason: "escapes-workspace" };
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) return { kind: "none", reason: "empty" };

  const path = qualifyPath(workspace, segments.join("/"));
  // The same catalogue the folder browser filters on, so a link the tree would not show is a link
  // the editor will not open. Two lists answering this separately is two lists that will disagree.
  if (!isOpenable(segments[segments.length - 1]!, enabled)) {
    return { kind: "none", reason: "not-openable" };
  }

  return { kind: "document", path };
}
