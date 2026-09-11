import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoPin, RepoStats } from "@trypthos/domain";
import { useRepoPage } from "./useRepoPage";
import { expectsConsoleError } from "../test-setup";
import type { GitHubBridge, WorkspaceClient } from "../lib/workspaceClient";

/// What a repository's own page needs, and what it does when it cannot get it.
///
/// Two halves that fail independently: the statistics come from GitHub, the README comes through the
/// workspace provider like any other file. One failing must not take the other away - a page with
/// its numbers and no README is still worth reading, and so is the reverse.

const STATS: RepoStats = {
  owner: { login: "ada", name: "Ada Lovelace", avatarUrl: "https://avatars.example/ada.png" },
  parent: null,
  branches: 4,
  tags: 2,
  divergence: null,
  fullName: "ada/notes",
  description: "A notebook",
  private: false,
  archived: false,
  topics: ["notes"],
  defaultBranch: "main",
  url: "https://github.com/ada/notes",
  homepage: null,
  stars: 12,
  forks: 3,
  issuesAndPullRequests: 4,
  language: "TypeScript",
  license: "MIT",
  pushedAt: "2026-01-02T00:00:00Z",
};

function fakes(overrides: { github?: Partial<GitHubBridge>; client?: Partial<WorkspaceClient> } = {}) {
  const github = {
    githubStatus: vi.fn(async () => ({ ok: true as const, connected: true, login: "ada", reason: null })),
    connectGitHub: vi.fn(async () => ({ ok: true as const, login: "ada" })),
    disconnectGitHub: vi.fn(async () => ({ ok: true })),
    listRepositories: vi.fn(async () => ({ ok: true as const, repos: [] })),
    repoInfo: vi.fn(async () => ({ ok: true as const, stats: STATS, pin: null })),
    ...overrides.github,
  } as GitHubBridge;

  const client = {
    listDirectory: vi.fn(async () => ({
      ok: true as const,
      nodes: [
        { id: "notes/src", name: "src", kind: "directory" as const },
        { id: "notes/README.md", name: "README.md", kind: "file" as const },
      ],
    })),
    readFile: vi.fn(async () => ({
      ok: true as const,
      content: "# Notes\n\nProse.",
      revision: { id: "b1" },
    })),
    ...overrides.client,
  } as unknown as WorkspaceClient;

  return { github, client };
}

describe("useRepoPage", () => {
  it("fetches the statistics for the workspace it is given", async () => {
    const { github, client } = fakes();
    const { result } = renderHook(() => useRepoPage("notes", github, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats).toEqual(STATS);
    expect(github.repoInfo).toHaveBeenCalledWith("notes");
  });

  // The README is read through the workspace provider like any other file, which is what keeps it
  // inside the boundary guard and out of a second code path of its own.
  it("reads the README from the repository's root", async () => {
    const { github, client } = fakes();
    const { result } = renderHook(() => useRepoPage("notes", github, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readme).toBe("# Notes\n\nProse.");
    expect(client.listDirectory).toHaveBeenCalledWith("notes");
    expect(client.readFile).toHaveBeenCalledWith("notes/README.md");
  });

  // Plenty of repositories have none, and that is not a failure. The page says so rather than
  // showing an error over an ordinary state.
  it("reports no README, without calling it a failure", async () => {
    const { github, client } = fakes({
      client: {
        listDirectory: vi.fn(async () => ({
          ok: true as const,
          nodes: [{ id: "notes/index.md", name: "index.md", kind: "file" as const }],
        })),
      },
    });
    const { result } = renderHook(() => useRepoPage("notes", github, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readme).toBe(null);
    expect(result.current.readmeFailed).toBe(false);
    expect(result.current.errorKey).toBe(null);
  });

  /// The distinction that matters.
  ///
  /// "There is no README" and "the README could not be read" are different facts, and showing the
  /// first for the second is a wrong answer given confidently.
  it("tells a README that could not be read from one that is not there", async () => {
    const { github, client } = fakes({
      client: { readFile: vi.fn(async () => ({ ok: false as const, reason: "too-large" })) },
    });
    const { result } = renderHook(() => useRepoPage("notes", github, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readme).toBe(null);
    expect(result.current.readmeFailed).toBe(true);
  });

  // A page with its numbers and no README is still worth reading, and so is the reverse.
  it("still shows the README when the statistics cannot be fetched", async () => {
    const { github, client } = fakes({
      github: { repoInfo: vi.fn(async () => ({ ok: false as const, reason: "rate-limited" })) },
    });
    const { result } = renderHook(() => useRepoPage("notes", github, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats).toBe(null);
    expect(result.current.errorKey).toBe("errors.rateLimited");
    expect(result.current.readme).toBe("# Notes\n\nProse.");
  });

  it("asks for nothing at all without a workspace", async () => {
    const { github, client } = fakes();
    const { result } = renderHook(() => useRepoPage(null, github, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(github.repoInfo).not.toHaveBeenCalled();
    expect(client.listDirectory).not.toHaveBeenCalled();
  });

  // The same rule as everywhere else: `ipcRenderer.invoke` rejects when a handler throws, and an
  // uncaught rejection here would leave the page saying it was loading for ever.
  it("stops loading when a call to the shell rejects outright", async () => {
    expectsConsoleError(/A call to the shell did not complete/);
    const { github, client } = fakes({
      github: { repoInfo: vi.fn((): Promise<never> => Promise.reject(new Error("no handler"))) },
    });
    const { result } = renderHook(() => useRepoPage("notes", github, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errorKey).toBe("errors.unknown");
  });

  // Switching tabs while a page is loading must not have the old answer land in the new page.
  it("drops an answer for a workspace it has since moved off", async () => {
    const { github, client } = fakes();
    const { result, rerender } = renderHook(({ id }) => useRepoPage(id, github, client), {
      initialProps: { id: "notes" as string | null },
    });

    rerender({ id: "essays" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(github.repoInfo).toHaveBeenLastCalledWith("essays");
  });
});

describe("without a shell", () => {
  beforeEach(() => expectsConsoleError(/never/));

  // The browser preview has no GitHub half at all, and a page that sat loading would be worse than
  // one that says it cannot be shown.
  it("does not sit loading when there is no bridge", async () => {
    const { client } = fakes();
    const { result } = renderHook(() => useRepoPage("notes", null, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats).toBe(null);
    expect(result.current.errorKey).toBe("errors.notDesktop");
  });
});

/// Loaded once, shown every time.
///
/// The page is a tab: you leave it for a file and come back, over and over. Fetching again on each
/// return spends a request on an hourly budget to redraw numbers that have not changed, and puts a
/// loading message over a page the reader was already looking at.
describe("returning to a page that has already loaded", () => {
  it("does not fetch again", async () => {
    const { github, client } = fakes();
    const { result, rerender } = renderHook(({ id }) => useRepoPage(id, github, client), {
      initialProps: { id: "notes" as string | null },
    });

    await waitFor(() => expect(result.current.stats).not.toBeNull());
    expect(github.repoInfo).toHaveBeenCalledTimes(1);

    // Away to a file, and back to the page.
    rerender({ id: null });
    rerender({ id: "notes" });

    expect(github.repoInfo).toHaveBeenCalledTimes(1);
    // And it is drawn straight away, rather than flashing a loading message at a reader who was
    // already looking at it.
    expect(result.current.loading).toBe(false);
    expect(result.current.stats).not.toBeNull();
  });

  // Two repositories are two pages, and one being loaded says nothing about the other.
  it("keeps each repository's page apart", async () => {
    const { github, client } = fakes();
    const { result, rerender } = renderHook(({ id }) => useRepoPage(id, github, client), {
      initialProps: { id: "notes" as string | null },
    });

    await waitFor(() => expect(result.current.stats).not.toBeNull());

    rerender({ id: "essays" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(github.repoInfo).toHaveBeenCalledTimes(2);
    expect(github.repoInfo).toHaveBeenLastCalledWith("essays");

    // Back to the first, which is still held.
    rerender({ id: "notes" });
    expect(github.repoInfo).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);
  });
});

/// Asking again, on purpose.
///
/// Holding the answer is right for a page somebody keeps returning to, and wrong the moment they
/// push a commit and want to see it. Refresh is the one way anything is asked of GitHub twice, and
/// it exists because there is otherwise no way to see a change without restarting the app.
describe("refreshing a page", () => {
  it("asks again, and shows the new answer", async () => {
    const later: RepoStats = { ...STATS, stars: 99 };
    const github = {
      ...fakes().github,
      repoInfo: vi
        .fn()
        .mockResolvedValueOnce({ ok: true as const, stats: STATS, pin: null })
        .mockResolvedValue({ ok: true as const, stats: later, pin: null }),
    } as unknown as GitHubBridge;
    const { client } = fakes();

    const { result } = renderHook(() => useRepoPage("notes", github, client));
    await waitFor(() => expect(result.current.stats?.stars).toBe(12));

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.stats?.stars).toBe(99));
    expect(github.repoInfo).toHaveBeenCalledTimes(2);
  });

  // The README is fetched with the statistics and goes stale with them, so a refresh is a refresh
  // of the page rather than of half of it.
  it("reads the README again too", async () => {
    const { github, client } = fakes();
    const { result } = renderHook(() => useRepoPage("notes", github, client));

    await waitFor(() => expect(result.current.readme).not.toBeNull());
    act(() => result.current.refresh());

    await waitFor(() => expect(client.readFile).toHaveBeenCalledTimes(2));
  });

  // Half a second of nothing, with a page that has visibly not changed, reads as a button that does
  // not work. The loading message is what says the request is in flight.
  it("says it is loading while the new answer is on its way", async () => {
    const { github, client } = fakes();
    const { result } = renderHook(() => useRepoPage("notes", github, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.refresh());

    expect(result.current.loading).toBe(true);
  });

  // Nothing on screen to refresh. A click that reached this would otherwise fetch a repository the
  // reader is not looking at.
  it("does nothing without a repository on screen", async () => {
    const { github, client } = fakes();
    const { result } = renderHook(() => useRepoPage(null, github, client));

    act(() => result.current.refresh());

    expect(github.repoInfo).not.toHaveBeenCalled();
  });
});

/// Which commit the workspace is on, and how that compares with its branch now.
describe("where a repository workspace stands", () => {
  const PIN: RepoPin = {
    branch: "main",
    commit: { sha: "abc1234", headline: "Tidy the guide", author: "ada", date: null, url: null },
    latest: null,
    newer: 0,
  };

  it("holds the commit the workspace is on", async () => {
    const { github, client } = fakes({
      github: { repoInfo: vi.fn(async () => ({ ok: true as const, stats: STATS, pin: PIN })) },
    });
    const { result } = renderHook(() => useRepoPage("notes", github, client));

    await waitFor(() => expect(result.current.pin).toEqual(PIN));
  });

  it("has nothing to say about it when the statistics could not be fetched", async () => {
    const { github, client } = fakes({
      github: { repoInfo: vi.fn(async () => ({ ok: false as const, reason: "offline" })) },
    });
    const { result } = renderHook(() => useRepoPage("notes", github, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pin).toBeNull();
  });

  /// Refreshing a repository from the workspace panel moves it to a newer commit, which makes what
  /// the page is holding wrong - so the page is told, and loads again rather than naming a commit
  /// the workspace is no longer on.
  it("loads a repository again once it has moved", async () => {
    const { github, client } = fakes();
    const { result } = renderHook(() => useRepoPage("notes", github, client));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.invalidate("notes"));

    await waitFor(() => expect(github.repoInfo).toHaveBeenCalledTimes(2));
  });

  // Held pages for repositories that are not on screen go stale just the same. Forgotten now, and
  // fetched when the reader next goes to them - not fetched now for a page nobody is looking at.
  it("forgets a repository that is not on screen, and fetches it only when it is", async () => {
    const { github, client } = fakes();
    const { result, rerender } = renderHook(({ id }) => useRepoPage(id, github, client), {
      initialProps: { id: "notes" as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ id: "essays" });
    await waitFor(() => expect(github.repoInfo).toHaveBeenCalledTimes(2));

    act(() => result.current.invalidate("notes"));
    expect(github.repoInfo).toHaveBeenCalledTimes(2);

    rerender({ id: "notes" });
    await waitFor(() => expect(github.repoInfo).toHaveBeenCalledTimes(3));
  });
});
