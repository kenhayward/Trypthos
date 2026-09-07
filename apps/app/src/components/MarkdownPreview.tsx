import { useTranslation } from "react-i18next";
import { useMemo, useRef } from "react";
import { useCodeHighlighting } from "../hooks/useCodeHighlighting";
import { useZoomPan } from "../hooks/useZoomPan";
import { renderMarkdown } from "../lib/markdown";
import { DEFAULT_ZOOM, type ZoomDirection } from "../lib/zoom";

interface Props {
  source: string;
  /// The file types the user has turned on, so a fenced code block is coloured here on the same
  /// terms it is in Source - and from the same table, so the two cannot disagree.
  fileTypes: readonly string[];
  /// How far in the reader has zoomed. The same level the editing surface carries, because Preview
  /// is a view of the same document rather than a different one.
  zoom?: number;
  onZoom?: (direction: ZoomDirection) => void;
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
}: Props) {
  const { t } = useTranslation();
  const html = useMemo(() => renderMarkdown(source), [source]);
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
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
