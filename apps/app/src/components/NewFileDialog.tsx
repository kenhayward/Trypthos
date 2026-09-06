import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { newFileName, newFileTypes } from "@trypthos/domain";

interface Props {
  /// The file types the user has turned on, by id. The dropdown offers these and nothing else, so a
  /// new file cannot be one the folder browser would then refuse to show.
  fileTypes: readonly string[];
  onCancel: () => void;
  /// The file name, extension and all. Where it goes is not decided here.
  onCreate: (name: string) => void;
}

/// Naming a file that does not exist yet.
///
/// Drawn here rather than popped natively, because a native dialog cannot offer a dropdown of file
/// types - and the list is the useful half: it is how somebody makes a `.py` without knowing that
/// Trypthos calls that Python.
///
/// **It does not ask where the file goes.** That is the save dialog's question, asked the first time
/// the document is saved. Two dialogs asking it would be two answers that can disagree, and the one
/// that decided first would be the one with the least information.
export default function NewFileDialog({ fileTypes, onCancel, onCreate }: Props) {
  const { t } = useTranslation();
  const types = newFileTypes(fileTypes);
  const [name, setName] = useState("");
  const [extension, setExtension] = useState(types[0]?.extension ?? "md");
  const field = useRef<HTMLInputElement>(null);

  // Focused on open, because the only thing to do here is type a name.
  useEffect(() => field.current?.focus(), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  /// What the two answers make, or null when they make nothing usable. Null is also what disables
  /// the button, so "would make no file" and "cannot be pressed" are the same question asked once.
  const resolved = newFileName(name, extension);

  const create = () => {
    if (resolved !== null) onCreate(resolved);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("newFile.title")}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      // A click on the backdrop is a way out, like Escape. Checked against the target rather than
      // the currentTarget, so a click inside the panel does not close it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-80 rounded-lg border border-rule bg-app p-4 shadow-menu">
        <h2 className="text-sm font-semibold text-ink">{t("newFile.title")}</h2>

        <label className="mt-3 block text-xs text-ink-3" htmlFor="new-file-name">
          {t("newFile.name")}
        </label>
        <input
          id="new-file-name"
          ref={field}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") create();
          }}
          className="mt-1 w-full rounded border border-rule bg-app px-2 py-1 text-ui text-ink"
        />

        <label className="mt-3 block text-xs text-ink-3" htmlFor="new-file-type">
          {t("newFile.type")}
        </label>
        <select
          id="new-file-type"
          value={extension}
          onChange={(event) => setExtension(event.target.value)}
          className="mt-1 w-full rounded border border-rule bg-app px-2 py-1 text-ui text-ink"
        >
          {types.map((type) => (
            <option key={type.id} value={type.extension}>
              {t(type.labelKey)} (.{type.extension})
            </option>
          ))}
        </select>

        {/* What the file will be called, before it is made. The name and the type are two answers
            and this is the one thing that matters - particularly when the name already carries an
            extension, where the dropdown is deliberately not the one that wins. */}
        <p className="mt-3 min-h-4 truncate text-xs text-ink-4">
          {resolved === null ? t("newFile.needsName") : resolved}
        </p>

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-ui text-ink-3 hover:bg-hover hover:text-ink"
          >
            {t("newFile.cancel")}
          </button>
          <button
            type="button"
            onClick={create}
            disabled={resolved === null}
            className="rounded bg-accent-strong px-3 py-1 text-ui text-white disabled:opacity-40"
          >
            {t("newFile.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
