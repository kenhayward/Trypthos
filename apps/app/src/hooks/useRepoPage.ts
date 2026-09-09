import { useEffect, useState } from "react";
import { readmeNameIn, type RepoStats } from "@trypthos/domain";
import { failureKey } from "./useWorkspace";
import type { GitHubBridge, WorkspaceClient } from "../lib/workspaceClient";

/// What a repository's own page shows: its statistics, and its README.
///
/// **Two halves that fail independently.** The statistics come from GitHub; the README is read
/// through the workspace provider like any other file, which is what keeps it inside the boundary
/// guard rather than in a second code path of its own. One failing must not take the other away - a
/// page with its numbers and no README is still worth reading, and so is the reverse.
///
/// Fetched when the page opens rather than when the repository does, so a user who never opens one
/// never asks GitHub for it.

export interface RepoPageState {
  loading: boolean;
  stats: RepoStats | null;
  /// The README's text, or null when there is none - or when it could not be read.
  readme: string | null;
  /// True only for the second of those. "There is no README" and "the README could not be read" are
  /// different facts, and showing the first for the second is a wrong answer given confidently.
  readmeFailed: boolean;
  /// The qualified path the README was read from, or null when there is none.
  ///
  /// What a picture inside it is relative to: `![](docs/orb.png)` in `notes/README.md` means
  /// `notes/docs/orb.png`, and only the README's own path can say that.
  readmePath: string | null;
  /// Translation key for a failure to fetch the STATISTICS. A missing README is not a failure.
  errorKey: string | null;
}

const IDLE: RepoPageState = {
  loading: false,
  stats: null,
  readme: null,
  readmeFailed: false,
  readmePath: null,
  errorKey: null,
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

/// The README's text, or null when the repository has none.
///
/// The root listing is what says whether there is one, and it is a listing the browser has usually
/// made already - for a repository it is a read of the tree fetched at open, so this costs nothing.
async function readReadme(
  workspaceId: string,
  client: WorkspaceClient,
): Promise<{ text: string | null; failed: boolean; path: string | null }> {
  const listed = await attempt(() => client.listDirectory(workspaceId));
  if (!listed.ok) return { text: null, failed: true, path: null };

  const name = readmeNameIn(listed.nodes);
  // No README at all. Ordinary, and not a failure.
  if (name === null) return { text: null, failed: false, path: null };

  const path = `${workspaceId}/${name}`;
  const read = await attempt(() => client.readFile(path));
  return read.ok
    ? { text: read.content, failed: false, path }
    : { text: null, failed: true, path: null };
}

export function useRepoPage(
  workspaceId: string | null,
  github: GitHubBridge | null,
  client: WorkspaceClient,
): RepoPageState {
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
      // Together, because they are independent and a page that waited for one before starting the
      // other would take twice as long for no reason.
      const [info, readme] = await Promise.all([
        attempt(() => github.repoInfo(workspaceId)),
        readReadme(workspaceId, client),
      ]);

      // Dropped if the page has moved to another repository, or closed, while this was in flight -
      // otherwise one repository's numbers land under another's name.
      if (!live) return;

      setAnswers((held) => ({
        ...held,
        [workspaceId]: {
          loading: false,
          stats: info.ok ? info.stats : null,
          readme: readme.text,
          readmeFailed: readme.failed,
          readmePath: readme.path,
          errorKey: info.ok ? null : failureKey(info.reason),
        },
      }));
    })();

    return () => {
      live = false;
    };
  }, [workspaceId, github, client, answers]);

  // Derived rather than stored. Nothing here is a fetch, so nothing here belongs in an effect.
  if (workspaceId === null) return IDLE;
  // The browser preview has no GitHub half at all. Said plainly rather than left loading, which
  // would be a page that never arrives with nothing to explain it.
  if (github === null) return { ...IDLE, errorKey: failureKey("not-desktop") };

  // A repository with nothing held for it has not arrived yet.
  return answers[workspaceId] ?? { ...IDLE, loading: true };
}
