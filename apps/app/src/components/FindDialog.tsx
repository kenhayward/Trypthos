import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { FindStatus, FindTab } from "../hooks/useFind";
import type { FindStep } from "../lib/findNavigation";

interface Props {
  tab: FindTab;
  onTabChange: (tab: FindTab) => void;
  query: string;
  onQueryChange: (query: string) => void;
  regex: boolean;
  onRegexChange: (regex: boolean) => void;
  /// The folder Find in Files would look in, workspace-relative. "" is the whole open folder, and
  /// null when there is no folder open at all.
  scope: string | null;
  status: FindStatus;
  onSearch: () => void;
  onStep: (step: FindStep) => void;
  onClose: () => void;
}

const TABS: readonly FindTab[] = ["document", "files"];

/// Find, and Find in Files.
///
/// **Not a modal, deliberately.** Every other dialog in the app takes the window over behind a
/// backdrop, and that is exactly wrong here: the whole answer is a highlight in the document
/// underneath, so a dialog that covered it would report three matches and show none of them. It
/// floats in the corner of the editor instead, and the document keeps the caret.
export default function FindDialog({
  tab,
  onTabChange,
  query,
  onQueryChange,
  regex,
  onRegexChange,
  scope,
  status,
  onSearch,
  onStep,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const field = useRef<HTMLInputElement>(null);

  // Focused and selected on open, because the only thing to do here is type a query - and selected
  // rather than merely focused so a second Ctrl+F over a query you have finished with replaces it.
  useEffect(() => field.current?.select(), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const results = status.kind === "results" ? status : null;
  const canStep = results !== null && results.total > 0;
  const canSearch = query.trim() !== "" && status.kind !== "searching";

  return (
    <div
      role="dialog"
      aria-label={t("find.title")}
      className="absolute right-4 top-4 z-40 w-80 rounded-lg border border-rule bg-panel p-3 shadow-menu"
    >
      <div role="tablist" aria-label={t("find.title")} className="flex gap-1">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => onTabChange(name)}
            className={
              tab === name
                ? "rounded px-2 py-1 text-ui font-semibold text-ink"
                : "rounded px-2 py-1 text-ui text-ink-3 hover:bg-hover hover:text-ink"
            }
          >
            {/* Two literal calls rather than one with a computed key: `i18nKeys.test.ts` scans the
                source for `t("...")`, and a key it cannot see is a key it cannot protect. */}
            {name === "document" ? t("find.tabDocument") : t("find.tabFiles")}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("find.close")}
          className="ml-auto rounded px-2 py-1 text-ui text-ink-3 hover:bg-hover hover:text-ink"
        >
          {"×"}
        </button>
      </div>

      <label className="mt-2 block text-xs text-ink-3" htmlFor="find-query">
        {t("find.query")}
      </label>
      <input
        id="find-query"
        ref={field}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          // Enter searches, and searches again once there are results - which is what makes Enter
          // the way to walk a document without reaching for the buttons.
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (canStep) onStep(event.shiftKey ? "previous" : "next");
          else if (canSearch) onSearch();
        }}
        className="mt-1 w-full rounded border border-rule bg-app px-2 py-1 text-ui text-ink"
      />

      <label className="mt-2 flex items-center gap-2 text-xs text-ink-3">
        <input
          type="checkbox"
          checked={regex}
          onChange={(event) => onRegexChange(event.target.checked)}
        />
        {t("find.regex")}
      </label>

      {/* Which folder, before the search runs rather than after. The rule - the folder you picked,
          or the one the file you are reading lives in - is easy to be surprised by, and a search
          that quietly looked somewhere else would be worse than one that refused. */}
      {tab === "files" && (
        <p className="mt-2 truncate text-xs text-ink-4">
          {scope === null
            ? t("find.noFolder")
            : t("find.scope", { folder: scope === "" ? t("find.wholeFolder") : scope })}
        </p>
      )}

      <p aria-live="polite" className="mt-2 min-h-4 text-xs text-ink-4">
        {status.kind === "searching" && t("find.searching")}
        {status.kind === "bad-pattern" && t("find.badPattern")}
        {status.kind === "failed" && t("find.failed")}
        {results !== null &&
          results.total === 0 &&
          t("find.noMatches")}
        {results !== null &&
          results.total > 0 &&
          (results.capped
            ? t("find.countCapped", { current: results.current, total: results.total })
            : t("find.count", { current: results.current, total: results.total }))}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onStep("previous")}
          disabled={!canStep}
          className="rounded px-2 py-1 text-ui text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {t("find.previous")}
        </button>
        <button
          type="button"
          onClick={() => onStep("next")}
          disabled={!canStep}
          className="rounded px-2 py-1 text-ui text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {t("find.next")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded px-3 py-1 text-ui text-ink-3 hover:bg-hover hover:text-ink"
        >
          {t("find.closeButton")}
        </button>
        <button
          type="button"
          onClick={onSearch}
          disabled={!canSearch}
          className="rounded bg-accent-strong px-3 py-1 text-ui text-white disabled:opacity-40"
        >
          {t("find.search")}
        </button>
      </div>
    </div>
  );
}
