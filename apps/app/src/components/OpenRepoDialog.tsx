import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { matchRepos, repoRefFor, type RepoSummary, type WorkspaceRef } from "@trypthos/domain";
import { useGitHub } from "../hooks/useGitHub";
import type { GitHubBridge } from "../lib/workspaceClient";

interface Props {
  /// The GitHub half of the shell, or null in the browser preview.
  bridge: GitHubBridge | null;
  onCancel: () => void;
  /// The repository the user chose. Opening it is the workspace's business, not this dialog's.
  onOpen: (ref: WorkspaceRef) => void;
}

/// Choosing a repository to open.
///
/// **Two screens, one dialog.** With no account connected it asks for a token; with one, it lists the
/// repositories. They are the same act from the user's side - "open something of mine on GitHub" -
/// and sending somebody to Settings to connect and then back here would be two journeys for one
/// intention. Settings has its own Accounts page for managing the connection afterwards; this is the
/// path for somebody who has not got one yet.
///
/// **The search is local.** The list is the user's own repositories and it is already here, so
/// filtering it is instant, works with no network, and cannot be rate-limited. Searching the whole of
/// GitHub is a different feature, and it is not this one.
export default function OpenRepoDialog({ bridge, onCancel, onOpen }: Props) {
  const { t } = useTranslation();
  const github = useGitHub(bridge);
  const [token, setToken] = useState("");
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Fetched when the dialog opens rather than when the app starts, so nothing is asked of GitHub for
  // somebody who never opens this. The shell holds the answer for the session, so opening the dialog
  // a second time costs nothing.
  const { connected, loadRepos } = github;
  useEffect(() => {
    if (connected) void loadRepos();
  }, [connected, loadRepos]);

  // Focused on whichever screen is drawn: there is exactly one thing to type on each.
  useEffect(() => {
    if (!github.checking) field.current?.focus();
  }, [github.checking, github.connected]);

  const shown = useMemo(() => matchRepos(github.repos, query), [github.repos, query]);

  const connect = async () => {
    if (await github.connect(token)) {
      // Cleared the moment it is accepted. It was only ever on its way through - see `useGitHub`.
      setToken("");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("github.title")}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      {/* Never taller than the window it is in. A fixed maximum alone overflows a short window - the
          list scrolls inside, but the buttons below it end up off the bottom of the screen. */}
      <div className="flex max-h-[min(32rem,100%)] w-full max-w-[30rem] flex-col rounded-lg border border-rule bg-app p-4 shadow-menu">
        <h2 className="text-sm font-semibold text-ink">{t("github.title")}</h2>

        {/* Repositories open read-only in this build. Said before the user opens one rather than
            when they press save: discovering it then would be discovering it too late. */}
        <p className="mt-1 text-xs text-ink-3">{t("github.readOnlyNote")}</p>

        {github.errorKey !== null && (
          <p role="alert" className="mt-3 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
            {t(github.errorKey)}
          </p>
        )}

        {!github.supported ? (
          <p className="mt-4 text-sm text-ink-3">{t("github.browserOnly")}</p>
        ) : github.checking ? (
          /* Not the connect form. Showing one for half a second to somebody who is already signed
             in would be wrong before it was right.
             Its own wording, rather than the repositories' - two states that read identically leave
             a user unable to say which one has gone wrong. */
          <p className="mt-4 text-sm text-ink-3">{t("github.checking")}</p>
        ) : !github.connected ? (
          <ConnectForm
            field={field}
            token={token}
            busy={github.loading}
            onChange={setToken}
            onConnect={() => void connect()}
          />
        ) : (
          <RepoList
            field={field}
            login={github.login}
            query={query}
            loading={github.loading}
            repos={shown}
            onQuery={setQuery}
            onRefresh={() => void github.loadRepos(true)}
            onChoose={(repo) => onOpen(repoRefFor(repo))}
          />
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover"
          >
            {t("github.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/// Asking for a token.
///
/// A password field, so a token pasted in front of somebody is not on screen - and nothing here
/// keeps it: it goes to the shell, which verifies it before it is written anywhere.
function ConnectForm({
  field,
  token,
  busy,
  onChange,
  onConnect,
}: {
  field: React.RefObject<HTMLInputElement | null>;
  token: string;
  busy: boolean;
  onChange: (token: string) => void;
  onConnect: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mt-4">
      <p className="text-xs text-ink-3">{t("github.connectBlurb")}</p>

      <label className="mt-3 block text-xs text-ink-3" htmlFor="github-token">
        {t("github.tokenLabel")}
      </label>
      <input
        id="github-token"
        ref={field}
        type="password"
        value={token}
        placeholder={t("github.tokenPlaceholder")}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onConnect();
        }}
        className="mt-1 w-full rounded border border-rule bg-app px-2 py-1 text-ui text-ink"
      />

      <button
        type="button"
        onClick={onConnect}
        disabled={busy || token.trim() === ""}
        className="mt-3 rounded bg-accent px-3 py-1 text-ui text-on-accent disabled:opacity-50"
      >
        {busy ? t("github.connecting") : t("github.connect")}
      </button>
    </div>
  );
}

/// The repositories, and the box that narrows them.
function RepoList({
  field,
  login,
  query,
  loading,
  repos,
  onQuery,
  onRefresh,
  onChoose,
}: {
  field: React.RefObject<HTMLInputElement | null>;
  login: string | null;
  query: string;
  loading: boolean;
  repos: readonly RepoSummary[];
  onQuery: (query: string) => void;
  onRefresh: () => void;
  onChoose: (repo: RepoSummary) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div className="mt-3 flex items-center gap-2">
        <input
          ref={field}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("github.search")}
          aria-label={t("github.search")}
          className="min-w-0 grow rounded border border-rule bg-app px-2 py-1 text-ui text-ink placeholder:text-faint"
        />
        {/* For somebody who has just made a repository. The shell holds the list for the session,
            which is right nearly always and wrong exactly then. */}
        <button
          type="button"
          onClick={onRefresh}
          className="shrink-0 rounded border border-rule px-2 py-1 text-ui text-ink hover:bg-hover"
        >
          {t("github.refresh")}
        </button>
      </div>

      {login !== null && (
        <p className="mt-2 text-xs text-ink-4">{t("github.connectedAs", { login })}</p>
      )}

      <div className="mt-2 min-h-0 grow overflow-auto">
        {loading && <p className="p-2 text-sm text-ink-3">{t("github.loading")}</p>}

        {/* Two different emptinesses. "You own none" and "none match what you typed" send the user
            in opposite directions, so they are not one message. */}
        {!loading && repos.length === 0 && (
          <p className="p-2 text-sm text-ink-3">
            {query.trim() === "" ? t("github.noRepos") : t("github.noMatches")}
          </p>
        )}

        {repos.map((repo) => (
          <button
            key={repo.fullName}
            type="button"
            onClick={() => onChoose(repo)}
            className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-hover"
          >
            <span className="flex w-full items-center gap-2">
              <span className="truncate text-ui font-medium text-ink">{repo.fullName}</span>
              {/* A private repository looks identical to a public one in a list, and the difference
                  matters when deciding whether to open it in front of somebody. */}
              {repo.private && (
                <span className="shrink-0 rounded border border-rule px-1 text-[0.65rem] text-ink-4">
                  {t("github.private")}
                </span>
              )}
            </span>
            {repo.description !== null && (
              <span className="line-clamp-1 text-xs text-ink-3">{repo.description}</span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
