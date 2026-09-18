import { useCallback, useEffect, useState } from "react";
import type { RepoPin, RepoStats } from "@trypthos/domain";
import { failureKey } from "./useWorkspace";
import type { GitHubBridge } from "../lib/workspaceClient";

/// What a repository's heading shows on its workspace's home page: its statistics and its commit.
///
/// The README used to be fetched here too. Nothing about it was GitHub's, and every workspace's home
/// page can show one now, so it moved to `useReadme` - which also means a repository whose statistics
/// cannot be fetched still has its README, since the two no longer share a request.
///
/// Fetched when the page opens rather than when the repository does, so a user who never opens one
/// never asks GitHub for it.

export interface RepoPageState {
  loading: boolean;
  stats: RepoStats | null;
  /// Translation key for a failure to fetch the statistics.
  errorKey: string | null;
  /// Which commit the workspace is on and how that compares with its branch now, or null when the
  /// statistics did not arrive. Comes with them, so it goes stale - and is refreshed - with them.
  pin: RepoPin | null;
}

export interface RepoPageActions {
  /// Throws away what is held for the repository on screen, which is what makes it load again.
  ///
  /// The one way anything here is asked of GitHub twice. Holding the answer is right for a page
  /// somebody keeps returning to and wrong the moment they push a commit - and without this the
  /// only way to see that commit is to restart the app.
  refresh(): void;
  /// Throws away what is held for ONE repository, on screen or not.
  ///
  /// For when the workspace itself has moved - refreshed to a newer commit from the panel - which
  /// makes the page's "on commit" wrong whether or not anybody is looking at it. One on screen loads
  /// again straight away; one that is not is fetched when it is next opened.
  invalidate(workspaceId: string): void;
}

const IDLE: RepoPageState = {
  loading: false,
  stats: null,
  errorKey: null,
  pin: null,
};

/// Runs one call to the shell, turning a rejection into an ordinary refusal.
///
/// The same rule as `useGitHub`: `ipcRenderer.invoke` rejects whenever a handler throws, and an
/// uncaught rejection here would leave the page saying it was loading for ever.
async function attempt<T extends { ok: boolean }>(
  call: () => Promise<T>,
): Promise<T | { ok: false; reason: string }> {
  try {
    return await call();
  } catch (error) {
    console.error("A call to the shell did not complete:", error);
    return { ok: false, reason: "unknown" };
  }
}

export function useRepoPage(
  workspaceId: string | null,
  github: GitHubBridge | null,
): RepoPageState & RepoPageActions {
  /// What came back, by repository.
  ///
  /// **Held rather than refetched.** The page is a tab: the reader leaves it for a file and comes
  /// back, over and over. Asking again on each return spends a request on an hourly budget to redraw
  /// numbers that have not changed, and puts a loading message over a page they were already
  /// reading. Keyed by workspace, because two repositories are two pages.
  ///
  /// Keeping it here rather than in an effect is also what keeps "still loading" derivable during
  /// render: a repository with no answer yet has not arrived. Setting that synchronously in an
  /// effect is a cascading render, and the lint rule says so.
  const [answers, setAnswers] = useState<Readonly<Record<string, RepoPageState>>>({});

  useEffect(() => {
    if (workspaceId === null || github === null) return;
    // Already have it. The page is drawn from what is held, and nothing is asked of GitHub.
    if (workspaceId in answers) return;

    let live = true;

    void (async () => {
      const info = await attempt(() => github.repoInfo(workspaceId));

      // Dropped if the page has moved to another repository, or closed, while this was in flight -
      // otherwise one repository's numbers land under another's name.
      if (!live) return;

      setAnswers((held) => ({
        ...held,
        [workspaceId]: {
          loading: false,
          stats: info.ok ? info.stats : null,
          errorKey: info.ok ? null : failureKey(info.reason),
          pin: info.ok ? (info.pin ?? null) : null,
        },
      }));
    })();

    return () => {
      live = false;
    };
  }, [workspaceId, github, answers]);

  /// Forgetting is the whole of refreshing.
  ///
  /// Dropping the held answer is what the effect above is watching for - a repository with nothing
  /// held has not arrived, so it fetches, and the page says it is loading while it does. That is
  /// one path into the request rather than two, which is what keeps a refresh and a first load from
  /// drifting into behaving differently.
  const invalidate = useCallback((id: string) => {
    setAnswers((held) => {
      // Already on its way, or never loaded. Asking again would start a second request for the
      // same page - and there is nothing held to go stale.
      if (!(id in held)) return held;

      const rest = { ...held };
      delete rest[id];
      return rest;
    });
  }, []);

  const refresh = useCallback(() => {
    if (workspaceId !== null) invalidate(workspaceId);
  }, [workspaceId, invalidate]);

  // Derived rather than stored. Nothing here is a fetch, so nothing here belongs in an effect.
  if (workspaceId === null) return { ...IDLE, refresh, invalidate };
  // The browser preview has no GitHub half at all. Said plainly rather than left loading, which
  // would be a page that never arrives with nothing to explain it.
  if (github === null) return { ...IDLE, errorKey: failureKey("not-desktop"), refresh, invalidate };

  // A repository with nothing held for it has not arrived yet.
  return { ...(answers[workspaceId] ?? { ...IDLE, loading: true }), refresh, invalidate };
}
