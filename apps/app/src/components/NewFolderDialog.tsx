import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { newFolderName } from "@trypthos/domain";

interface Props {
  onCancel: () => void;
  onCreate: (name: string) => void;
}

/// Naming a directory within the folder the context menu named.
export default function NewFolderDialog({ onCancel, onCreate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const resolved = newFolderName(name);

  useEffect(() => field.current?.focus(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const create = () => {
    if (resolved !== null) onCreate(resolved);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("newFolder.title")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-80 rounded-lg border border-rule bg-app p-4 shadow-menu">
        <h2 className="text-sm font-semibold text-ink">{t("newFolder.title")}</h2>
        <label className="mt-3 block text-xs text-ink-3" htmlFor="new-folder-name">
          {t("newFolder.name")}
        </label>
        <input
          id="new-folder-name"
          ref={field}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") create();
          }}
          className="mt-1 w-full rounded border border-rule bg-app px-2 py-1 text-ui text-ink"
        />
        <p className="mt-3 min-h-4 truncate text-xs text-ink-4">
          {resolved === null ? t("newFolder.needsName") : resolved}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-ui text-ink-3 hover:bg-hover hover:text-ink"
          >
            {t("newFolder.cancel")}
          </button>
          <button
            type="button"
            onClick={create}
            disabled={resolved === null}
            className="rounded bg-accent-strong px-3 py-1 text-ui text-white disabled:opacity-40"
          >
            {t("newFolder.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
