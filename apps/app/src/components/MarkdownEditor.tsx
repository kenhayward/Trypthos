import { useEffect, useRef } from "react";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { editorTheme } from "../lib/editorTheme";
import { liveMode } from "../lib/liveExtension";

/// Marks a transaction as replacing the document from outside rather than editing it.
///
/// CodeMirror cannot tell the two apart on its own - a programmatic dispatch and a keystroke both
/// arrive as a document change. Unmarked, opening a file reported an edit the instant it loaded, so
/// every file arrived already marked Unsaved.
const External = Annotation.define<boolean>();

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
  /// Reports the caret, one-based on both axes, whenever it moves.
  onCaret?: (line: number, column: number) => void;
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
  onCaret,
  ariaLabel,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  /// Switching Live on and off reconfigures this compartment rather than rebuilding the editor, so
  /// the mode switch keeps undo history, selection and scroll position. Rebuilding would look
  /// identical and quietly discard all three.
  const liveCompartment = useRef(new Compartment());
  /// Read in the create-once effect below, where `live` itself must not be a dependency.
  const initialLive = useRef(live);
  /// Read through a ref so the update listener never closes over a stale prop, which would let an
  /// edit be reported against an out-of-date handler.
  ///
  /// Assigned in an effect, not during render: a render can be thrown away or run twice, so writing
  /// a ref there is a real hazard rather than a lint technicality. Effects run before any keystroke
  /// the listener could report, so the handler is never stale by the time it matters.
  const latestOnChange = useRef(onChange);
  const latestOnCaret = useRef(onCaret);
  /// The document the editor is currently showing, so a change of file can be told from a change of
  /// text. Written after the transaction that switches it, never during render.
  const shownDocument = useRef(documentId);
  useEffect(() => {
    latestOnChange.current = onChange;
    latestOnCaret.current = onCaret;
  }, [onChange, onCaret]);

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
            }
          }),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
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

    const current = editor.state.doc.toString();
    const switchedFile = shownDocument.current !== documentId;
    if (current === value && !switchedFile) return;

    // Only reached when the document changed from outside the editor - opening a different file, or a
    // reload from disk. Echoing the user's own keystrokes back through here would fight the caret.
    //
    // A DIFFERENT file starts at the top: one editor serves every document, so without this the new
    // one inherits wherever the last was left. A reload of the SAME file does not move the caret -
    // that would throw away the reader's place for a change they did not make.
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      ...(switchedFile ? { selection: { anchor: 0 }, scrollIntoView: true } : {}),
      annotations: External.of(true),
    });

    shownDocument.current = documentId;
  }, [value, documentId]);

  return <div ref={host} className="h-full overflow-auto" data-testid="markdown-editor" />;
}
