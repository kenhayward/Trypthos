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
  /// Translation key for a failure to fetch the STATISTICS. A missing README is not a failure.
  errorKey: string | null;
}

const IDLE: RepoPageState = {
  loading: false,
  stats: null,
  readme: null,
  readmeFailed: false,
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
): Promise<{ text: string | null; failed: boolean }> {
  const listed = await attempt(() => client.listDirectory(workspaceId));
  if (!listed.ok) return { text: null, failed: true };

  const name = readmeNameIn(listed.nodes);
  // No README at all. Ordinary, and not a failure.
  if (name === null) return { text: null, failed: false };

  const read = await attempt(() => client.readFile(`${workspaceId}/${name}`));
  return read.ok ? { text: read.content, failed: false } : { text: null, failed: true };
}

export function useRepoPage(
  workspaceId: string | null,
  github: GitHubBridge | null,
  client: WorkspaceClient,
): RepoPageState {
  /// What came back, and which repository it came back FOR.
  ///
  /// The id is stored with the answer rather than beside it, so "still loading" is something this
  /// can work out during render - a page whose answer belongs to another repository has not arrived
  /// yet. That is what keeps every state but the fetched one out of an effect: setting state
  /// synchronously in one is a cascading render, and it is the lint rule this trips otherwise.
  const [answer, setAnswer] = useState<{ id: string; state: RepoPageState } | null>(null);

  useEffect(() => {
    if (workspaceId === null || github === null) return;

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

      setAnswer({
        id: workspaceId,
        state: {
          loading: false,
          stats: info.ok ? info.stats : null,
          readme: readme.text,
          readmeFailed: readme.failed,
          errorKey: info.ok ? null : failureKey(info.reason),
        },
      });
    })();

    return () => {
      live = false;
    };
  }, [workspaceId, github, client]);

  // Derived rather than stored. Nothing here is a fetch, so nothing here belongs in an effect.
  if (workspaceId === null) return IDLE;
  // The browser preview has no GitHub half at all. Said plainly rather than left loading, which
  // would be a page that never arrives with nothing to explain it.
  if (github === null) return { ...IDLE, errorKey: failureKey("not-desktop") };

  // An answer for another repository is one that has not arrived for this one.
  return answer !== null && answer.id === workspaceId ? answer.state : { ...IDLE, loading: true };
}
