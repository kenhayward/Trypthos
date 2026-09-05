import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolbarAction } from "@trypthos/domain";
import { ACTION_LABEL_KEYS, TOOLBAR_GROUPS } from "../lib/toolbarActions";

interface Props {
  onFormat: (action: ToolbarAction) => void;
}

/// The formatting toolbar above the Source view.
///
/// Buttons only. What each one does to the document is a pure function in the domain, and applying
/// it is one dispatch in the editor - so this component knows the order of the buttons, their
/// glyphs and their names, and nothing at all about markdown.
///
/// It belongs to Source rather than to Live for a reason worth stating: Source is the view where
/// the markers are visible, so a button that adds one shows its work. In Live the same press would
/// insert punctuation that is immediately hidden again, which is a confusing way to learn what the
/// button did.
export default function EditorToolbar({ onFormat }: Props) {
  const { t } = useTranslation();
  const bar = useRef<HTMLDivElement | null>(null);
  /// Which button the keyboard is on. One tab stop for the whole toolbar, as the tab strip has:
  /// sixteen stops between the tabs and the document would put the editor a long way from anybody
  /// arriving by keyboard.
  const [focused, setFocused] = useState(0);

  const actions = TOOLBAR_GROUPS.flat();

  const focus = (index: number) => {
    const next = (index + actions.length) % actions.length;
    setFocused(next);
    bar.current?.querySelectorAll<HTMLElement>("button")[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      focus(index + step);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focus(event.key === "Home" ? 0 : actions.length - 1);
    }
  };

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={t("editor.toolbar.title")}
      aria-orientation="horizontal"
      className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-rule bg-app px-2 py-1"
    >
      {TOOLBAR_GROUPS.map((group, groupIndex) => (
        <div key={groupIndex} className="flex items-center gap-0.5">
          {/* A hairline between groups rather than a gap alone: the groups say which buttons act on
              the selection and which act on the line, and a gap at this size reads as nothing. */}
          {groupIndex > 0 && <span aria-hidden="true" className="mx-1 h-4 w-px bg-rule" />}

          {group.map((action) => {
            // Its place in the whole row rather than in this group: the arrow keys walk the toolbar
            // end to end, and the groups are a visual division rather than a keyboard one.
            const index = actions.indexOf(action);
            const label = t(ACTION_LABEL_KEYS[action]);

            return (
              <button
                key={action}
                type="button"
                aria-label={label}
                title={label}
                tabIndex={index === focused ? 0 : -1}
                // The press must not take the caret with it: the editor is given focus back as soon
                // as the change lands, and a mousedown that had already moved focus would leave the
                // selection the action was about behind.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onFormat(action)}
                onKeyDown={(event) => onKeyDown(event, index)}
                onFocus={() => setFocused(index)}
                className="grid size-7 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
              >
                <ActionGlyph action={action} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/// One glyph per action.
///
/// Drawn in the same weight as the view-mode icons beside them, so the row reads as one set of
/// controls. The headings are lettered rather than drawn: `H1` is what every editor calls that
/// button, and a picture of a heading is a picture of a slightly larger line.
function ActionGlyph({ action }: { action: ToolbarAction }) {
  const heading = HEADING_LEVELS[action];

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {heading !== undefined ? (
        <>
          <path d="M4 5v14M12 5v14M4 12h8" />
          <text
            x="15"
            y="19"
            fontSize="11"
            fontWeight="600"
            fill="currentColor"
            stroke="none"
          >
            {heading}
          </text>
        </>
      ) : (
        GLYPHS[action]
      )}
    </svg>
  );
}

const HEADING_LEVELS: Partial<Record<ToolbarAction, string>> = {
  heading1: "1",
  heading2: "2",
  heading3: "3",
};

const GLYPHS: Partial<Record<ToolbarAction, React.ReactNode>> = {
  bold: <path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z" />,
  italic: <path d="M19 4h-9M14 20H5M15 4L9 20" />,
  strikethrough: (
    <>
      <path d="M4 12h16" />
      <path d="M16.5 7A4 4 0 0 0 13 5h-2a3 3 0 0 0-1.5 5.6" />
      <path d="M7.5 17A4 4 0 0 0 11 19h2a3 3 0 0 0 1.5-5.6" />
    </>
  ),
  code: <path d="M9 6l-5 6 5 6M15 6l5 6-5 6" />,
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 1 0-5.66-5.66L11.9 6.44" />
      <path d="M13.5 10.5a4 4 0 0 0-5.66 0L5 13.33a4 4 0 1 0 5.66 5.66l1.43-1.43" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  quote: (
    <>
      <path d="M4 5v14" />
      <path d="M9 7h11M9 12h11M9 17h7" />
    </>
  ),
  bulletList: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  orderedList: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4 5h1v4M4 9h2" />
      <path d="M6.5 16.5a1.2 1.2 0 1 0-2.4-.3M4.1 19.5h2.4c0-1.4-2.4-1.6-2.4-3" />
    </>
  ),
  taskList: (
    <>
      <rect x="3" y="4" width="6" height="6" rx="1.5" />
      <path d="M4.8 7l1.4 1.4L8.4 6" />
      <rect x="3" y="14" width="6" height="6" rx="1.5" />
      <path d="M12 7h9M12 17h9" />
    </>
  ),
  codeBlock: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 10l-2 2 2 2M14.5 10l2 2-2 2" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3 10h18M9 10v9M15 10v9" />
    </>
  ),
  rule: <path d="M5 7h14M3 12h18M5 17h14" />,
};
