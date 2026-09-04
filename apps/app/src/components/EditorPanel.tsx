import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { countWords, detectLineEnding } from "@trypthos/domain";
import EditorHeader from "./EditorHeader";
import EditorStatusBar from "./EditorStatusBar";
import MarkdownEditor, {
  type EditorHandle,
  type EditorSelection,
} from "./MarkdownEditor";
import MarkdownPreview from "./MarkdownPreview";
import { documentName, formatCaret } from "../lib/breadcrumb";
import { DEFAULT_EDITOR_MODE, isEditable, type EditorMode } from "../lib/editorMode";

interface Props {
  workspaceName: string | null;
  filePath: string | null;
  dirty: boolean;
  value: string;
  onChange: (value: string) => void;
  /// Reports the editor selection, so the chat panel can ask about a passage rather than the whole
  /// file. Empty when nothing is selected.
  ///
  /// Preview mode has no CodeMirror and so reports nothing: text selected in the rendered prose is
  /// a DOM selection, not an editor one. Chat falls back to the whole file there, which is the
  /// right answer for a mode you cannot edit in anyway.
  onSelectionChange?: (selection: EditorSelection) => void;
  /// The user held the platform's modifier and clicked a link in Live mode.
  ///
  /// Preview needs no equivalent: its links are real anchors, handled once for every rendered-markdown
  /// surface in the window. This exists because CodeMirror draws link text as a decorated span, which
  /// no anchor handler can see.
  onFollowLink?: (href: string) => void;
  /// The view a document opens in, from settings.
  ///
  /// A default, not a mode: the header still decides what THIS document shows. Optional because a
  /// caller with no settings to hand - a test, the browser preview before its first render - should
  /// get the same Live the app has always opened in.
  defaultMode?: EditorMode;
  /// Handle for applying a chat edit the user accepted.
  ref?: React.Ref<EditorHandle>;
}

/// Centre panel: the editor, its header and its status bar.
///
/// The document lives ABOVE this component, which is what makes the mode invariant checkable rather
/// than merely intended: switching mode is local state here and cannot reach `onChange`, so a mode
/// switch has no path by which to alter the document.
export default function EditorPanel({
  workspaceName,
  filePath,
  dirty,
  value,
  onChange,
  onSelectionChange,
  onFollowLink,
  defaultMode = DEFAULT_EDITOR_MODE,
  ref,
}: Props) {
  const { t } = useTranslation();
  /// The view the reader picked, and the document they picked it for.
  ///
  /// Null until they pick one, rather than a copy of the setting: settings are read from disk AFTER
  /// this mounts, so a copy taken at mount would be whatever the default was before the file had
  /// been read, and the stored preference would never arrive.
  ///
  /// The document is stored WITH the choice so that opening another one falls back to the
  /// configured view, which is what a default for documents means. Derived rather than reset in an
  /// effect: an effect would render the new document in the old view first and correct it after.
  const [chosen, setChosen] = useState<{ file: string | null; mode: EditorMode } | null>(null);
  const mode = chosen !== null && chosen.file === filePath ? chosen.mode : defaultMode;
  const setMode = (next: EditorMode) => setChosen({ file: filePath, mode: next });
  const [caret, setCaret] = useState({ line: 1, column: 1 });

  const name = useMemo(() => documentName(filePath), [filePath]);
  /// The whole path, for the header's tooltip. Qualified with the workspace, because
  /// "docs/notes.md" alone does not say which folder it is in.
  const path = useMemo(() => {
    if (filePath === null) return null;
    return workspaceName === null ? filePath : `${workspaceName}/${filePath}`;
  }, [workspaceName, filePath]);

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
        name={name}
        path={path}
        dirty={dirty}
        stats={stats}
        mode={mode}
        onModeChange={setMode}
      />

      <div className="min-h-0 grow">
        {isEditable(mode) ? (
          <MarkdownEditor
            documentId={filePath}
            value={value}
            onChange={onChange}
            live={mode === "live"}
            onCaret={(line, column) => setCaret({ line, column })}
            onSelectionChange={onSelectionChange}
            onFollowLink={onFollowLink}
            ref={ref}
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
