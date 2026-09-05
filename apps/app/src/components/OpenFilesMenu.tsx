import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { documentName } from "@trypthos/domain";
import { builtInTitleKey } from "../lib/builtInDocuments";

interface Props {
  /// Qualifies each row's folder, because "docs" alone does not say which folder it is in.
  workspaceName: string | null;
  /// The open documents, in tab order.
  paths: readonly string[];
  /// The document on screen, or null when it is the scratch buffer.
  activePath: string | null;
  /// The open documents with unsaved work.
  dirtyPaths: readonly string[];
  onActivate: (path: string) => void;
}

/// Every open file as a list, from a kebab at the end of the tab strip.
///
/// The tabs are still how you move between files. This is for when there are more of them than the
/// row can hold: a tab scrolled out of sight is a file you have to go looking for, and a list has
/// room to say where each one lives, which a tab does not.
///
/// A plain popover rather than a menu, following `ChatHistoryMenu` - the same shape of thing, and one
/// pattern for both is one set of behaviours to get right.
export default function OpenFilesMenu({
  workspaceName,
  paths,
  activePath,
  dirtyPaths,
  onActivate,
}: Props) {
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

  // Nothing to list, so nothing to press. A button that opens an empty list is a dead control in a
  // row whose width the tabs have better uses for.
  if (paths.length === 0) return null;

  return (
    <div ref={container} className="relative flex shrink-0 items-center">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        aria-label={t("editor.openFiles")}
        title={t("editor.openFiles")}
        className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-3.5"
          fill="currentColor"
          stroke="none"
        >
          <circle cx="12" cy="5" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="12" cy="19" r="1.75" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 z-40 mt-1 max-h-80 w-72 overflow-auto rounded-md border border-rule bg-app py-1 shadow-menu">
          <ul>
            {paths.map((path) => {
              const titleKey = builtInTitleKey(path);
              const name = titleKey === null ? documentName(path) : t(titleKey);
              // A built-in document is in no folder, so the line under its name says what it is
              // instead. A blank line there reads as a file whose folder could not be worked out.
              const folder = titleKey === null ? folderOf(path, workspaceName) : t("editor.readOnly");
              const dirty = dirtyPaths.includes(path);

              return (
                <li key={path} className="px-1">
                  <button
                    type="button"
                    aria-current={path === activePath ? "true" : undefined}
                    onClick={() => {
                      onActivate(path);
                      setOpen(false);
                    }}
                    className={
                      path === activePath
                        ? "flex w-full min-w-0 items-center gap-2 rounded bg-selected px-2 py-1.5 text-left hover:bg-hover"
                        : "flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover"
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui text-ink">{name}</span>
                      {/* Where the file lives, which is what tells two files with the same name
                          apart. There is room for it here in a way there is not on a tab. */}
                      <span className="block truncate text-xs text-ink-4">{folder}</span>
                    </span>
                    {dirty && (
                      <span
                        aria-label={t("editor.tabDirty", { name })}
                        className="size-1.5 shrink-0 rounded-full bg-accent"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/// The folder a document is in, qualified with the workspace. A file at the root of the workspace is
/// in the workspace itself, which is still worth saying - the row would otherwise have a blank line
/// under its name.
function folderOf(path: string, workspaceName: string | null): string {
  const cut = path.lastIndexOf("/");
  const folder = cut === -1 ? "" : path.slice(0, cut);
  if (workspaceName === null) return folder;
  return folder === "" ? workspaceName : `${workspaceName}/${folder}`;
}
