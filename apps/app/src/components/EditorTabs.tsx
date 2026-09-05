import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { documentName, tabLabels } from "@trypthos/domain";

interface Props {
  /// Qualifies the hover text, because "docs/notes.md" alone does not say which folder it is in.
  workspaceName: string | null;
  /// The open documents, in the order their tabs appear.
  paths: readonly string[];
  /// The document on screen, or null when it is the scratch buffer.
  activePath: string | null;
  /// The open documents with unsaved work.
  dirtyPaths: readonly string[];
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

/// The strip of open files above the editor.
///
/// The tabs own IDENTITY - which file, and closing it. The header beside them owns STATE - whether
/// the document on screen is saved, and how it is being looked at. Split that way so neither repeats
/// the other: the only dirty mark here is on a tab that is NOT on screen, which is the one place the
/// header cannot speak for.
export default function EditorTabs({
  workspaceName,
  paths,
  activePath,
  dirtyPaths,
  onActivate,
  onClose,
}: Props) {
  const { t } = useTranslation();
  /// Short names, lengthened only where two open files would otherwise read the same.
  const labels = useMemo(() => tabLabels(paths), [paths]);
  const strip = useRef<HTMLDivElement | null>(null);

  // The active tab can be off the end of the strip - opened from a link, or reached by keyboard with
  // twenty files open. Scrolled into view rather than left for the user to find.
  useEffect(() => {
    const selected = strip.current?.querySelector('[aria-selected="true"]');
    // Guarded because jsdom has no layout and so no `scrollIntoView`. The alternative is every test
    // that renders the strip failing on a scroll nobody can see.
    if (typeof selected?.scrollIntoView === "function") {
      selected.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activePath, paths]);

  if (paths.length === 0) {
    return (
      <div className="flex min-w-0 grow items-center px-3 py-1.5">
        <span className="truncate text-xs font-semibold tracking-[0.06em] text-ink-4 uppercase">
          {t("editor.scratch")}
        </span>
      </div>
    );
  }

  /// Arrow keys move along the strip; Enter and Space open the tab that has focus.
  ///
  /// Moving focus WITHOUT opening is deliberate: a keyboard user can look along thirty tabs without
  /// loading thirty documents, which is what selection-follows-focus would do here.
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      const next = (index + step + paths.length) % paths.length;
      focusTab(strip.current, next);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusTab(strip.current, event.key === "Home" ? 0 : paths.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate(paths[index]!);
    }
  };

  return (
    <div
      ref={strip}
      role="tablist"
      aria-label={t("editor.tabs")}
      className="flex min-w-0 grow items-stretch overflow-x-auto"
    >
      {paths.map((path, index) => {
        const selected = path === activePath;
        const name = documentName(path);
        const dirty = dirtyPaths.includes(path);

        return (
          <div
            key={path}
            role="tab"
            aria-selected={selected}
            // One tab stop for the whole strip. Thirty open files must not be thirty stops between
            // the tree and the document.
            tabIndex={selected || (activePath === null && index === 0) ? 0 : -1}
            title={workspaceName === null ? path : `${workspaceName}/${path}`}
            onClick={() => onActivate(path)}
            onKeyDown={(event) => onKeyDown(event, index)}
            // Middle-click closes, as it does in every editor and every browser. `auxclick` rather
            // than `mousedown`, so the button has to be released over the tab it started on.
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              onClose(path);
            }}
            className={
              selected
                ? "group flex max-w-52 min-w-0 shrink-0 cursor-default items-center gap-1.5 border-r border-rule bg-app px-3 py-1.5 text-ui font-semibold text-ink shadow-[inset_0_2px_0_0_var(--color-accent)]"
                : "group flex max-w-52 min-w-0 shrink-0 cursor-default items-center gap-1.5 border-r border-rule bg-sunken px-3 py-1.5 text-ui text-ink-3 hover:bg-hover hover:text-ink"
            }
          >
            <span className="min-w-0 truncate">{labels[index]}</span>

            {/* The dot and the close button share one slot: an X that appeared beside the dot would
                shift every label along on hover. The dot is a background tab's only way to say it has
                unsaved work - for the tab on screen, the header says so in words. */}
            <span className="relative size-4 shrink-0">
              {dirty && !selected && (
                <span
                  aria-label={t("editor.tabDirty", { name })}
                  className="absolute inset-0 m-1 rounded-full bg-accent group-hover:hidden"
                />
              )}
              <button
                type="button"
                aria-label={t("editor.tabClose", { name })}
                title={t("editor.tabClose", { name })}
                // Stops the tab underneath from also being selected - closing a tab is not a request
                // to go to it.
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(path);
                }}
                tabIndex={-1}
                className={
                  dirty && !selected
                    ? "absolute inset-0 hidden place-items-center rounded text-ink-4 group-hover:grid hover:bg-hover hover:text-ink"
                    : "absolute inset-0 grid place-items-center rounded text-ink-4 opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 data-[selected=true]:opacity-100"
                }
                data-selected={selected}
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
          </div>
        );
      })}
    </div>
  );
}

function focusTab(strip: HTMLDivElement | null, index: number): void {
  const tabs = strip?.querySelectorAll<HTMLElement>('[role="tab"]');
  tabs?.[index]?.focus();
}
