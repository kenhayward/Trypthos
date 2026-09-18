import { useCallback, useEffect, useState } from "react";
import { readmeNameIn } from "@trypthos/domain";
import type { WorkspaceClient } from "../lib/workspaceClient";

/// A workspace's README, for its home page - any kind of workspace.
///
/// This used to live inside the repository page's hook and ran only when a GitHub bridge existed,
/// though nothing about it was GitHub's: it is a listing and a read through the workspace provider,
/// which is what keeps it inside the boundary guard rather than in a second code path of its own. A
/// local folder's README is its front page just as much as a repository's is.
///
/// **Held rather than refetched.** The page is a tab the reader leaves and comes back to, over and
/// over, and asking again on each return would redraw text that has not changed.

export type ReadmeClient = Pick<WorkspaceClient, "listDirectory" | "readFile">;

export interface ReadmeState {
  loading: boolean;
  /// The README's text, or null when there is none - or when it could not be read.
  source: string | null;
  /// The qualified path it was read from, which is what a picture inside it is relative to:
  /// `![](docs/orb.png)` in `notes/README.md` means `notes/docs/orb.png`.
  path: string | null;
  /// True only when it could not be read. "There is no README" and "the README could not be read"
  /// are different facts, and showing the first for the second is a wrong answer given confidently.
  failed: boolean;
}

export interface ReadmeActions {
  /// Throws away what is held for one workspace, which is what makes it read again.
  invalidate(workspaceId: string): void;
}

const IDLE: ReadmeState = { loading: false, source: null, path: null, failed: false };

/// Runs one call to the shell, turning a rejection into an ordinary refusal - an uncaught rejection
/// here would leave the page saying it was loading for ever.
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

/// The root listing is what says whether there is one, and it is a listing the browser has usually
/// made already - so this costs one read at most.
async function readReadme(workspaceId: string, client: ReadmeClient): Promise<ReadmeState> {
  const listed = await attempt(() => client.listDirectory(workspaceId));
  if (!listed.ok) return { loading: false, source: null, path: null, failed: true };

  const name = readmeNameIn(listed.nodes);
  // No README at all. Ordinary, and not a failure.
  if (name === null) return IDLE;

  const path = `${workspaceId}/${name}`;
  const read = await attempt(() => client.readFile(path));
  return read.ok
    ? { loading: false, source: read.content, path, failed: false }
    : { loading: false, source: null, path: null, failed: true };
}

export function useReadme(workspaceId: string | null, client: ReadmeClient): ReadmeState & ReadmeActions {
  /// What came back, by workspace. Kept here rather than set from an effect, which is also what keeps
  /// "still loading" derivable during render: a workspace with no answer yet has not arrived.
  const [answers, setAnswers] = useState<Readonly<Record<string, ReadmeState>>>({});

  useEffect(() => {
    if (workspaceId === null || workspaceId in answers) return;
    let live = true;
    void readReadme(workspaceId, client).then((answer) => {
      // Dropped if the page has moved to another workspace, or closed, while this was in flight -
      // otherwise one folder's README lands under another's name.
      if (live) setAnswers((held) => ({ ...held, [workspaceId]: answer }));
    });
    return () => {
      live = false;
    };
  }, [workspaceId, client, answers]);

  /// Forgetting is the whole of refreshing: a workspace with nothing held has not arrived, so the
  /// effect above reads it again. One path into the read rather than two.
  const invalidate = useCallback((id: string) => {
    setAnswers((held) => {
      if (!(id in held)) return held;
      const rest = { ...held };
      delete rest[id];
      return rest;
    });
  }, []);

  if (workspaceId === null) return { ...IDLE, invalidate };
  return { ...(answers[workspaceId] ?? { ...IDLE, loading: true }), invalidate };
}
