import { useTranslation } from "react-i18next";
import { useMemo, useRef } from "react";
import { useCodeHighlighting } from "../hooks/useCodeHighlighting";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  source: string;
  /// The file types the user has turned on, so a fenced code block is coloured here on the same
  /// terms it is in Source - and from the same table, so the two cannot disagree.
  fileTypes: readonly string[];
}

/// Preview mode: read-only rendered prose.
///
/// Not an editor with editing switched off - no caret, no gutter, no line numbers. It stopped being
/// an editing surface, which is the point of the mode.
///
/// The HTML is sanitised in `renderMarkdown` before it arrives here. That is the only reason
/// dangerouslySetInnerHTML is acceptable at this boundary: a markdown file is untrusted input, and
/// this component renders inside the app's own origin.
export default function MarkdownPreview({ source, fileTypes }: Props) {
  const { t } = useTranslation();
  const html = useMemo(() => renderMarkdown(source), [source]);
  const body = useRef<HTMLDivElement>(null);

  // Called before the early return below, because a hook cannot be conditional - and harmless when
  // there is nothing rendered, since it finds no blocks.
  //
  // The colouring lands AFTER the markup: a grammar arrives through a dynamic import, so the prose
  // is on screen first and the colours follow, exactly as they do in the editor.
  useCodeHighlighting(body, fileTypes, html);

  if (html === "") {
    return (
      <div className="p-4 text-sm text-ink-4">{t("editor.nothingToPreview")}</div>
    );
  }

  return (
    <div
      ref={body}
      aria-label={t("editor.preview")}
      className="markdown-body h-full overflow-auto p-4"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
