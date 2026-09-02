import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  source: string;
}

/// Preview mode: read-only rendered prose.
///
/// Not an editor with editing switched off - no caret, no gutter, no line numbers. It stopped being
/// an editing surface, which is the point of the mode.
///
/// The HTML is sanitised in `renderMarkdown` before it arrives here. That is the only reason
/// dangerouslySetInnerHTML is acceptable at this boundary: a markdown file is untrusted input, and
/// this component renders inside the app's own origin.
export default function MarkdownPreview({ source }: Props) {
  const { t } = useTranslation();
  const html = useMemo(() => renderMarkdown(source), [source]);

  if (html === "") {
    return (
      <div className="p-4 text-sm text-ink-4">{t("editor.nothingToPreview")}</div>
    );
  }

  return (
    <div
      aria-label={t("editor.preview")}
      className="markdown-preview h-full overflow-auto p-4"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
