import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { countWords, detectLineEnding } from "@trypthos/domain";
import EditorHeader from "./EditorHeader";
import EditorStatusBar from "./EditorStatusBar";
import MarkdownEditor from "./MarkdownEditor";
import MarkdownPreview from "./MarkdownPreview";
import { breadcrumbSegments, formatCaret } from "../lib/breadcrumb";
import { DEFAULT_MODE, isEditable, type EditorMode } from "../lib/editorMode";

interface Props {
  workspaceName: string | null;
  filePath: string | null;
  dirty: boolean;
  value: string;
  onChange: (value: string) => void;
}

/// Centre panel: the editor, its header and its status bar.
///
/// The document lives ABOVE this component, which is what makes the mode invariant checkable rather
/// than merely intended: switching mode is local state here and cannot reach `onChange`, so a mode
/// switch has no path by which to alter the document.
export default function EditorPanel({ workspaceName, filePath, dirty, value, onChange }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<EditorMode>(DEFAULT_MODE);
  const [caret, setCaret] = useState({ line: 1, column: 1 });

  const segments = useMemo(
    () => breadcrumbSegments(workspaceName, filePath),
    [workspaceName, filePath],
  );

  // Both walk the whole document, so they are memoised on the text rather than recomputed on every
  // keystroke-driven render. A word count is cheap on a page and not on a book.
  const words = useMemo(() => countWords(value), [value]);
  const lineEnding = useMemo(() => detectLineEnding(value), [value]);

  const stats = t("editor.stats", {
    caret: formatCaret(caret.line, caret.column),
    words: words.toLocaleString(),
  });

  return (
    <main aria-label={t("editor.title")} className="flex min-w-0 grow flex-col bg-app">
      <EditorHeader
        segments={segments}
        dirty={dirty}
        stats={stats}
        mode={mode}
        onModeChange={setMode}
      />

      <div className="min-h-0 grow">
        {isEditable(mode) ? (
          <MarkdownEditor
            value={value}
            onChange={onChange}
            live={mode === "live"}
            onCaret={(line, column) => setCaret({ line, column })}
            ariaLabel={t("editor.surface")}
          />
        ) : (
          <MarkdownPreview source={value} />
        )}
      </div>

      <EditorStatusBar mode={mode} lineEnding={lineEnding} />
    </main>
  );
}
