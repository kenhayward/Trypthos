import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CHAT_TITLE_LIMIT } from "@trypthos/domain";

interface Props {
  /// The name to start from: the open chat's own, or the question that started the conversation.
  suggested: string;
  /// How many files are attached, whose text is saved with the conversation.
  attachments: number;
  /// The attached folder's path, or null. Saved as a path only.
  folder: string | null;
  onCancel: () => void;
  /// Saves under this name, and answers whether it worked. The dialog stays open on a failure, so the
  /// name typed is not lost with it.
  onSave: (title: string) => Promise<boolean>;
}

/// Naming a conversation as it is saved.
///
/// It says what goes with the conversation, because the two kinds of attachment are kept very
/// differently: a file's whole text is copied into the saved chat, and a folder is only its path.
export default function SaveChatDialog({ suggested, attachments, folder, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(suggested);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const usable = title.trim() !== "";

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const save = async () => {
    if (!usable || busy) return;
    setBusy(true);
    const saved = await onSave(title.trim());
    setBusy(false);
    setFailed(!saved);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("chat.history.saveTitle")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-96 max-w-full rounded-lg border border-rule bg-app p-4 shadow-menu">
        <h2 className="text-sm font-semibold text-ink">{t("chat.history.saveTitle")}</h2>
        <label className="mt-3 block text-xs text-ink-3" htmlFor="save-chat-name">
          {t("chat.history.name")}
        </label>
        <input
          id="save-chat-name"
          ref={field}
          value={title}
          maxLength={CHAT_TITLE_LIMIT}
          onChange={(event) => {
            setTitle(event.target.value);
            setFailed(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
          className="mt-1 w-full rounded border border-rule bg-app px-2 py-1 text-ui text-ink"
        />
        {attachments > 0 && (
          <p className="mt-2 text-xs text-ink-4">
            {attachments === 1
              ? t("chat.history.savesAttachment")
              : t("chat.history.savesAttachments", { count: attachments })}
          </p>
        )}
        {folder !== null && (
          <p className="mt-1 text-xs break-all text-ink-4">{t("chat.history.savesFolder", { folder })}</p>
        )}
        <p role={failed ? "alert" : undefined} className="mt-2 min-h-4 text-xs text-danger">
          {failed ? t("chat.history.saveFailed") : ""}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-ui text-ink-3 hover:bg-hover hover:text-ink"
          >
            {t("chat.history.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!usable || busy}
            className="rounded bg-accent-strong px-3 py-1 text-ui text-white disabled:opacity-40"
          >
            {t("chat.history.confirmSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
