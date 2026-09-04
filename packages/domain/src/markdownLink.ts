import { isMarkdownFile } from "./workspaceTree";

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
  /// A markdown file inside the open workspace. The path is workspace-relative, exactly as the
  /// folder browser names one, and is validated again in the main process before anything is read.
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
  /// Inside the workspace, but not a file the editor opens.
  | "not-markdown";

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

export function linkAction(href: string, fromPath: string | null): LinkAction {
  const trimmed = href.trim();
  if (trimmed === "") return { kind: "none", reason: "empty" };

  if (trimmed.startsWith("#")) {
    const fragment = trimmed.slice(1);
    return fragment === ""
      ? { kind: "none", reason: "empty" }
      : { kind: "anchor", fragment };
  }

  // Two leading separators are a host, not a path: `//example.com/a` is a URL whose scheme is
  // inherited from the page, and `\\server\share` is a Windows network share. Neither is inside the
  // workspace, and both would survive the walk below as an ordinary-looking relative path once the
  // separators were unified - which is precisely the reading that must not happen.
  if (/^[/\\]{2}/.test(trimmed)) return { kind: "none", reason: "unsupported-scheme" };

  const scheme = SCHEME.exec(trimmed);
  if (scheme !== null) {
    return EXTERNAL_SCHEMES.has(scheme[0].toLowerCase())
      ? { kind: "external", url: trimmed }
      : { kind: "none", reason: "unsupported-scheme" };
  }

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
  const base = unified.startsWith("/") ? "" : (fromPath === null ? "" : folderOf(fromPath));

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

  const path = segments.join("/");
  // The same idea of markdown the folder browser uses. A link to a PDF is refused rather than opened
  // as text, because the editor has nothing to show for it.
  if (!isMarkdownFile(segments[segments.length - 1]!)) {
    return { kind: "none", reason: "not-markdown" };
  }

  return { kind: "document", path };
}
