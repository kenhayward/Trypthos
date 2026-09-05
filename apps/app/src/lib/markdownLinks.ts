import { linkAction } from "@trypthos/domain";

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
  /// Opens a file in the workspace. Workspace-relative, validated again in the shell.
  openDocument(path: string): void;
  /// Hands a web address to the user's browser.
  openExternal(url: string): void;
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
  const action = linkAction(href, handlers.fromPath, handlers.fileTypes);
  if (action.kind === "external") handlers.openExternal(action.url);
  else if (action.kind === "document") handlers.openDocument(action.path);
  else if (action.kind === "anchor") {
    // Nothing generates heading ids yet, so this usually finds nothing - and finding nothing is the
    // correct outcome, quietly.
    document.getElementById(action.fragment)?.scrollIntoView({ block: "start" });
  }
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

    followLink(anchor.getAttribute("href") ?? "", handlers);
  };
}
