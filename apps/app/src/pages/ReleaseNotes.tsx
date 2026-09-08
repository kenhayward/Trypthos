import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ARCHIVED_SPINE, EPOCHS, RECENT, type Epoch } from "../lib/releaseNotes";
import { epochSpan } from "../lib/releaseNotes/epochSpan";
import ReleaseList from "./ReleaseList";

/// The archive, fetched only when a chapter is opened.
///
/// `lazy` rather than an ordinary import, and the reason this page is worth having as its own
/// module: the archive holds every release ever made and grows without bound, so it must never be
/// part of what loads with the app. `bundleBoundary.test.ts` asserts the module graph directly,
/// because an eager import of it type-checks and renders correctly right up until somebody measures
/// the bundle.
const EpochDetail = lazy(() => import("./EpochDetail"));

/// Release notes, as a window over the app.
///
/// The shape is the one the release-notes data was built for: the releases since the last closed
/// chapter, open, followed by a card per chapter. Opening a chapter lists every release in it
/// verbatim - a chapter is a heading over an intact history, never a rewrite of it, so nothing here
/// merges, condenses or drops a release to make a summary read better.
///
/// Reached from Help > Release Notes. It is not a page of the settings dialog: that dialog is eager,
/// and an import of the release notes from any of its pages would put the history on every page load.
export default function ReleaseNotes({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  /// The chapter being read, or null on the summary. One piece of state, so "which chapter" and
  /// "are we in a chapter" cannot disagree.
  const [open, setOpen] = useState<Epoch | null>(null);

  // The window covers the app, so the way out has to be where a hand already is - the same rule the
  // settings dialog follows.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("releaseNotes.title")}
      className="fixed inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.55)] p-4"
    >
      <div className="flex h-[88vh] max-h-[800px] w-[94vw] max-w-[860px] flex-col overflow-hidden rounded-[10px] border border-rule bg-app shadow-menu">
        <div className="flex items-center gap-3 border-b border-rule px-6 py-4">
          {open !== null && (
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded px-2 py-1 text-sm text-ink-4 hover:bg-hover hover:text-ink"
            >
              {t("releaseNotes.back")}
            </button>
          )}

          <h1 className="min-w-0 truncate text-lg font-semibold text-ink">
            {open === null ? t("releaseNotes.title") : open.title}
          </h1>

          <button
            type="button"
            aria-label={t("releaseNotes.close")}
            title={t("releaseNotes.close")}
            onClick={onClose}
            className="ml-auto flex size-[30px] shrink-0 items-center justify-center rounded text-ink-4 hover:bg-hover hover:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 grow overflow-auto px-6 py-5">
          {open === null ? (
            <>
              <section>
                <h2 className="text-xs font-semibold tracking-[0.06em] text-ink-4 uppercase">
                  {t("releaseNotes.latest")}
                </h2>
                <div className="mt-4">
                  <ReleaseList releases={RECENT} />
                </div>
              </section>

              {EPOCHS.length > 0 && (
                <section className="mt-8">
                  <h2 className="text-xs font-semibold tracking-[0.06em] text-ink-4 uppercase">
                    {t("releaseNotes.chapters")}
                  </h2>
                  <div className="mt-4 space-y-3">
                    {EPOCHS.map((one) => (
                      <EpochCard key={one.id} epoch={one} onOpen={() => setOpen(one)} />
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-ink-3">{open.summary}</p>
              <p className="mt-2 text-2xs text-faint">
                <span>{open.from}</span>
                {" - "}
                <span>{open.to}</span>
              </p>
              <div className="mt-5">
                {/* The fallback is a line rather than a spinner: the archive is one fetch of a local
                    chunk, so a spinner would be a flash of something nobody reads. */}
                <Suspense fallback={<p className="text-sm text-ink-4">{t("releaseNotes.loading")}</p>}>
                  <EpochDetail epoch={open} />
                </Suspense>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/// One chapter, as a card on the summary.
///
/// Its size and dates come from the spine, which is a version-and-date mirror of the archive - so
/// the count on the card is derived from the same list the drill-down will show, without loading it.
function EpochCard({ epoch, onOpen }: { epoch: Epoch; onOpen: () => void }) {
  const { t } = useTranslation();
  const span = epochSpan(epoch, ARCHIVED_SPINE);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-lg border border-rule bg-panel p-4 text-left hover:border-accent"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-ink">{epoch.title}</h3>
        <span className="text-2xs text-ink-4">
          {t("releaseNotes.releaseCount", { count: span.releaseCount })}
        </span>
        {span.firstDate !== null && span.lastDate !== null && (
          <span className="text-2xs text-faint">
            {t("releaseNotes.dateSpan", { from: span.firstDate, to: span.lastDate })}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-ink-3">{epoch.summary}</p>
    </button>
  );
}
