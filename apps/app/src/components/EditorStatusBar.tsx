import { useTranslation } from "react-i18next";
import type { LineEnding } from "@trypthos/domain";
import { MODE_HINT_KEYS, type EditorMode } from "../lib/editorMode";

interface Props {
  mode: EditorMode;
  /// Translation key for the document's type, so the strip names what the file actually is rather
  /// than always saying Markdown - which it did, on every file, from the moment more than markdown
  /// could be opened.
  fileTypeKey: string;
  lineEnding: LineEnding;
  /// Where the caret is and how long the document is, already formatted.
  ///
  /// Here rather than in the header, which now shares its row with the tab strip: this is where an
  /// editor reports the caret anyway, and the tabs need the width more than the numbers do.
  stats: string;
}

/// The strip along the bottom: what this mode does, and what the file actually is.
///
/// The right-hand facts are claims about the user's document, so they are measured rather than
/// assumed - `LF` in particular is detected from the text, and says `Mixed` when a file genuinely is.
export default function EditorStatusBar({ mode, fileTypeKey, lineEnding, stats }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 border-t border-rule bg-panel px-3 py-1 text-xs text-ink-4">
      <span className="min-w-0 truncate">{t(MODE_HINT_KEYS[mode])}</span>
      <span className="ml-auto shrink-0 tabular-nums">{stats}</span>
      <span className="shrink-0">{t(fileTypeKey)}</span>
      <span className="shrink-0">{t("editor.encoding")}</span>
      <span className="shrink-0 tabular-nums">{lineEnding}</span>
    </div>
  );
}
