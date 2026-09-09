import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { RepoParent, RepoStats, WorkspaceRef } from "@trypthos/domain";
import type { ImageResult } from "../lib/workspaceClient";
import Glyph from "./Glyph";
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
  /// Opens another repository as a workspace, in the app.
  ///
  /// Only one thing on this page asks for it: the repository a fork was made from. That one is
  /// deliberately not a link to the browser - it is a repository this app opens like any other, and
  /// the picker's list is filtered to the account's own repositories, which is exactly why there is
  /// otherwise no way to reach it.
  onOpenRepo: (ref: WorkspaceRef) => void;
  /// Throws away what is held and asks GitHub again.
  onRefresh: () => void;
}

/// A repository's own page: who it belongs to, what it is, its figures, and its README.
///
/// **The cards stay, the README scrolls.** A repository's README is the long part and the statistics
/// are the part you glance at, so the numbers do not scroll away from under the prose.
///
/// Read-only throughout, like the markdown guide: this is a document that is looked at, and there is
/// nothing here to save.
export default function RepoPage({
  state,
  fileTypes,
  onOpenExternal,
  onOpenRepo,
  onRefresh,
  readImage,
}: Props) {
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
            <Heading
              stats={state.stats}
              onOpenExternal={onOpenExternal}
              onOpenRepo={onOpenRepo}
              onRefresh={onRefresh}
            />

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

/// Who it belongs to, what it is called, what it is for, and the facts that change how you read it.
function Heading({
  stats,
  onOpenExternal,
  onOpenRepo,
  onRefresh,
}: {
  stats: RepoStats | null;
  onOpenExternal: (url: string) => void;
  onOpenRepo: (ref: WorkspaceRef) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex items-start gap-3">
        {stats !== null && <Owner owner={stats.owner} />}

        {/* Offered even when the statistics failed, which is the case it is most wanted for: a
            spent rate limit comes back, and without this the only way to see that is a restart. */}
        <button
          type="button"
          onClick={onRefresh}
          title={t("repo.refresh")}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded border border-rule px-2 py-1 text-xs text-ink-3 hover:bg-hover hover:text-ink"
        >
          <Glyph className="size-3.5">
            <path d="M21 4v6h-6" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L21 8" />
          </Glyph>
          {t("repo.refresh")}
        </button>
      </div>

      {stats === null ? null : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-2">
            <h2 className="text-base font-semibold text-ink">{stats.fullName}</h2>
            {/* Private and archived both change what you can expect of a repository, and neither is
                visible from its contents. */}
            {stats.private && <Badge>{t("repo.private")}</Badge>}
            {stats.archived && <Badge>{t("repo.archived")}</Badge>}
            <span className="text-xs text-ink-4">
              {t("repo.branch", { branch: stats.defaultBranch })}
            </span>
          </div>

          {stats.parent !== null && (
            <ForkLine
              parent={stats.parent}
              divergence={stats.divergence}
              onOpenRepo={onOpenRepo}
            />
          )}

          {/* Set in the reading size rather than the label size. This is the sentence that says
              what the repository is FOR, and it was the smallest text on a page of numbers. */}
          <p className="mt-1.5 text-body text-ink-2">
            {stats.description ?? t("repo.noDescription")}
          </p>

          {stats.topics.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {stats.topics.map((topic) => (
                <li
                  key={topic}
                  className="rounded-full border border-rule px-2 py-0.5 text-2xs text-ink-3"
                >
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
      )}
    </>
  );
}

/// The account a repository belongs to: their picture, the name they go by, and their login.
///
/// **The owner, not the connected account.** They are the same for every repository the picker
/// offers, and different the moment somebody opens a fork's upstream from the line below - which is
/// exactly the case a header built from "whoever is signed in" would get wrong.
function Owner({ owner }: { owner: RepoStats["owner"] }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {/* Absent rather than blank when there is no picture: an empty source draws a broken image
          where a face should be. The login names it, so a reader who cannot see it is told who. */}
      {owner.avatarUrl !== null && (
        <img
          src={owner.avatarUrl}
          alt={owner.login}
          className="size-10 shrink-0 rounded-full border border-rule bg-sunken object-cover"
        />
      )}
      <div className="min-w-0">
        {/* The login on its own when there is no display name. Drawing both would print the same
            word twice, and a blank line above it reads as a name that failed to arrive.

            Set at the top of the app's type scale: this is a name to be read at a glance beside a
            picture, not a label, and at the label size it was a caption under an avatar. */}
        {owner.name !== null && (
          <div className="truncate text-body font-semibold text-ink">{owner.name}</div>
        )}
        <div
          className={
            owner.name === null
              ? "truncate text-body font-semibold text-ink"
              : "truncate text-ui text-ink-3"
          }
        >
          {owner.login}
        </div>
      </div>
    </div>
  );
}

/// Where a fork came from, and how far it has moved.
///
/// Worth a line of its own because it changes how the rest of the page reads: a repository with two
/// stars and one commit is a different thing when it is a fork of something with two thousand.
function ForkLine({
  parent,
  divergence,
  onOpenRepo,
}: {
  parent: RepoParent;
  divergence: RepoStats["divergence"];
  onOpenRepo: (ref: WorkspaceRef) => void;
}) {
  const { t } = useTranslation();

  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-4">
      <Glyph className="size-3.5">
        <circle cx="12" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="6" r="3" />
        <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
        <path d="M12 12v3" />
      </Glyph>
      <span>{t("repo.forkedFrom")}</span>
      {/* Opened in the app rather than handed to the browser: the upstream is a repository this app
          reads like any other, and it is not in the picker's list of the account's own. */}
      <button
        type="button"
        onClick={() => onOpenRepo({ kind: "github", owner: parent.owner, repo: parent.name })}
        title={t("repo.openParent", { name: parent.fullName })}
        className="text-accent hover:underline"
      >
        {parent.fullName}
      </button>
      {divergence !== null && (
        <span className="text-ink-4">
          {t("repo.divergence", { ahead: divergence.ahead, behind: divergence.behind })}
        </span>
      )}
    </p>
  );
}

/// The figures, each with a mark of its own.
///
/// Chosen from what GitHub's own page puts beside a repository. The mark is what makes a grid of
/// numbers scannable - without one they read as a wall of digits and every glance is a read of the
/// labels.
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

  /// A count that never arrived, said as unknown rather than drawn as zero.
  ///
  /// Neither branches nor tags is on the repository response - each is a request of its own that can
  /// fail on its own - and a repository shown as having no branches at all is impossible as well as
  /// wrong.
  const counted = (value: number | null) =>
    value === null ? t("repo.unknownCount") : number.format(value);
  const countHint = (value: number | null) =>
    value === null ? t("repo.unknownCountHint") : undefined;

  return (
    <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Card label={t("repo.stars")} value={number.format(stats.stars)} icon={<Star />} />
      <Card label={t("repo.forks")} value={number.format(stats.forks)} icon={<Fork />} />
      <Card
        label={t("repo.branches")}
        value={counted(stats.branches)}
        hint={countHint(stats.branches)}
        icon={<Branch />}
      />
      <Card
        label={t("repo.tags")}
        value={counted(stats.tags)}
        hint={countHint(stats.tags)}
        icon={<Tag />}
      />
      {/* Labelled for what the figure actually is: GitHub counts pull requests in it, and there is
          no field that separates them without a second request. */}
      <Card
        label={t("repo.issues")}
        value={number.format(stats.issuesAndPullRequests)}
        hint={t("repo.issuesHint")}
        icon={<Issue />}
      />
      <Card
        label={t("repo.language")}
        value={stats.language ?? t("repo.noLanguage")}
        icon={<Code />}
      />
      <Card
        label={t("repo.licence")}
        value={stats.license ?? t("repo.noLicence")}
        icon={<Scales />}
      />
      <Card label={t("repo.lastPush")} value={pushed} icon={<Clock />} />
    </dl>
  );
}

function Card({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-rule bg-panel px-3 py-2" title={hint}>
      <dt className="flex items-center gap-1.5 text-2xs tracking-[0.06em] text-ink-4 uppercase">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-0.5 truncate text-ui font-medium text-ink">{value}</dd>
    </div>
  );
}

function Star() {
  return (
    <Glyph>
      <path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.6l6.5-.9z" />
    </Glyph>
  );
}

function Fork() {
  return (
    <Glyph>
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
      <path d="M12 12v3" />
    </Glyph>
  );
}

function Branch() {
  return (
    <Glyph>
      <path d="M6 3v12" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Glyph>
  );
}

function Tag() {
  return (
    <Glyph>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" />
      <path d="M7 7h.01" />
    </Glyph>
  );
}

function Issue() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </Glyph>
  );
}

function Code() {
  return (
    <Glyph>
      <path d="M16 18l6-6-6-6" />
      <path d="M8 6l-6 6 6 6" />
    </Glyph>
  );
}

function Scales() {
  return (
    <Glyph>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="M5 7l-3 7h6z" />
      <path d="M19 7l3 7h-6z" />
      <path d="M8 21h8" />
    </Glyph>
  );
}

function Clock() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Glyph>
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
