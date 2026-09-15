import {
  isOpenable,
  linkAction,
  parseWikiLink,
  pickWikiTarget,
  splitQualified,
  wikiLinkFileName,
} from "@trypthos/domain";
import { headingSlug } from "./markdownExtensions";

/// What happens when a link in rendered markdown is clicked.
///
/// The rule itself lives in the domain (`linkAction`); this is the DOM half - which anchor was hit,
/// and stopping the default before anything else. The default is the bug: a frameless window with no
/// address bar and no back button that follows a link has replaced the application with that page,
/// and handed a remote page the app's own origin on the way.
///
/// Delegated rather than bound per anchor, because the HTML is injected wholesale and there are no
/// React elements to attach to. It matches on `data-md-link`, which `renderMarkdown` puts on every
/// anchor it emits: an anchor the app draws itself is left alone, and a surface that starts
/// rendering markdown tomorrow is covered without being told to be.

export interface MarkdownLinkHandlers {
  /// The open document, so a relative link resolves the way the author meant it. Null when nothing
  /// is open, which makes the workspace root the base.
  fromPath: string | null;
  /// The file types the user has turned on, by id. A link to a file the folder browser would not
  /// show must not be a link that opens, or the tree and the document disagree about the same file.
  fileTypes: readonly string[];
  /// Which folder a link with no folder of its own belongs to - one written with a leading
  /// separator, or one in a document that is not in a workspace at all.
  workspaceId?: string | null;
  /// Opens a file in the workspace. Qualified, and validated again in the shell.
  openDocument(path: string): void;
  /// Hands a web address to the user's browser.
  openExternal(url: string): void;
  /// The qualified paths of files in one workspace whose name contains `name`, for an Obsidian wiki
  /// link - which names a note rather than a path. Absent where there is no workspace to search,
  /// which leaves a wiki link resolved as a path from the note it is in.
  findByName?(name: string, workspaceId: string): Promise<readonly string[]>;
}

/// The parts of a click this needs. Narrow on purpose, so the handler can be exercised with a plain
/// object rather than a synthesised React event.
export interface LinkClick {
  target: EventTarget | null;
  preventDefault(): void;
}

/// Acts on a link the user asked to follow, however they asked.
///
/// Shared by the rendered surfaces below and by Live mode's modified click, so a link behaves the
/// same whether it was read as prose or as the text being edited. Doing nothing is a legitimate
/// outcome and the common one for a target the app has nowhere to put.
export function followLink(href: string, handlers: MarkdownLinkHandlers): void {
  const action = linkAction(href, handlers.fromPath, handlers.fileTypes, handlers.workspaceId ?? null);
  if (action.kind === "external") handlers.openExternal(action.url);
  else if (action.kind === "document") handlers.openDocument(action.path);
  else if (action.kind === "anchor") scrollToAnchor(action.fragment);
}

/// Scrolls to an in-page target. The renderer prefixes the ids it gives headings, footnotes and
/// blocks - see `headingIds` - so an author's `#section` is looked for under both spellings. Finding
/// nothing is a correct outcome, quietly.
function scrollToAnchor(fragment: string): void {
  const target = document.getElementById(fragment) ?? document.getElementById(`md-${fragment}`);
  target?.scrollIntoView({ block: "start" });
}

/// Follows an Obsidian wiki link, `[[Note#Heading]]` as written without its brackets.
///
/// Obsidian finds a note by name anywhere in the vault, so this searches the note's workspace - through
/// the shell's guarded name filter - and opens the nearest match. With nothing found it falls back to
/// the path beside the note, whose failure to open is what tells the user the note is not there.
export async function followWikiLink(written: string, handlers: MarkdownLinkHandlers): Promise<void> {
  const link = parseWikiLink(written);
  if (link.target === "") {
    if (link.heading !== null) scrollToAnchor(headingSlug(link.heading));
    else if (link.block !== null) scrollToAnchor(`^${link.block}`);
    return;
  }

  const fileName = wikiLinkFileName(link.target);
  const name = fileName.slice(fileName.lastIndexOf("/") + 1);
  // The same rule as any link: what the folder browser would not open, a link does not open either.
  if (!isOpenable(name, handlers.fileTypes)) return;

  const target = await findWikiTarget(link.target, handlers.fromPath, handlers);
  if (target !== null) handlers.openDocument(target);
  else followLink(fileName, handlers);
}

/// The qualified path of the file a wiki link's target names, found by name in the linking note's
/// workspace, or null when nothing there has that name.
export async function findWikiTarget(
  target: string,
  fromPath: string | null,
  where: Pick<MarkdownLinkHandlers, "workspaceId" | "findByName">,
): Promise<string | null> {
  const fileName = wikiLinkFileName(target);
  const name = fileName.slice(fileName.lastIndexOf("/") + 1);
  const workspaceId = (fromPath === null ? null : splitQualified(fromPath)?.workspaceId) ?? where.workspaceId ?? null;
  if (workspaceId === null || where.findByName === undefined) return null;
  return pickWikiTarget(await where.findByName(name, workspaceId), fileName, fromPath);
}

export function markdownLinkHandler(handlers: MarkdownLinkHandlers) {
  return (event: LinkClick): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest("a[data-md-link]");
    if (anchor === null) return;

    // Before the decision, not after it. Every outcome - including doing nothing - is one in which
    // the window must not navigate.
    event.preventDefault();

    const wiki = anchor.getAttribute("data-wikilink");
    if (wiki !== null) void followWikiLink(wiki, handlers);
    else followLink(anchor.getAttribute("href") ?? "", handlers);
  };
}
