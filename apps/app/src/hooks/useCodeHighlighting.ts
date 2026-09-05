import { useEffect, type RefObject } from "react";
import { highlightCodeBlocks } from "../lib/codeHighlight";

/// Colours the fenced code blocks inside a container of rendered markdown.
///
/// Takes a ref the caller already has rather than making one, because both callers have a container
/// for their own reasons - Preview is the rendered document, the chat panel is the whole thread.
///
/// `content` is whatever changes when the markup does. It is a dependency rather than something
/// this watches, because only the caller knows what that is: the source text for Preview, the turns
/// for a reply being streamed a token at a time.
///
/// Re-running is cheap by design: a coloured block is marked, so a pass over an unchanged container
/// is one query. That matters for the chat panel, where this runs on every token that arrives.
export function useCodeHighlighting(
  container: RefObject<HTMLElement | null>,
  fileTypes: readonly string[],
  content: unknown,
): void {
  useEffect(() => {
    const element = container.current;
    if (element === null) return;

    // Flipped by the cleanup, and read after every await inside. The document can be replaced while
    // a grammar is still loading, and writing into it then would paint one document's colouring
    // onto another's text.
    let stopped = false;
    void highlightCodeBlocks(element, fileTypes, () => stopped);

    return () => {
      stopped = true;
    };
  }, [container, fileTypes, content]);
}
