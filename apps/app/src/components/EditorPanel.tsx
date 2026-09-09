import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import ImageViewer from "./ImageViewer";
import OpenFilesMenu from "./OpenFilesMenu";
import { formatCaret } from "../lib/caret";
import { DEFAULT_EDITOR_MODE, isEditable, type EditorMode } from "../lib/editorMode";
import { DEFAULT_ZOOM, nextZoom, zoomKeyCommand, type ZoomDirection } from "../lib/zoom";
import type { FindMatch } from "@trypthos/domain";
import { currentPlatform } from "../lib/windowControls";

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
  /// A data URL when the document is looked at rather than read - an image. Null otherwise, which
  /// is nearly always, and which is what makes every branch below read as "unless it is a picture".
  media?: string | null;
  /// A document that is a PAGE rather than a file - a repository's own page.
  ///
  /// A slot rather than data, so this component stays ignorant of what is in it: the alternative is
  /// drilling a GitHub bridge and a workspace client through the editor, which has no business
  /// knowing either exists. Null for every ordinary document, which is nearly all of them.
  page?: React.ReactNode;
  onChange: (value: string) => void;
  onActivateFile?: (path: string) => void;
  onCloseFile?: (path: string) => void;
  /// Closes several documents, in the order given - what the tab menu asks for.
  onCloseFiles?: (paths: readonly string[]) => void;
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
  /// What Find found in the document ON SCREEN. Empty when nothing is being shown.
  ///
  /// The panel does not search - it is handed the answer. What it decides is that there is an
  /// editing surface to show it in: a match arriving while the document is in Preview would be
  /// highlighted on a surface that is not there, and a Find that reports three matches and shows
  /// none is a Find that looks broken.
  matches?: readonly FindMatch[];
  /// Which of them the reader is on, or -1.
  activeMatch?: number;
  /// Drawn over the editing area - the find dialog, and nothing else so far.
  ///
  /// Here rather than in the window, because this is the panel it has to float over: rendered a
  /// level up it would be positioned against the whole three-panel row and would sit over the chat
  /// panel whenever one was open.
  overlay?: React.ReactNode;
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

/// Hoisted for the same reason as `NO_FILE_TYPES`: the effect below and the editor's own both key on
/// this array, and a fresh `[]` per render would make each of them run on every render.
const NO_MATCHES: readonly FindMatch[] = [];

export default function EditorPanel({
  workspaceName,
  paths,
  activePath,
  dirtyPaths = [],
  dirty,
  value,
  readOnly = false,
  media = null,
  page = null,
  onChange,
  onActivateFile,
  onCloseFile,
  onCloseFiles,
  onSelectionChange,
  onFollowLink,
  defaultMode = DEFAULT_EDITOR_MODE,
  fileTypes = NO_FILE_TYPES,
  ref,
  matches = NO_MATCHES,
  activeMatch = -1,
  overlay = null,
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
  // An image has no modes at all, so there is nothing to prefer. Every use of `mode` below is inside
  // a branch that a media document does not take, and this keeps the fallback honest rather than
  // asserting an element that is not there.
  const preferred = fileType.modes.includes(defaultMode) ? defaultMode : (fileType.modes[0] ?? "source");
  const reading = chosen[key] ?? preferred;

  /// The view actually on screen.
  ///
  /// Almost always the one the reader chose. The exception is Find: Preview has no caret and no
  /// decorations, so it cannot show a match - a search that reported three matches and highlighted
  /// none would be a Find that looks broken. While there is something to show, the document is read
  /// in the view it would have opened in, and it goes back to Preview when the find is closed.
  ///
  /// Derived rather than stored, which has one cost worth stating: pressing Preview while results
  /// are on screen does nothing, because the derivation overrides it on the next render. That is the
  /// better of the two trades - the alternative is a search whose answer is invisible - and it lasts
  /// only as long as the results do.
  const mode =
    matches.length > 0 && !isEditable(reading)
      ? (fileType.modes.find((candidate) => isEditable(candidate)) ?? reading)
      : reading;
  const setMode = (next: EditorMode) => setChosen((prev) => ({ ...prev, [key]: next }));

  /// How far into each document the reader has zoomed, keyed by path like the view mode above.
  ///
  /// Per document rather than per window, for the reason the mode map exists: one level for the
  /// whole app would resize a file you had left alone every time you leaned into the one beside it.
  /// It is deliberately NOT persisted - a zoom is how you are reading something now, not a setting.
  const [zooms, setZooms] = useState<Record<string, number>>({});
  const zoom = zooms[key] ?? DEFAULT_ZOOM;
  /// Stepped from the level as it is when the gesture lands, not from the render that wired the
  /// handler up: a wheel spin is a lot of notches in a very short time, and reading `zoom` here
  /// would apply every one of them to the same starting level.
  const stepZoom = useCallback(
    (direction: ZoomDirection) =>
      setZooms((prev) => ({ ...prev, [key]: nextZoom(prev[key] ?? DEFAULT_ZOOM, direction) })),
    [key],
  );

  /// Ctrl and plus, minus or zero - Cmd on macOS.
  ///
  /// Bound on the WINDOW rather than on a surface, unlike the wheel and the drag: a gesture is aimed
  /// by the pointer, and a shortcut is not aimed at all. It acts on the document on screen wherever
  /// the caret happens to be, which is the only reading of it that does not depend on the user
  /// knowing which panel has focus.
  ///
  /// `preventDefault` is not decoration. Ctrl+plus and Ctrl+minus resize the whole page in a browser
  /// and in any Electron build whose menu carries the zoom roles - which would scale the app around
  /// the document instead of the document.
  useEffect(() => {
    const platform = currentPlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      const command = zoomKeyCommand(event, platform);
      if (command === null) return;
      event.preventDefault();
      if (command === "reset") setZooms((prev) => ({ ...prev, [key]: DEFAULT_ZOOM }));
      else stepZoom(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, stepZoom]);

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
    <main aria-label={t("editor.title")} className="relative flex min-w-0 grow flex-col bg-app">
      {overlay}
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
          onCloseMany={(paths) => onCloseFiles?.(paths)}
        />
        <OpenFilesMenu
          workspaceName={workspaceName}
          paths={paths}
          activePath={activePath}
          dirtyPaths={dirtyPaths}
          onActivate={(path) => onActivateFile?.(path)}
        />
        {/* Nothing to switch between for an image, and a header offering three views of a
            photograph would be three buttons that do nothing. */}
        {media === null && page === null && (
          <EditorHeader dirty={dirty} mode={mode} modes={fileType.modes} onModeChange={setMode} />
        )}
      </div>

      {/* Source only. Live hides the markers a press writes, so the same button in that view would
          insert punctuation that disappears as it lands, and Preview has nothing to write into. */}
      {page === null &&
        media === null &&
        mode === "source" &&
        !readOnly &&
        fileType.id === "markdown" && (
          <EditorToolbar onFormat={(action) => editor.current?.format(action)} />
        )}

      <div className="min-h-0 grow">
        {page !== null ? (
          page
        ) : media !== null ? (
          // A picture, drawn rather than edited. It scrolls within the panel at its own size rather
          // than being scaled to fit, because a screenshot shrunk to a panel is a screenshot you
          // cannot read - and Shift and the wheel are how you get it back.
          <ImageViewer
            source={media}
            name={activePath ?? ""}
            zoom={zoom}
            onZoom={stepZoom}
          />
        ) : isEditable(mode) ? (
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
            zoom={zoom}
            onZoom={stepZoom}
            matches={matches}
            activeMatch={activeMatch}
          />
        ) : (
          <MarkdownPreview
            source={value}
            fileTypes={fileTypes}
            zoom={zoom}
            onZoom={stepZoom}
          />
        )}
      </div>

      {/* A word count and a caret position are questions about text. For a picture the status bar
          would be four fields, three of which are lies about a file with no lines in it. */}
      {media === null && page === null && (
        <EditorStatusBar
          mode={mode}
          fileTypeKey={fileType.labelKey}
          lineEnding={lineEnding}
          stats={stats}
        />
      )}
    </main>
  );
}
