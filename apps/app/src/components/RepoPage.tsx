import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { RepoStats } from "@trypthos/domain";
import type { ImageResult } from "../lib/workspaceClient";
import MarkdownPreview from "./MarkdownPreview";
import type { RepoPageState } from "../hooks/useRepoPage";

interface Props {
  state: RepoPageState;
  /// Reads a picture the README embeds. Without it every image in it is a broken icon - see
  /// `useMarkdownImages`.
  readImage: (path: string) => Promise<ImageResult>;
  /// The file types the user has turned on, so fenced code in the README is coloured on the same
  /// terms it is anywhere else.
  fileTypes: readonly string[];
  /// Hands a web address to the user's browser. The links this component draws are its own rather
  /// than rendered markdown, so they are not covered by the delegated handler on the app root.
  onOpenExternal: (url: string) => void;
}

/// A repository's own page: what it is, six numbers about it, and its README.
///
/// **The cards stay, the README scrolls.** A repository's README is the long part and the statistics
/// are the part you glance at, so the numbers do not scroll away from under the prose.
///
/// Read-only throughout, like the markdown guide: this is a document that is looked at, and there is
/// nothing here to save.
export default function RepoPage({ state, fileTypes, onOpenExternal, readImage }: Props) {
  const { t, i18n } = useTranslation();

  return (
    // `h-full`, not `grow`: the slot this sits in is a plain block with a definite height, not a
    // flex container, so `grow` would do nothing and the page would size to its content - which is a
    // README that stretches the window instead of scrolling inside it. The image viewer and the
    // editor fill the same slot the same way.
    <div className="flex h-full flex-col overflow-hidden">
      {state.loading ? (
        <p className="p-4 text-sm text-ink-3">{t("repo.loading")}</p>
      ) : (
        <>
          <div className="shrink-0 border-b border-rule px-4 pt-3 pb-4">
            <Heading stats={state.stats} onOpenExternal={onOpenExternal} />

            {/* The numbers are gone but the README is not, so the page says which half failed
                rather than showing an empty grid of dashes. */}
            {state.stats === null && state.errorKey !== null && (
              <p role="alert" className="mt-3 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
                {t(state.errorKey)}
              </p>
            )}

            {state.stats !== null && <Cards stats={state.stats} language={i18n.language || "en"} />}
          </div>

          {/* The scrolling half. `min-h-0` is what lets it scroll rather than push the cards off
              the top - a flex child's default minimum is its content. */}
          <div className="flex min-h-0 grow flex-col">
            {state.readme !== null ? (
              <MarkdownPreview
                source={state.readme}
                fileTypes={fileTypes}
                readImage={readImage}
                fromPath={state.readmePath}
              />
            ) : (
              <p className="p-4 text-sm text-ink-3">
                {state.readmeFailed ? t("repo.readmeFailed") : t("repo.noReadme")}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/// The name, what it is for, and the two facts that change how you read the rest.
function Heading({
  stats,
  onOpenExternal,
}: {
  stats: RepoStats | null;
  onOpenExternal: (url: string) => void;
}) {
  const { t } = useTranslation();
  if (stats === null) return null;

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold text-ink">{stats.fullName}</h2>
        {/* Private and archived both change what you can expect of a repository, and neither is
            visible from its contents. */}
        {stats.private && <Badge>{t("repo.private")}</Badge>}
        {stats.archived && <Badge>{t("repo.archived")}</Badge>}
        <span className="text-xs text-ink-4">{t("repo.branch", { branch: stats.defaultBranch })}</span>
      </div>

      <p className="mt-1 text-sm text-ink-2">{stats.description ?? t("repo.noDescription")}</p>

      {stats.topics.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {stats.topics.map((topic) => (
            <li key={topic} className="rounded-full border border-rule px-2 py-0.5 text-2xs text-ink-3">
              {topic}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <ExternalLink url={stats.url} onOpen={onOpenExternal}>
          {t("repo.viewOnGitHub")}
        </ExternalLink>
        {stats.homepage !== null && (
          <ExternalLink url={stats.homepage} onOpen={onOpenExternal}>
            {t("repo.website")}
          </ExternalLink>
        )}
      </div>
    </>
  );
}

/// The six. Chosen from what GitHub's own page puts beside a repository, and no more than that: a
/// page you glance at stops being one at a dozen numbers.
function Cards({ stats, language }: { stats: RepoStats; language: string }) {
  const { t } = useTranslation();
  // Memoised because a formatter is not free to build and this renders on every keystroke elsewhere.
  const number = useMemo(() => new Intl.NumberFormat(language), [language]);
  const date = useMemo(
    () => new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric" }),
    [language],
  );

  /// An absolute date rather than "3 days ago". A relative one has to be recomputed to stay true,
  /// and a page that is open for an afternoon would quietly start lying.
  const pushed =
    stats.pushedAt === null ? t("repo.neverPushed") : date.format(new Date(stats.pushedAt));

  return (
    <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Card label={t("repo.stars")} value={number.format(stats.stars)} />
      <Card label={t("repo.forks")} value={number.format(stats.forks)} />
      {/* Labelled for what the figure actually is: GitHub counts pull requests in it, and there is
          no field that separates them without a second request. */}
      <Card
        label={t("repo.issues")}
        value={number.format(stats.issuesAndPullRequests)}
        hint={t("repo.issuesHint")}
      />
      <Card label={t("repo.language")} value={stats.language ?? t("repo.noLanguage")} />
      <Card label={t("repo.licence")} value={stats.license ?? t("repo.noLicence")} />
      <Card label={t("repo.lastPush")} value={pushed} />
    </dl>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-rule bg-panel px-3 py-2" title={hint}>
      <dt className="truncate text-2xs tracking-[0.06em] text-ink-4 uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-ui font-medium text-ink">{value}</dd>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-rule px-1.5 py-0.5 text-2xs text-ink-4">{children}</span>
  );
}

/// A link out of the app.
///
/// A button rather than an anchor: the delegated handler on the app root matches `data-md-link`,
/// which only rendered markdown carries, so an anchor drawn here would follow itself - and a
/// frameless window that navigates has replaced the application with that page.
function ExternalLink({
  url,
  onOpen,
  children,
}: {
  url: string;
  onOpen: (url: string) => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={() => onOpen(url)} className="text-accent hover:underline">
      {children}
    </button>
  );
}
