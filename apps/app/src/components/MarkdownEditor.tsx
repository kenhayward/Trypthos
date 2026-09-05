import { useEffect, useImperativeHandle, useRef } from "react";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { toolbarEdit, type ToolbarAction } from "@trypthos/domain";
import { editorTheme } from "../lib/editorTheme";
import { followLinks, liveMode } from "../lib/liveExtension";
import { currentPlatform } from "../lib/windowControls";

/// Marks a transaction as replacing the document from outside rather than editing it.
///
/// CodeMirror cannot tell the two apart on its own - a programmatic dispatch and a keystroke both
/// arrive as a document change. Unmarked, opening a file reported an edit the instant it loaded, so
/// every file arrived already marked Unsaved.
const External = Annotation.define<boolean>();

/// The document position showing at the top of the visible area.
///
/// What a reader means by "where I was": the first line they can see, which is not necessarily where
/// their caret is. Asked in screen coordinates rather than computed from `scrollTop`, because the
/// scroller's offset is only meaningful against heights CodeMirror has measured, and it measures the
/// parts of a document it has drawn.
function topPosition(editor: EditorView): number {
  const box = editor.scrollDOM.getBoundingClientRect();
  return editor.posAtCoords({ x: box.left + 1, y: box.top + 1 }, false);
}

export interface EditorSelection {
  text: string;
  from: number;
  to: number;
}

export interface EditorHandle {
  /// Applies a formatting action to the current selection.
  ///
  /// The editor is the only place that knows the document and the selection as they are RIGHT NOW,
  /// which is why the toolbar names an action rather than computing an edit: a toolbar working from
  /// props would be working from the last render, and a render can be a keystroke old.
  format(action: ToolbarAction): void;
  /// Replaces `from`..`to` with `insert`, as ONE transaction.
  ///
  /// One transaction so it is one undo step: a user who dislikes what the model wrote presses Ctrl+Z
  /// once and has their document back. Dispatched into the live editor rather than routed through
  /// the `value` prop, which would replace the whole document and move the caret.
  applyChange(from: number, to: number, insert: string): void;
}

interface Props {
  /// Identifies the open document. A change means a DIFFERENT file, not new text for the same one.
  ///
  /// Needed because one editor serves every document: without it, opening a file inherits the caret
  /// and scroll position of the last one, so a new document opens halfway down.
  documentId: string | null;
  value: string;
  onChange: (value: string) => void;
  /// Whether markdown syntax is hidden away from the caret line.
  live: boolean;
  /// Whether the document refuses edits - the built-in guide, which has no file to be saved to.
  ///
  /// Both halves of CodeMirror's answer are needed: `EditorState.readOnly` refuses changes, and
  /// `EditorView.editable` takes the surface out of the tab order and hides the caret. With only
  /// the first, the editor still looks and behaves like something you can type into, and silently
  /// swallows every keystroke.
  readOnly?: boolean;
  /// Reports the caret, one-based on both axes, whenever it moves.
  onCaret?: (line: number, column: number) => void;
  /// Reports the selection whenever it changes, with `text` empty when nothing is selected.
  ///
  /// The empty case is reported too, deliberately: it is what tells the chat panel to fall back to
  /// the whole file rather than sending the last selection for ever. The offsets come with it
  /// because an edit that replaces the selection needs a range, not a copy of the text.
  onSelectionChange?: (selection: EditorSelection) => void;
  /// The user asked to follow a link, by holding the platform's modifier and clicking it.
  ///
  /// Reports the target as the document spells it - a web address, or a path relative to this file.
  /// What that means is decided above, where the workspace and the open document are: the editor
  /// knows what was clicked and nothing about where it leads.
  onFollowLink?: (href: string) => void;
  /// Handle for applying a change from outside - a chat edit the user accepted.
  ref?: React.Ref<EditorHandle>;
  /// Labels the editing surface for assistive technology and for tests.
  ariaLabel: string;
}

/// The CodeMirror 6 editing surface.
///
/// The single editing surface for the whole app. Live and Preview are views over this same document,
/// not separate editors - which is why there is no second engine here and no markdown serialiser.
///
/// The React integration has one rule worth stating, because getting it wrong is subtle: the view is
/// created ONCE and then fed transactions. Recreating it on every render would work visually while
/// discarding the undo history, the selection and the scroll position on each keystroke.
export default function MarkdownEditor({
  documentId,
  value,
  onChange,
  live,
  readOnly = false,
  onCaret,
  onSelectionChange,
  onFollowLink,
  ref,
  ariaLabel,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  /// Switching Live on and off reconfigures this compartment rather than rebuilding the editor, so
  /// the mode switch keeps undo history, selection and scroll position. Rebuilding would look
  /// identical and quietly discard all three.
  const liveCompartment = useRef(new Compartment());
  /// Read-only is a compartment for the same reason Live is: one editor serves every document, and
  /// switching to the guide and back must not rebuild the view and lose the undo history of the
  /// file beside it.
  const readOnlyCompartment = useRef(new Compartment());
  /// Read in the create-once effect below, where `live` itself must not be a dependency.
  const initialLive = useRef(live);
  const initialReadOnly = useRef(readOnly);
  /// Read through a ref so the update listener never closes over a stale prop, which would let an
  /// edit be reported against an out-of-date handler.
  ///
  /// Assigned in an effect, not during render: a render can be thrown away or run twice, so writing
  /// a ref there is a real hazard rather than a lint technicality. Effects run before any keystroke
  /// the listener could report, so the handler is never stale by the time it matters.
  const latestOnChange = useRef(onChange);
  const latestOnCaret = useRef(onCaret);
  const latestOnSelection = useRef(onSelectionChange);
  const latestOnFollowLink = useRef(onFollowLink);
  /// The document the editor is currently showing, so a change of file can be told from a change of
  /// text. Written after the transaction that switches it, never during render.
  const shownDocument = useRef(documentId);
  /// Where each document was left: the caret, and how far down it was scrolled.
  ///
  /// One editor serves every open document, so without this, coming back to a tab you were halfway
  /// through starts you at the top of it again - which is the difference between a tab and simply
  /// reopening the file.
  const places = useRef(new Map<string, { anchor: number; head: number; topLine: number }>());
  useEffect(() => {
    latestOnChange.current = onChange;
    latestOnCaret.current = onCaret;
    latestOnSelection.current = onSelectionChange;
    latestOnFollowLink.current = onFollowLink;
  }, [onChange, onCaret, onSelectionChange, onFollowLink]);

  useImperativeHandle(
    ref,
    () => ({
      format(action) {
        const editor = view.current;
        if (editor === null) return;

        const range = editor.state.selection.main;
        const edit = toolbarEdit(action, editor.state.doc.toString(), {
          from: range.from,
          to: range.to,
        });

        // One transaction, so one press is one undo step - and the selection travels with the
        // change rather than being restored afterwards, which would be a second step and a visible
        // flicker through whatever the mapped selection happened to be.
        editor.dispatch({
          changes: { from: edit.from, to: edit.to, insert: edit.insert },
          selection: { anchor: edit.selection.from, head: edit.selection.to },
          scrollIntoView: true,
        });
        // Back to the document. The button prevented the mousedown from taking focus, so this is
        // what puts the caret back in front of the user after a press from the keyboard as well.
        editor.focus();
      },
      applyChange(from, to, insert) {
        const editor = view.current;
        if (editor === null) return;

        // Clamped, because the caller resolved these offsets against a document that may have been
        // edited a keystroke ago. An out-of-range change throws inside CodeMirror and takes the
        // panel down with it.
        const length = editor.state.doc.length;
        const start = Math.max(0, Math.min(from, length));
        const end = Math.max(start, Math.min(to, length));

        // No `External` annotation: this IS a document change the user asked for, so it must reach
        // `onChange` and mark the file dirty. The annotation exists to mark changes that came from
        // outside the user's intent, like a file being loaded.
        editor.dispatch({
          changes: { from: start, to: end, insert },
          // The caret follows the inserted text, so the user can see what landed.
          selection: { anchor: start + insert.length },
          scrollIntoView: true,
        });
        editor.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    if (!host.current) return;

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          editorTheme,
          liveCompartment.current.of(initialLive.current ? liveMode : []),
          readOnlyCompartment.current.of(
            initialReadOnly.current
              ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
              : [],
          ),
          // Outside the compartment on purpose. Only Live mode writes a target onto a link, so in
          // the other modes this handler finds nothing and returns - which is one extension created
          // once, rather than one more thing reconfigured on every mode switch.
          followLinks({
            platform: currentPlatform(),
            onFollow: (href) => latestOnFollowLink.current?.(href),
          }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            const external = update.transactions.some((tr) => tr.annotation(External) === true);
            if (update.docChanged && !external) {
              latestOnChange.current(update.state.doc.toString());
            }
            // Selection changes without the document changing - arrow keys, a click - so this is a
            // separate condition, not an else.
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              // CodeMirror counts columns from zero; every editor a person has used counts from one.
              latestOnCaret.current?.(line.number, head - line.from + 1);

              const range = update.state.selection.main;
              // Only sliced when there is something to slice: an empty range is by far the common
              // case, and select-all on a large document would otherwise copy the whole buffer on
              // every arrow key.
              latestOnSelection.current?.({
                text: range.empty ? "" : update.state.sliceDoc(range.from, range.to),
                from: range.from,
                to: range.to,
              });
            }
          }),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            // CodeMirror sets spellcheck="false" on its content element by default. Left alone, the
            // editor - the app's main text surface - would be the one place with no spelling
            // corrections, while the chat box and the settings fields had them.
            spellcheck: "true",
          }),
        ],
      }),
    });

    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Created once on mount. `value` is deliberately not a dependency - later changes arrive as
    // transactions in the effect below, not by rebuilding the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;

    editor.dispatch({
      effects: liveCompartment.current.reconfigure(live ? liveMode : []),
    });
  }, [live]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;

    editor.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
    });
  }, [readOnly]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;

    const current = editor.state.doc.toString();
    const switchedFile = shownDocument.current !== documentId;
    if (current === value && !switchedFile) return;

    // Remember where the document being left was up to, before its text is replaced. Read from the
    // live editor rather than tracked as it moves: the caret and the scroll position change on every
    // keystroke, and only their final values matter.
    const leaving = shownDocument.current;
    if (switchedFile && leaving !== null) {
      const range = editor.state.selection.main;
      places.current.set(leaving, {
        anchor: range.anchor,
        head: range.head,
        // The text at the top of the view, not the pixel offset. A pixel offset means nothing until
        // CodeMirror has measured the new document, and it measures lazily - restoring one lands
        // wherever the estimated height happened to put it. Read from screen coordinates, which is
        // the one frame of reference that is true at the moment it is asked.
        topLine: topPosition(editor),
      });
    }

    // Only reached when the document changed from outside the editor - opening a different file, or a
    // reload from disk. Echoing the user's own keystrokes back through here would fight the caret.
    //
    // A DIFFERENT file goes back to where it was last left, or to the top the first time it is
    // opened. A reload of the SAME file does not move the caret - that would throw away the reader's
    // place for a change they did not make.
    const place = documentId === null ? undefined : places.current.get(documentId);
    // Clamped, because the document can have been edited elsewhere - a chat edit, or a reload from
    // disk - since the position was recorded, and an out-of-range selection throws inside CodeMirror.
    const clamp = (offset: number) => Math.max(0, Math.min(offset, value.length));

    editor.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      ...(switchedFile
        ? {
            selection: place
              ? { anchor: clamp(place.anchor), head: clamp(place.head) }
              : { anchor: 0 },
            // Only for a document with no remembered place. The remembered case scrolls to the line
            // the reader was on instead, which is not always the line the caret is on - a reader can
            // scroll away from their caret, and the place they were looking at is the one to come
            // back to.
            scrollIntoView: place === undefined,
          }
        : {}),
      annotations: External.of(true),
    });

    // A SECOND transaction, deliberately. A `scrollIntoView` effect is mapped through its own
    // transaction's changes, and the one above replaces the whole document - so a position in the
    // document being restored would map to the start of the replacement and scroll to the top, which
    // is exactly what this exists to avoid.
    if (switchedFile && place !== undefined) {
      editor.dispatch({
        effects: EditorView.scrollIntoView(clamp(place.topLine), { y: "start" }),
        annotations: External.of(true),
      });
    }

    shownDocument.current = documentId;
  }, [value, documentId]);

  return <div ref={host} className="h-full overflow-auto" data-testid="markdown-editor" />;
}
