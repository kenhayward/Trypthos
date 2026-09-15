import { useEffect, useRef, useState } from "react";
import { readMarkdownImage } from "../lib/markdownImages";
import type { ImageResult } from "../lib/workspaceClient";

/// Pictures in rendered markdown, read through the provider.
///
/// **Why anything is needed at all.** An image's source is a path in the WORKSPACE, and the page it
/// is drawn on is served from the app's own origin - so `<img src="docs/orb.png">` asks the app for
/// a file that is not there, and every picture in every rendered document is a broken icon.
///
/// **Read through `readImage`, not from a URL.** That call already applies the workspace boundary
/// guard, refuses anything that is not a picture by name, and caps the size. Going through it rather
/// than a remote address is also what makes a picture in a PRIVATE repository work: a
/// `raw.githubusercontent.com` link needs a token, and this needs nothing the app has not already got.
///
/// A web address is left exactly as the author wrote it - a badge in a README is the common case,
/// and fetching it is the browser's business rather than this app's.

/// Data URLs by the source that was written, for the sources this could resolve.
export type ResolvedImages = Readonly<Record<string, string>>;

const NO_EMBEDS: ReadonlySet<string> = new Set();

export function useMarkdownImages(
  /// Every image source in the rendered document, as written.
  sources: readonly string[],
  /// The document the sources are relative to, qualified. Null for one in no workspace.
  fromPath: string | null,
  /// Which workspace a source with no folder of its own belongs to, when the document cannot say.
  workspaceId: string | null,
  /// Reads one picture. A bare function rather than the whole client, because that is the entire
  /// seam - and it is what lets a surface that renders markdown with no shell behind it (the About
  /// box, a chat reply) simply not pass one.
  readImage: (path: string) => Promise<ImageResult>,
  /// Obsidian embeds among the sources, and how to find one by name when it is not where the note
  /// is. An embed names a picture rather than a path - it is usually in an attachments folder
  /// elsewhere in the vault - so one that is not beside the note is searched for, through the same
  /// guarded name filter a wiki link uses. Nothing else is searched for.
  { embeds = NO_EMBEDS, findByName }: {
    embeds?: ReadonlySet<string>;
    findByName?: (name: string, workspaceId: string) => Promise<readonly string[]>;
  } = {},
): ResolvedImages {
  const [resolved, setResolved] = useState<ResolvedImages>({});
  /// Every source already asked about, resolved or not.
  ///
  /// A README uses the same picture twice as often as not, and a document re-renders on every
  /// keystroke elsewhere in the app - so without this the same bytes are fetched again and again.
  /// A ref rather than state: it records what has been ASKED, which is not something to render.
  const asked = useRef(new Set<string>());

  useEffect(() => {
    let live = true;

    void (async () => {
      for (const source of sources) {
        if (asked.current.has(source)) continue;
        asked.current.add(source);

        const data = await readMarkdownImage(source, fromPath, workspaceId, readImage, {
          embed: embeds.has(source),
          findByName,
        });
        if (!live) return;
        // A picture that cannot be read is left as the author wrote it. A broken image is better
        // than a wrong one, and there is nothing useful to put in its place.
        if (data === null) continue;

        setResolved((prev) => ({ ...prev, [source]: data }));
      }
    })();

    return () => {
      live = false;
    };
  }, [sources, fromPath, workspaceId, readImage, embeds, findByName]);

  return resolved;
}
