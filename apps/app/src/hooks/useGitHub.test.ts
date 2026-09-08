import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectsConsoleError } from "../test-setup";
import type { RepoSummary } from "@trypthos/domain";
import { useGitHub } from "./useGitHub";
import type { GitHubBridge } from "../lib/workspaceClient";

/// The GitHub account, from the interface's side.
///
/// What is under test is the state machine rather than the requests - which of "not connected",
/// "checking", "connected" and "that did not work" the panel is in, and that a token typed into the
/// box goes one way only.

const REPOS: RepoSummary[] = [
  { owner: "ada", name: "notes", fullName: "ada/notes", private: true, defaultBranch: "main", description: "A notebook", pushedAt: null },
  { owner: "ada", name: "essays", fullName: "ada/essays", private: false, defaultBranch: "main", description: null, pushedAt: null },
];

function fakeBridge(overrides: Partial<GitHubBridge> = {}) {
  return {
    githubStatus: vi.fn(async () => ({ ok: true as const, connected: false, login: null, reason: null })),
    connectGitHub: vi.fn(async () => ({ ok: true as const, login: "ada" })),
    disconnectGitHub: vi.fn(async () => ({ ok: true })),
    listRepositories: vi.fn(async () => ({ ok: true as const, repos: REPOS })),
    ...overrides,
  } satisfies GitHubBridge;
}

describe("useGitHub", () => {
  it("asks the shell whether an account is connected", async () => {
    const bridge = fakeBridge({
      githubStatus: vi.fn(async () => ({ ok: true as const, connected: true, login: "ada", reason: null })),
    });
    const { result } = renderHook(() => useGitHub(bridge));

    await waitFor(() => expect(result.current.login).toBe("ada"));
    expect(result.current.connected).toBe(true);
  });

  // A browser tab has no credential store and no main process to make the calls. Unsupported rather
  // than "not connected": there is nothing the user could do about it, so nothing is offered.
  it("reports no shell at all as unsupported rather than disconnected", async () => {
    const { result } = renderHook(() => useGitHub(null));

    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.supported).toBe(false);
    expect(result.current.connected).toBe(false);
  });

  it("connects with a token and reports who it belongs to", async () => {
    const bridge = fakeBridge();
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.connect("  ghp_invented  ");
    });

    // Trimmed at the edge, because a token that is only whitespace is a mistake and a stray space
    // pasted with one is not part of it.
    expect(bridge.connectGitHub).toHaveBeenCalledWith("ghp_invented");
    expect(result.current.connected).toBe(true);
    expect(result.current.login).toBe("ada");
  });

  it("reports a token GitHub would not accept, and stays disconnected", async () => {
    const bridge = fakeBridge({
      connectGitHub: vi.fn(async () => ({ ok: false as const, reason: "permission-denied" })),
    });
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.connect("ghp_wrong");
    });

    expect(result.current.connected).toBe(false);
    // A key rather than a sentence, so this hook stays free of wording - the component translates.
    expect(result.current.errorKey).toBe("errors.permissionDenied");
  });

  // An empty box is not a request. Sending it would spend a round trip to be told what the interface
  // already knows.
  it("does not call the shell with an empty token", async () => {
    const bridge = fakeBridge();
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.connect("   ");
    });

    expect(bridge.connectGitHub).not.toHaveBeenCalled();
  });

  it("disconnects, and forgets the repositories with the account", async () => {
    const bridge = fakeBridge({
      githubStatus: vi.fn(async () => ({ ok: true as const, connected: true, login: "ada", reason: null })),
    });
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.connected).toBe(true));

    await act(async () => {
      await result.current.loadRepos();
    });
    expect(result.current.repos).toHaveLength(2);

    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.login).toBeNull();
    // Keeping them would let a picker opened after signing out show the repositories of an account
    // the app can no longer reach.
    expect(result.current.repos).toEqual([]);
  });

  it("loads the repositories the account owns", async () => {
    const bridge = fakeBridge();
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.loadRepos();
    });

    expect(result.current.repos.map((repo) => repo.name)).toEqual(["notes", "essays"]);
    expect(bridge.listRepositories).toHaveBeenCalledWith(false);
  });

  it("goes back to GitHub when asked to refresh", async () => {
    const bridge = fakeBridge();
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.loadRepos(true);
    });

    expect(bridge.listRepositories).toHaveBeenCalledWith(true);
  });

  // A spent rate limit and a revoked token are different problems that send the user to different
  // places, so the refusal is carried rather than flattened into "could not load".
  it("reports why a listing failed", async () => {
    const bridge = fakeBridge({
      listRepositories: vi.fn(async () => ({ ok: false as const, reason: "rate-limited" })),
    });
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.loadRepos();
    });

    expect(result.current.errorKey).toBe("errors.rateLimited");
    expect(result.current.repos).toEqual([]);
  });

  /// The security property, from this side.
  ///
  /// The hook takes a token and hands it straight to the bridge. It must not keep one: a token held
  /// in renderer state is a token in a React devtools inspection and in a crash dump.
  it("keeps no copy of the token it was given", async () => {
    const bridge = fakeBridge();
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.connect("ghp_invented");
    });

    expect(JSON.stringify(result.current)).not.toContain("ghp_invented");
  });
});

/// A call to the shell that fails outright, rather than answering with a refusal.
///
/// `ipcRenderer.invoke` REJECTS whenever the main-process handler throws, so every one of these can
/// reject rather than resolve. Left uncaught, the hook stays in whatever state it was in - and for
/// the status check that means `checking` for ever, which is a dialog spinning on "Loading your
/// repositories..." with no error and no way out. That is the bug this describes.
describe("when the shell itself fails", () => {
  const broken = (): Promise<never> =>
    Promise.reject(new Error("No handler registered for 'github:status'"));

  // The hook logs the main-process error string rather than showing it, so each of these provokes
  // one on purpose. Declared rather than spied on: a spy would take the console away from the
  // guard for the length of the test.
  beforeEach(() => expectsConsoleError(/A call to the shell did not complete/));

  it("stops checking when the status call rejects, and says something went wrong", async () => {
    // Built once, outside the render: the hook keys its status check on the bridge's identity, and a
    // fresh object every render would cancel each check with the next render - which is how the app
    // uses it too, through a useMemo.
    const bridge = fakeBridge({ githubStatus: vi.fn(broken) });
    const { result } = renderHook(() => useGitHub(bridge));

    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.connected).toBe(false);
    expect(result.current.errorKey).toBe("errors.unknown");
  });

  it("stops connecting when the connect call rejects", async () => {
    const bridge = fakeBridge({ connectGitHub: vi.fn(broken) });
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.connect("ghp_invented");
    });

    // The button must come back rather than sitting on "Connecting..." for ever.
    expect(result.current.loading).toBe(false);
    expect(result.current.errorKey).toBe("errors.unknown");
  });

  it("stops loading when the repository call rejects", async () => {
    const bridge = fakeBridge({ listRepositories: vi.fn(broken) });
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.loadRepos();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.errorKey).toBe("errors.unknown");
  });

  it("stops disconnecting when the disconnect call rejects", async () => {
    const bridge = fakeBridge({ disconnectGitHub: vi.fn(broken) });
    const { result } = renderHook(() => useGitHub(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.errorKey).toBe("errors.unknown");
  });
});
