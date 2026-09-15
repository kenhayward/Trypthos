import { useTranslation } from "react-i18next";
import { useMemo, useRef } from "react";
import type { MarkdownFlavour } from "@trypthos/domain";
import { useCodeHighlighting } from "../hooks/useCodeHighlighting";
import { useRichBlocks } from "../hooks/useRichBlocks";
import { useTransclusions } from "../hooks/useTransclusions";
import { useZoomPan } from "../hooks/useZoomPan";
import { renderMarkdown } from "../lib/markdown";
import { embedSourcesIn, imageSourcesIn, withResolvedImages } from "../lib/markdownImages";
import { useMarkdownImages } from "../hooks/useMarkdownImages";
import type { ImageResult } from "../lib/workspaceClient";
import { DEFAULT_ZOOM, type ZoomDirection } from "../lib/zoom";

/// Stands in for a reader on a surface that has none, so the hook is called unconditionally.
///
/// It is never reached: `sources` is empty without a real reader, so there is nothing to read. A
/// stable module-level function rather than a fresh one per render, which would restart the effect.
const notRead = async (): Promise<ImageResult> => ({ ok: false, reason: "not-desktop" });

const NO_EMBEDS: ReadonlySet<string> = new Set();

interface Props {
  source: string;
  /// The file types the user has turned on, so a fenced code block is coloured here on the same
  /// terms it is in Source - and from the same table, so the two cannot disagree.
  fileTypes: readonly string[];
  /// How far in the reader has zoomed. The same level the editing surface carries, because Preview
  /// is a view of the same document rather than a different one.
  zoom?: number;
  onZoom?: (direction: ZoomDirection) => void;
  /// Reads a picture the document embeds, so it can be drawn.
  ///
  /// Needed because an image's source is a path in the WORKSPACE while this page is served from the
  /// app's own origin - so without it every `![](docs/orb.png)` is a broken icon. Optional, and
  /// absent for the surfaces that render markdown with no workspace behind them: a chat reply and
  /// the About box, where there is nothing for a relative path to be relative to.
  readImage?: (path: string) => Promise<ImageResult>;
  /// The document the sources are relative to, qualified.
  fromPath?: string | null;
  /// Which workspace a source with no folder of its own belongs to, when the document cannot say.
  workspaceId?: string | null;
  /// Which markdown the source is written in. GFM unless the caller knows better.
  flavour?: MarkdownFlavour;
  /// Finds files in a workspace by name, for an Obsidian embed that is not beside its note.
  findByName?: (name: string, workspaceId: string) => Promise<readonly string[]>;
  /// Reads a note's text, for an Obsidian embed shown in place. Absent where there is no workspace
  /// to read from, which leaves every embed as a link to its note.
  readDocument?: (path: string) => Promise<string | null>;
}

/// Preview mode: read-only rendered prose.
///
/// Not an editor with editing switched off - no caret, no gutter, no line numbers. It stopped being
/// an editing surface, which is the point of the mode.
///
/// The HTML is sanitised in `renderMarkdown` before it arrives here. That is the only reason
/// dangerouslySetInnerHTML is acceptable at this boundary: a markdown file is untrusted input, and
/// this component renders inside the app's own origin.
export default function MarkdownPreview({
  source,
  fileTypes,
  zoom = DEFAULT_ZOOM,
  onZoom,
  readImage,
  fromPath = null,
  workspaceId = null,
  flavour = "gfm",
  findByName,
  readDocument,
}: Props) {
  const { t } = useTranslation();
  const rendered = useMemo(() => renderMarkdown(source, { flavour }), [source, flavour]);

  // Nothing to look for when there is no way to read one, which is every surface with no workspace
  // behind it. Memoised so the resolving effect is not handed a fresh array on each render.
  const sources = useMemo(
    () => (readImage === undefined ? [] : imageSourcesIn(rendered)),
    [rendered, readImage],
  );
  const embeds = useMemo(() => (readImage === undefined ? NO_EMBEDS : embedSourcesIn(rendered)), [rendered, readImage]);
  const images = useMarkdownImages(sources, fromPath, workspaceId, readImage ?? notRead, {
    embeds,
    findByName,
  });
  const html = useMemo(() => withResolvedImages(rendered, images), [rendered, images]);
  /// The markup, as the object React is handed. Memoised, and not for performance: React 19 sets
  /// `innerHTML` again whenever this object is a different one, whatever it holds - and doing that
  /// wipes everything drawn into the document after rendering, coloured code, typeset math, diagrams
  /// and embedded notes alike, every time anything else re-renders the preview.
  const markup = useMemo(() => ({ __html: html }), [html]);
  /// The scrolling surface, which is also what the zoom and pan gestures are read on.
  ///
  /// Outside the branch below, deliberately: an empty document and a rendered one now share ONE
  /// mounted element, so the gesture listeners are attached once at mount. Returning early with a
  /// different element would leave a document that starts empty - a new file - unpannable for the
  /// rest of its life, because the listeners attach on mount and nothing tells them to try again.
  const surface = useRef<HTMLDivElement>(null);

  // The colouring lands AFTER the markup: a grammar arrives through a dynamic import, so the prose
  // is on screen first and the colours follow, exactly as they do in the editor.
  useCodeHighlighting(surface, fileTypes, html);
  // Math and diagrams, typeset and drawn once their libraries have loaded - and only loaded for a
  // document that has some.
  useRichBlocks(surface, html);
  useTransclusions(surface, html, { fromPath, workspaceId, fileTypes, findByName, readDocument, readImage });
  useZoomPan({ host: surface, onZoom: (direction: ZoomDirection) => onZoom?.(direction) });

  return (
    <div ref={surface} className="h-full overflow-auto">
      {html === "" ? (
        <div className="p-4 text-sm text-ink-4">{t("editor.nothingToPreview")}</div>
      ) : (
        <div
          aria-label={t("editor.preview")}
          className="markdown-body p-4"
          // `.markdown-body` sizes itself against this, and every heading, list and code span inside
          // it is sized in `em` - so one variable scales the whole rendered document in proportion.
          style={{ ["--tp-zoom" as string]: zoom }}
          dangerouslySetInnerHTML={markup}
        />
      )}
    </div>
  );
}
