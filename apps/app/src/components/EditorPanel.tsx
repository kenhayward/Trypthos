import { useState } from "react";
import { useTranslation } from "react-i18next";
import MarkdownEditor from "./MarkdownEditor";
import MarkdownPreview from "./MarkdownPreview";
import {
  DEFAULT_MODE,
  EDITOR_MODES,
  MODE_HINT_KEYS,
  MODE_LABEL_KEYS,
  isEditable,
  type EditorMode,
} from "../lib/editorMode";

interface Props {
  fileName: string | null;
  value: string;
  onChange: (value: string) => void;
}

/// Centre panel: the editor.
///
/// The document lives ABOVE this component, which is what makes the mode invariant checkable rather
/// than merely intended: switching mode is local state here and cannot reach `onChange`, so a mode
/// switch has no path by which to alter the document.
export default function EditorPanel({ fileName, value, onChange }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<EditorMode>(DEFAULT_MODE);

  return (
    <main aria-label={t("editor.title")} className="flex min-w-0 grow flex-col bg-app">
      <div className="flex items-center justify-between border-b border-rule px-3 py-1.5">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-ink-4">
          {fileName ?? t("editor.title")}
        </h2>

        <div role="group" aria-label={t("editor.viewMode")} className="flex gap-0.5 rounded bg-hover p-0.5">
          {EDITOR_MODES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              title={t(MODE_HINT_KEYS[candidate])}
              onClick={() => setMode(candidate)}
              className={
                mode === candidate
                  ? "rounded bg-app px-2 py-0.5 text-xs font-medium text-ink shadow-sm"
                  : "rounded px-2 py-0.5 text-xs text-ink-4 hover:text-ink"
              }
            >
              {t(MODE_LABEL_KEYS[candidate])}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 grow">
        {isEditable(mode) ? (
          <MarkdownEditor
            value={value}
            onChange={onChange}
            live={mode === "live"}
            ariaLabel={t("editor.surface")}
          />
        ) : (
          <MarkdownPreview source={value} />
        )}
      </div>
    </main>
  );
}
