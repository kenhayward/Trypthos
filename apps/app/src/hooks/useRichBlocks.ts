import { useEffect, type RefObject } from "react";
import { renderRichBlocks } from "../lib/richBlocks";

/// Typesets math and draws diagrams inside a container of rendered markdown - see `richBlocks`.
///
/// `content` is whatever changes when the markup does, as for `useCodeHighlighting`. Re-running is
/// cheap: what is done is marked, so a pass over an unchanged document is a query.
export function useRichBlocks(container: RefObject<HTMLElement | null>, content: unknown): void {
  useEffect(() => {
    const element = container.current;
    if (element === null) return;

    let stopped = false;
    void renderRichBlocks(element, () => stopped);

    return () => {
      stopped = true;
    };
  }, [container, content]);
}
