import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatSessionSummary } from "@trypthos/domain";

interface Props {
  chats: readonly ChatSessionSummary[];
  /// The chat currently on screen, if it came from here.
  openId: string | null;
  disabled: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

/// The list of saved conversations.
///
/// A plain popover rather than the portalled native-adjacent menu the model picker uses: this one
/// has rows with their own delete buttons, and a menu whose items contain buttons is not a menu.
export default function ChatHistoryMenu({ chats, openId, disabled, onOpen, onDelete }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onDocument(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        aria-label={t("chat.history.open")}
        title={t("chat.history.open")}
        className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink disabled:opacity-40"
      >
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
          <path d="M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 max-h-80 w-72 overflow-auto rounded-md border border-rule bg-app py-1 shadow-menu">
          {chats.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-4">{t("chat.history.empty")}</p>
          ) : (
            <ul>
              {chats.map((chat) => (
                <li key={chat.id} className="flex items-center gap-1 px-1">
                  <button
                    type="button"
                    onClick={() => {
                      onOpen(chat.id);
                      setOpen(false);
                    }}
                    className={
                      chat.id === openId
                        ? "min-w-0 flex-1 rounded px-2 py-1.5 text-left hover:bg-hover"
                        : "min-w-0 flex-1 rounded px-2 py-1.5 text-left hover:bg-hover"
                    }
                  >
                    <span className="block truncate text-ui text-ink">{chat.title}</span>
                    {/* The file it was held about, which may no longer exist. Named rather than
                        checked: the panel says so when the chat is actually opened, and checking
                        every entry to draw a menu would mean touching the disk once per row. */}
                    <span className="block truncate text-xs text-ink-4">
                      {chat.filePath ?? t("chat.history.noFile")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(chat.id)}
                    aria-label={t("chat.history.delete", { title: chat.title })}
                    className="rounded p-1 text-ink-4 hover:bg-hover hover:text-danger"
                  >
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
                      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
