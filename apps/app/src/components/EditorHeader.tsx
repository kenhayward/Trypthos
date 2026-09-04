import { useTranslation } from "react-i18next";
import {
  EDITOR_MODES,
  MODE_HINT_KEYS,
  MODE_LABEL_KEYS,
  type EditorMode,
} from "../lib/editorMode";

interface Props {
  /// The document's own name, or null when none is open.
  name: string | null;
  /// The whole path, shown on hover. Null when no document is open.
  path: string | null;
  dirty: boolean;
  /// Right-hand status: caret position and word count, already formatted.
  stats: string;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}

/// The editor's header: where you are, whether it is saved, and how you are looking at it.
export default function EditorHeader({ name, path, dirty, stats, mode, onModeChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 border-b border-rule px-3 py-1.5">
      {/* The name alone, and it truncates. This used to draw the whole path as segments, where every
          segment but the last refused to shrink - so a long workspace or folder name overflowed its
          own span and printed over the next one, which is unreadable rather than merely long. The
          path is one hover away instead, which loses nothing and fits. */}
      <span
        title={path ?? undefined}
        className="min-w-0 truncate text-xs font-semibold tracking-[0.06em] text-ink-4 uppercase"
      >
        {name ?? t("editor.title")}
      </span>

      {dirty && (
        <span className="shrink-0 rounded-full bg-selected px-1.5 py-px text-2xs font-semibold text-selected-ink">
          {t("editor.unsavedPill")}
        </span>
      )}

      <span className="ml-auto shrink-0 text-xs text-faint tabular-nums">{stats}</span>

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
            title={t(MODE_HINT_KEYS[candidate])}
            onClick={() => onModeChange(candidate)}
            className={
              mode === candidate
                ? "rounded bg-app px-2.5 py-0.5 text-ui font-semibold text-ink shadow-tab"
                : "rounded px-2.5 py-0.5 text-ui text-ink-4 hover:text-ink"
            }
          >
            {t(MODE_LABEL_KEYS[candidate])}
          </button>
        ))}
      </div>
    </div>
  );
}
