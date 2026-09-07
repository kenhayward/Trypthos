import { linkAction } from "@trypthos/domain";

/// Turns the file paths a reply names into links you can click.
///
/// A model writes a path in backticks - it is how every model writes one - and until now that was
/// text you had to go and find in the tree yourself. This wraps the ones the app could actually open
/// in an anchor, and leaves everything else exactly as it was.
///
/// **Replies only, never a user's own document.** Preview renders what somebody wrote, and quietly
/// turning their code spans into links would change how their prose reads. This is applied by the
/// chat panel and nowhere else.
///
/// **The decision is `linkAction`'s**, the same rule a markdown link goes through: workspace
/// boundary, enabled file types, external schemes. So a path in a reply behaves exactly as a link to
/// the same path would, and there is one place where "is this openable" is answered.
///
/// Over the DOM rather than over the markdown, for the same reason `codeHighlight` is: the text is
/// the model's, and it has to survive exactly. Nothing here writes markup - the code span is moved
/// inside an anchor, not rebuilt from a string.

/// Marks a span this has already looked at, so a reply arriving a token at a time is not re-walked
/// from scratch and cannot end up with an anchor inside an anchor.
const CONSIDERED = "data-reply-link";

export function linkifyPaths(
  container: HTMLElement,
  fileTypes: readonly string[],
  /// Which folder the paths in this reply are in.
  ///
  /// A model's paths are relative to the folder it was given, and with several folders open that is
  /// no longer enough to name a file. Null makes nothing a link, which is the honest answer: a path
  /// with no folder behind it names nothing.
  workspaceId: string | null,
): void {
  for (const code of [...container.querySelectorAll("code")]) {
    if (code.hasAttribute(CONSIDERED)) continue;
    code.setAttribute(CONSIDERED, "");

    // A fenced block is code being shown, not a file being named - and its contents have already
    // been taken apart into spans by the syntax highlighter, which this would fight.
    if (code.closest("pre") !== null) continue;
    // Already inside a link the author wrote. Wrapping it again would nest anchors.
    if (code.closest("a") !== null) continue;

    const text = code.textContent ?? "";
    // `fromPath` is null, so a path is read from the root of the workspace named beside it. That is
    // what it means: the paths a model has are the ones the folder outline gave it, and those are
    // relative to the workspace its folder is in.
    const action = linkAction(text, null, fileTypes, workspaceId);
    if (action.kind !== "document" && action.kind !== "external") continue;

    const anchor = document.createElement("a");
    // The href is the text as written, so the click handler resolves it the same way it resolves a
    // link somebody typed - rather than this deciding once here and the handler deciding again.
    anchor.setAttribute("href", text);
    // What the app's own click handler matches on. Reusing it is the point: a path in a reply then
    // opens exactly as a markdown link to it would, through one implementation.
    anchor.setAttribute("data-md-link", "");

    code.replaceWith(anchor);
    anchor.append(code);
  }
}
