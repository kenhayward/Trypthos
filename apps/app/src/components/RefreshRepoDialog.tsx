import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  /// The repository being refreshed, as the workspace panel names it.
  name: string;
  /// True when a document from this repository has unsaved work. Said only when it is true.
  unsaved: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/// Asked before a repository is moved to the newest commit on its branch.
///
/// **A folder is not asked about, and a repository is.** Refreshing a folder on disk shows what is
/// already there. Refreshing a repository changes what the workspace IS - a different commit, and
/// with it different files - while the tabs already open were read from the old one. What that means
/// for those tabs is the thing worth a sentence before it happens rather than a surprise after.
export default function RefreshRepoDialog({ name, unsaved, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // On the button that does it, so Enter answers the question the dialog asks. Nothing here is lost
  // by refreshing - open tabs keep their text - so the quick answer is a safe one.
  useEffect(() => {
    confirm.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("refreshRepo.title", { name })}
      // Flex, never `grid place-items-center` - see `OpenRepoDialog` for the whole of why.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-full w-[26rem] flex-col overflow-auto rounded-lg border border-rule bg-app p-4 shadow-popup">
        <h2 className="text-base font-semibold text-ink">{t("refreshRepo.title", { name })}</h2>
        <p className="mt-2 text-sm text-ink-2">{t("refreshRepo.blurb")}</p>

        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>{t("refreshRepo.files")}</li>
          <li>{t("refreshRepo.tabs")}</li>
        </ul>

        {unsaved && (
          <p role="note" className="mt-3 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
            {t("refreshRepo.unsaved")}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-rule px-3 py-1 text-sm text-ink-2 hover:bg-hover"
          >
            {t("refreshRepo.cancel")}
          </button>
          <button
            ref={confirm}
            type="button"
            onClick={onConfirm}
            className="rounded bg-accent px-3 py-1 text-sm font-medium text-white"
          >
            {t("refreshRepo.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
