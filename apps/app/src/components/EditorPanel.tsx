import { useState } from "react";
import MarkdownEditor from "./MarkdownEditor";
import MarkdownPreview from "./MarkdownPreview";
import {
  DEFAULT_MODE,
  EDITOR_MODES,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
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
  const [mode, setMode] = useState<EditorMode>(DEFAULT_MODE);

  return (
    <main aria-label="Editor" className="flex min-w-0 grow flex-col bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1.5">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {fileName ?? "Editor"}
        </h2>

        <div role="group" aria-label="View mode" className="flex gap-0.5 rounded bg-neutral-100 p-0.5">
          {EDITOR_MODES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              title={MODE_DESCRIPTIONS[candidate]}
              onClick={() => setMode(candidate)}
              className={
                mode === candidate
                  ? "rounded bg-white px-2 py-0.5 text-xs font-medium text-neutral-900 shadow-sm"
                  : "rounded px-2 py-0.5 text-xs text-neutral-500 hover:text-neutral-900"
              }
            >
              {MODE_LABELS[candidate]}
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
            ariaLabel="Markdown source"
          />
        ) : (
          <MarkdownPreview source={value} />
        )}
      </div>
    </main>
  );
}
