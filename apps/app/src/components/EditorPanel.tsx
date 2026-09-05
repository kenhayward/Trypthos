import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MARKDOWN_FILE_TYPE,
  countWords,
  detectLineEnding,
  fileTypeFor,
} from "@trypthos/domain";
import EditorHeader from "./EditorHeader";
import EditorToolbar from "./EditorToolbar";
import EditorStatusBar from "./EditorStatusBar";
import EditorTabs from "./EditorTabs";
import DocumentEditor, {
  type EditorHandle,
  type EditorSelection,
} from "./DocumentEditor";
import MarkdownPreview from "./MarkdownPreview";
import OpenFilesMenu from "./OpenFilesMenu";
import { formatCaret } from "../lib/caret";
import { DEFAULT_EDITOR_MODE, isEditable, type EditorMode } from "../lib/editorMode";

interface Props {
  workspaceName: string | null;
  /// Every open document, in tab order.
  paths: readonly string[];
  /// The document on screen, or null when it is the scratch buffer.
  activePath: string | null;
  /// The open documents with unsaved work, for the tabs that are not on screen.
  dirtyPaths?: readonly string[];
  /// Whether the document ON SCREEN has unsaved work. The header says so in words; the tabs mark the
  /// others with a dot.
  dirty: boolean;
  value: string;
  /// Whether the document on screen refuses edits - the built-in guide, which has no file behind it.
  ///
  /// It takes the toolbar away as well as the caret: a row of buttons that write into a document
  /// nothing can be written to is a row of buttons that do nothing.
  readOnly?: boolean;
  onChange: (value: string) => void;
  onActivateFile?: (path: string) => void;
  onCloseFile?: (path: string) => void;
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
  /// The file types the user has turned on, by id. What the document on screen IS decides which
  /// views the header offers and how the editing surface behaves.
  fileTypes?: readonly string[];
  /// Handle for applying a chat edit the user accepted.
  ref?: React.Ref<EditorHandle>;
}

/// Centre panel: the open files, the editor, and its status bar.
///
/// The documents live ABOVE this component, which is what makes the mode invariant checkable rather
/// than merely intended: switching mode is local state here and cannot reach `onChange`, so a mode
/// switch has no path by which to alter any document.
/// Hoisted, not written inline as a default.
///
/// The editor now keys an effect on this list, so a fresh `[]` on every render would discard and
/// reload the document's language on every render - a visible flicker of uncoloured text, from
/// nothing more than an array literal in a parameter list.
const NO_FILE_TYPES: readonly string[] = [];

export default function EditorPanel({
  workspaceName,
  paths,
  activePath,
  dirtyPaths = [],
  dirty,
  value,
  readOnly = false,
  onChange,
  onActivateFile,
  onCloseFile,
  onSelectionChange,
  onFollowLink,
  defaultMode = DEFAULT_EDITOR_MODE,
  fileTypes = NO_FILE_TYPES,
  ref,
}: Props) {
  const { t } = useTranslation();
  /// The view each document is being read in, keyed by path.
  ///
  /// A map rather than one choice, now that several documents are open at once: a per-document
  /// choice that only remembered the last one would quietly reset a file every time you looked at
  /// another and came back.
  ///
  /// Absent means "the configured default", rather than a copy of it - settings are read from disk
  /// AFTER this mounts, so a copy taken at mount would be whatever the default was before the file
  /// had been read, and the stored preference would never arrive.
  const [chosen, setChosen] = useState<Record<string, EditorMode>>({});
  const key = activePath ?? "";

  /// What the document on screen IS.
  ///
  /// Markdown is the answer in three cases that all look different and behave the same: the scratch
  /// buffer, the built-in guide, and a file whose type is turned off but which is still open in a
  /// tab from before the setting changed. The last of those is the reason this falls back rather
  /// than refusing - taking a document's panel away because of a settings toggle is hostile.
  const fileType = useMemo(() => {
    if (activePath === null) return MARKDOWN_FILE_TYPE;
    const cut = activePath.lastIndexOf("/");
    const name = cut === -1 ? activePath : activePath.slice(cut + 1);
    return fileTypeFor(name, fileTypes) ?? MARKDOWN_FILE_TYPE;
  }, [activePath, fileTypes]);

  // The configured default applies only where the type has it. Live is the default and a JSON file
  // has no Live, so honouring it blindly would open the centre panel on a view that cannot be drawn.
  const preferred = fileType.modes.includes(defaultMode) ? defaultMode : fileType.modes[0]!;
  const mode = chosen[key] ?? preferred;
  const setMode = (next: EditorMode) => setChosen((prev) => ({ ...prev, [key]: next }));
  const [caret, setCaret] = useState({ line: 1, column: 1 });

  /// The live editor, so the toolbar can act on the document and the selection as they are now.
  ///
  /// Held here as well as handed upwards because two callers need it and they need different things
  /// from it: the window applies a chat edit through the same handle. Attached with a callback so
  /// the one editor answers both, rather than one of them silently getting null.
  const editor = useRef<EditorHandle | null>(null);
  const attach = useCallback(
    (handle: EditorHandle | null) => {
      editor.current = handle;
      if (typeof ref === "function") ref(handle);
      else if (ref) ref.current = handle;
    },
    [ref],
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
      {/* One row: identity on the left, state on the right. The strip takes whatever width the
          header does not need, and scrolls within it - so the list of open files is pinned between
          the two rather than inside the strip, where it would scroll away with the tabs. */}
      <div className="flex items-stretch border-b border-rule">
        <EditorTabs
          workspaceName={workspaceName}
          paths={paths}
          activePath={activePath}
          dirtyPaths={dirtyPaths}
          onActivate={(path) => onActivateFile?.(path)}
          onClose={(path) => onCloseFile?.(path)}
        />
        <OpenFilesMenu
          workspaceName={workspaceName}
          paths={paths}
          activePath={activePath}
          dirtyPaths={dirtyPaths}
          onActivate={(path) => onActivateFile?.(path)}
        />
        <EditorHeader dirty={dirty} mode={mode} modes={fileType.modes} onModeChange={setMode} />
      </div>

      {/* Source only. Live hides the markers a press writes, so the same button in that view would
          insert punctuation that disappears as it lands, and Preview has nothing to write into. */}
      {mode === "source" && !readOnly && fileType.id === "markdown" && (
        <EditorToolbar onFormat={(action) => editor.current?.format(action)} />
      )}

      <div className="min-h-0 grow">
        {isEditable(mode) ? (
          <DocumentEditor
            documentId={activePath}
            value={value}
            onChange={onChange}
            live={mode === "live"}
            fileType={fileType}
            fileTypes={fileTypes}
            onCaret={(line, column) => setCaret({ line, column })}
            onSelectionChange={onSelectionChange}
            onFollowLink={onFollowLink}
            readOnly={readOnly}
            ref={attach}
            ariaLabel={t("editor.surface")}
          />
        ) : (
          <MarkdownPreview source={value} fileTypes={fileTypes} />
        )}
      </div>

      <EditorStatusBar
        mode={mode}
        fileTypeKey={fileType.labelKey}
        lineEnding={lineEnding}
        stats={stats}
      />
    </main>
  );
}
