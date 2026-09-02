import { useTranslation } from "react-i18next";
import {
  EDITOR_MODES,
  MODE_HINT_KEYS,
  MODE_LABEL_KEYS,
  type EditorMode,
} from "../lib/editorMode";

interface Props {
  segments: string[];
  dirty: boolean;
  /// Right-hand status: caret position and word count, already formatted.
  stats: string;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}

/// The editor's header: where you are, whether it is saved, and how you are looking at it.
export default function EditorHeader({ segments, dirty, stats, mode, onModeChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 border-b border-rule px-3 py-1.5">
      <nav
        aria-label={t("editor.breadcrumb")}
        className="flex min-w-0 items-center gap-1.5 text-xs font-semibold tracking-[0.06em] text-ink-4 uppercase"
      >
        {segments.length === 0 ? (
          <span>{t("editor.title")}</span>
        ) : (
          segments.map((segment, index) => (
            <span key={`${index}-${segment}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <span className="text-faint">/</span>}
              {/* Only the last segment truncates. Shortening a folder name to keep the file name
                  whole is the wrong trade: the file name is what identifies the document. */}
              <span className={index === segments.length - 1 ? "truncate" : "shrink-0"}>
                {segment}
              </span>
            </span>
          ))
        )}
      </nav>

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
