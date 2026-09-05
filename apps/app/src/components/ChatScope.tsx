import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextUsage } from "@trypthos/domain";
import ContextDial from "./ContextDial";

interface Props {
  /// Files attached to the conversation, workspace-relative.
  attachments: readonly string[];
  includeFolder: boolean;
  /// The folder that would be sent, workspace-relative. "" is the workspace root.
  ///
  /// Named on the button rather than left implicit: the folder is chosen somewhere else entirely -
  /// the tree on the far side of the window - so a button that only said "Folder" would be one
  /// whose meaning the user has to remember rather than read.
  folderPath: string;
  /// False in the browser preview, and with no folder open: there is nothing to include.
  canUseFolder: boolean;
  disabled: boolean;
  onToggleFolder: (include: boolean) => void;
  onDetach: (path: string) => void;
  /// The folder's markdown files, for the picker.
  files: readonly string[];
  /// Asked for when the picker opens, so the folder is only walked if somebody wants it.
  onNeedFiles: () => void;
  onAttach: (path: string) => void;
  /// How full the model's context is with everything on this bar, plus what is typed.
  usage: ContextUsage;
}

/// What chat can see, beyond the open document.
///
/// Shown above the composer rather than hidden in a menu, because it changes what an answer is based
/// on: a reply that quietly consulted five files, or quietly did not, is one the user cannot judge.
export default function ChatScope({
  attachments,
  includeFolder,
  folderPath,
  canUseFolder,
  disabled,
  onToggleFolder,
  onDetach,
  files,
  onNeedFiles,
  onAttach,
  usage,
}: Props) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState("");
  const picker = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picking) return;

    function onDocument(event: MouseEvent) {
      if (!picker.current?.contains(event.target as Node)) setPicking(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPicking(false);
    }

    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onKey);
    };
  }, [picking]);

  // Already attached files are not offered again: attaching one twice would send it twice.
  const offered = files.filter(
    (path) =>
      !attachments.includes(path) && path.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-rule px-2 py-1.5">
      <button
        type="button"
        disabled={disabled || !canUseFolder}
        aria-pressed={includeFolder}
        onClick={() => onToggleFolder(!includeFolder)}
        title={t("chat.scope.folderHint")}
        className={
          includeFolder
            ? "rounded bg-sunken px-2 py-0.5 text-xs font-semibold text-ink"
            : "rounded px-2 py-0.5 text-xs text-ink-4 hover:bg-hover hover:text-ink disabled:opacity-40"
        }
      >
        {folderPath === ""
          ? t("chat.scope.folder")
          : t("chat.scope.folderNamed", { name: folderName(folderPath) })}
      </button>

      {attachments.map((path) => (
        <span
          key={path}
          className="flex max-w-48 items-center gap-1 rounded bg-sunken px-2 py-0.5 text-xs text-ink"
        >
          <span className="truncate">{path}</span>
          <button
            type="button"
            onClick={() => onDetach(path)}
            aria-label={t("chat.scope.detach", { path })}
            className="shrink-0 text-ink-4 hover:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      ))}

      {/* `flex`, not a bare block: a block wrapping an inline-block button is a LINE BOX, and the
          line box carries the font's descender space below the button. That made this wrapper a
          couple of pixels taller than the plain button beside it, and `items-center` then centred
          the two at different heights - the whole reason Folder and Attach a file did not line up. */}
      <div ref={picker} className="relative flex">
        <button
          type="button"
          disabled={disabled || !canUseFolder}
          aria-expanded={picking}
          onClick={() => {
            if (!picking) onNeedFiles();
            setPicking((was) => !was);
          }}
          className="rounded px-2 py-0.5 text-xs text-ink-4 hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          {t("chat.scope.attach")}
        </button>

        {picking && (
          <div className="absolute bottom-full left-0 z-40 mb-1 w-72 rounded-md border border-rule bg-app p-1 shadow-menu">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("chat.scope.filter")}
              aria-label={t("chat.scope.filter")}
              className="mb-1 w-full rounded border border-rule bg-app px-2 py-1 text-xs text-ink"
            />
            <ul className="max-h-56 overflow-auto">
              {offered.length === 0 ? (
                <li className="px-2 py-1.5 text-xs text-ink-4">{t("chat.scope.noFiles")}</li>
              ) : (
                offered.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      onClick={() => {
                        onAttach(path);
                        setPicking(false);
                        setFilter("");
                      }}
                      className="w-full truncate rounded px-2 py-1.5 text-left text-xs text-ink hover:bg-hover"
                    >
                      {path}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      <ContextDial usage={usage} />
    </div>
  );
}

/// The last segment of a workspace-relative path - what a person calls that folder.
///
/// The whole path would be more precise and less readable, on a button beside a composer where
/// width is the scarce thing.
function folderName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}
