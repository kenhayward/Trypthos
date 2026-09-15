import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { renameTarget } from "@trypthos/domain";

interface Props {
  /// The entry's name now.
  current: string;
  /// Every name already in its folder, its own included. Empty when the folder has not been listed,
  /// which leaves the clash to the shell to find.
  siblings: readonly string[];
  onCancel: () => void;
  /// Renames, and answers null when it worked or the translation key of what went wrong. The dialog
  /// stays open on a refusal - the user is still choosing a name, and the reason belongs beside it.
  onRename: (name: string) => Promise<string | null>;
}

/// Renaming one file or folder in the workspace tree.
///
/// What is wrong with a name is said while it is typed, from the same rule the shell applies; the
/// shell's own refusal - a name taken since the folder was listed, a file another program holds - is
/// said in the same place.
export default function RenameDialog({ current, siblings, onCancel, onRename }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(current);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const target = renameTarget(name, { current, siblings });
  // Unchanged is not a problem worth a sentence: there is simply nothing to save yet.
  const problem = target.ok || target.problem === "unchanged" ? null : `rename.problems.${target.problem}`;
  const message = problem ?? refusal;

  useEffect(() => {
    const input = field.current;
    if (input === null) return;
    input.focus();
    // The name without its extension, which is the part people rename. A folder, or a name whose
    // only dot starts it, is selected whole.
    const dot = current.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : current.length);
  }, [current]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const save = async () => {
    if (!target.ok || busy) return;
    setBusy(true);
    const failed = await onRename(target.name);
    setBusy(false);
    setRefusal(failed);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("rename.title", { name: current })}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-80 max-w-full rounded-lg border border-rule bg-app p-4 shadow-menu">
        <h2 className="truncate text-sm font-semibold text-ink">{t("rename.title", { name: current })}</h2>
        <label className="mt-3 block text-xs text-ink-3" htmlFor="rename-entry-name">
          {t("rename.name")}
        </label>
        <input
          id="rename-entry-name"
          ref={field}
          value={name}
          spellCheck={false}
          onChange={(event) => {
            setName(event.target.value);
            setRefusal(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
          aria-invalid={message !== null}
          className="mt-1 w-full rounded border border-rule bg-app px-2 py-1 text-ui text-ink"
        />
        <p role={message === null ? undefined : "alert"} className="mt-2 min-h-4 text-xs text-danger">
          {message === null ? "" : t(message)}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-ui text-ink-3 hover:bg-hover hover:text-ink"
          >
            {t("rename.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!target.ok || busy}
            className="rounded bg-accent-strong px-3 py-1 text-ui text-white disabled:opacity-40"
          >
            {t("rename.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
