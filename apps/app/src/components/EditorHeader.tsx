import { useTranslation } from "react-i18next";
import {
  EDITOR_MODES,
  MODE_HINT_KEYS,
  MODE_LABEL_KEYS,
  type EditorMode,
} from "../lib/editorMode";

interface Props {
  dirty: boolean;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}

/// The right-hand end of the editor's top row: whether what is on screen is saved, and how you are
/// looking at it.
///
/// It used to name the document as well. The tabs beside it do that now, and they do it better -
/// they name every open document rather than only this one. So the split is identity on the left,
/// STATE on the right, and neither repeats the other.
export default function EditorHeader({ dirty, mode, onModeChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center gap-2 px-2 py-1.5">
      {dirty && (
        <span className="shrink-0 rounded-full bg-selected px-1.5 py-px text-2xs font-semibold text-selected-ink">
          {t("editor.unsavedPill")}
        </span>
      )}

      <div
        role="group"
        aria-label={t("editor.viewMode")}
        className="flex shrink-0 gap-0.5 rounded-md bg-sunken p-0.5"
      >
        {EDITOR_MODES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={mode === candidate}
            // The words moved to the tooltip and the accessible name when the icons arrived. They
            // are still the control's name for anybody reading it aloud - an icon button with no
            // label is a button nobody can name.
            aria-label={t(MODE_LABEL_KEYS[candidate])}
            title={`${t(MODE_LABEL_KEYS[candidate])} - ${t(MODE_HINT_KEYS[candidate])}`}
            onClick={() => onModeChange(candidate)}
            className={
              mode === candidate
                ? "grid size-6 place-items-center rounded bg-app text-ink shadow-tab"
                : "grid size-6 place-items-center rounded text-ink-4 hover:text-ink"
            }
          >
            <ModeGlyph mode={candidate} />
          </button>
        ))}
      </div>
    </div>
  );
}

/// One glyph per mode: a pencil for writing, brackets for the raw markup, an eye for reading.
///
/// Drawn rather than lettered because the strip of tabs beside this needs the width, and three words
/// took more of it than the document's own name.
function ModeGlyph({ mode }: { mode: EditorMode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {mode === "live" && (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </>
      )}
      {mode === "source" && <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />}
      {mode === "preview" && (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
