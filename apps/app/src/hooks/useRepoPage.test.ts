import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoStats } from "@trypthos/domain";
import { useRepoPage } from "./useRepoPage";
import { expectsConsoleError } from "../test-setup";
import type { GitHubBridge, WorkspaceClient } from "../lib/workspaceClient";

/// What a repository's own page needs, and what it does when it cannot get it.
///
/// Two halves that fail independently: the statistics come from GitHub, the README comes through the
/// workspace provider like any other file. One failing must not take the other away - a page with
/// its numbers and no README is still worth reading, and so is the reverse.

const STATS: RepoStats = {
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
    repoInfo: vi.fn(async () => ({ ok: true as const, stats: STATS })),
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
