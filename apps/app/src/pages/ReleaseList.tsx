import { useTranslation } from "react-i18next";
import type { Release } from "../lib/releaseNotes";

/// One release, drawn as it was written.
///
/// Shared by the recent list and the chapter drill-down so a release looks the same wherever it is
/// read. Nothing here is summarised or shortened: a chapter is a heading over an intact history, and
/// a drill-down that abridged its releases would make the heading a replacement for them.
function ReleaseCard({ release }: { release: Release }) {
  const { t } = useTranslation();

  const lists: [string, string[] | undefined][] = [
    [t("releaseNotes.added"), release.added],
    [t("releaseNotes.changed"), release.changed],
    [t("releaseNotes.fixed"), release.fixed],
  ];

  return (
    <article className="border-t border-hairline py-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-ink">{release.headline}</h3>
        <span className="rounded bg-sunken px-1.5 py-0.5 text-2xs font-semibold text-ink-4">
          {release.version}
        </span>
        <span className="text-2xs text-faint">{release.date}</span>
      </div>

      <p className="mt-2 text-sm text-ink-3">{release.summary}</p>

      {lists.map(([label, items]) =>
        items === undefined || items.length === 0 ? null : (
          <div key={label} className="mt-3">
            <h4 className="text-2xs font-semibold tracking-[0.06em] text-ink-4 uppercase">{label}</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-3">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ),
      )}
    </article>
  );
}

/// A run of releases, newest first. Presentational, and it holds no opinion about where they came
/// from - which is what lets the archive stay behind a lazy import while this does not.
export default function ReleaseList({ releases }: { releases: readonly Release[] }) {
  return (
    <div>
      {releases.map((release) => (
        <ReleaseCard key={release.version} release={release} />
      ))}
    </div>
  );
}
