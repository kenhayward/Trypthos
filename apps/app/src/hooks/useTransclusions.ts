import { useEffect, useRef, type RefObject } from "react";
import { highlightCodeBlocks } from "../lib/codeHighlight";
import { renderRichBlocks } from "../lib/richBlocks";
import { renderTransclusions, type TransclusionDeps } from "../lib/transclusions";

/// Shows embedded notes in a container of rendered markdown - see `transclusions`.
///
/// Each note is read once while the same document is on screen. The rendered markup is replaced
/// often - a picture arriving, a keystroke elsewhere in the note - and every replacement puts the
/// placeholders back, so without the cache every one would be a read off disk. A different document
/// starts a fresh cache, which is also how a note edited meanwhile is seen again.
///
/// What lands inside an embed has not been through the code colouring, math or diagrams that ran over
/// the document, so those run again over the container once the embeds are in. Each marks what it has
/// done, so the second pass touches only what is new.
export function useTransclusions(
  container: RefObject<HTMLElement | null>,
  content: unknown,
  deps: Omit<TransclusionDeps, "readDocument"> & { readDocument?: TransclusionDeps["readDocument"] },
): void {
  const cache = useRef<{ from: string | null; notes: Map<string, Promise<string | null>> }>({
    from: null,
    notes: new Map(),
  });
  const { fromPath, workspaceId, fileTypes, findByName, readDocument, readImage } = deps;

  useEffect(() => {
    const element = container.current;
    if (element === null || readDocument === undefined) return;
    if (element.querySelector(".md-transclusion") === null) return;

    if (cache.current.from !== fromPath) cache.current = { from: fromPath, notes: new Map() };
    const notes = cache.current.notes;
    const cachedRead = (path: string) => {
      let read = notes.get(path);
      if (read === undefined) {
        read = readDocument(path);
        notes.set(path, read);
      }
      return read;
    };

    let stopped = false;
    void (async () => {
      await renderTransclusions(element, () => stopped, {
        fromPath,
        workspaceId,
        fileTypes,
        findByName,
        readDocument: cachedRead,
        readImage,
      });
      if (stopped) return;
      await highlightCodeBlocks(element, fileTypes, () => stopped);
      await renderRichBlocks(element, () => stopped);
    })();

    return () => {
      stopped = true;
    };
  }, [container, content, fromPath, workspaceId, fileTypes, findByName, readDocument, readImage]);
}
