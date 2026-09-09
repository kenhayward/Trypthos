import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectsConsoleError } from "../test-setup";
import type { RepoSummary } from "@trypthos/domain";
import OpenRepoDialog from "./OpenRepoDialog";
import type { GitHubBridge, GitHubStatus } from "../lib/workspaceClient";

/// The repository picker.
///
/// Two screens in one dialog, and which one is drawn is decided by whether an account is connected -
/// because they are the same act from the user's side: "open something of mine on GitHub", which
/// needs a connection first if there is not one.

const REPOS: RepoSummary[] = [
  { owner: "ada", name: "notes", fullName: "ada/notes", private: true, defaultBranch: "main", description: "A daily notebook", pushedAt: null },
  { owner: "ada", name: "essays", fullName: "ada/essays", private: false, defaultBranch: "trunk", description: null, pushedAt: null },
  { owner: "ada", name: "recipes", fullName: "ada/recipes", private: false, defaultBranch: "main", description: null, pushedAt: null },
];

function bridge(overrides: Partial<GitHubBridge> = {}): GitHubBridge {
  return {
    githubStatus: vi.fn(async () => ({ ok: true as const, connected: true, login: "ada", reason: null })),
    connectGitHub: vi.fn(async () => ({ ok: true as const, login: "ada" })),
    disconnectGitHub: vi.fn(async () => ({ ok: true })),
    listRepositories: vi.fn(async () => ({ ok: true as const, repos: REPOS })),
    repoInfo: vi.fn(async () => ({ ok: false as const, reason: "unsupported" })),
    ...overrides,
  };
}

function draw(props: Partial<Parameters<typeof OpenRepoDialog>[0]> = {}) {
  const onOpen = vi.fn();
  const onCancel = vi.fn();
  render(<OpenRepoDialog bridge={bridge()} onOpen={onOpen} onCancel={onCancel} {...props} />);
  return { onOpen, onCancel };
}

describe("OpenRepoDialog", () => {
  it("lists the repositories the account owns", async () => {
    draw();

    expect(await screen.findByRole("button", { name: /ada\/notes/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /ada\/essays/ })).toBeTruthy();
  });

  // Which repository is which is exactly what a bare name does not say when three of them are open
  // in different accounts, so the description is on the row.
  it("shows a repository's description", async () => {
    draw();
    expect(await screen.findByText("A daily notebook")).toBeTruthy();
  });

  // A private repository looks identical to a public one in a list, and the difference matters when
  // deciding whether to open it in front of somebody.
  it("marks a private repository as private", async () => {
    draw();
    const row = await screen.findByRole("button", { name: /ada\/notes/ });
    expect(row.textContent).toContain("Private");
  });

  it("opens the repository that was clicked", async () => {
    const { onOpen } = draw();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /ada\/notes/ }));

    expect(onOpen).toHaveBeenCalledWith({ kind: "github", owner: "ada", repo: "notes" });
  });

  it("narrows the list as a search is typed", async () => {
    draw();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /ada\/notes/ });

    await user.type(screen.getByRole("searchbox"), "ess");

    await waitFor(() => expect(screen.queryByRole("button", { name: /ada\/notes/ })).toBeNull());
    expect(screen.getByRole("button", { name: /ada\/essays/ })).toBeTruthy();
  });

  it("says so when nothing matches, rather than showing an empty list", async () => {
    draw();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /ada\/notes/ });

    await user.type(screen.getByRole("searchbox"), "zzz");

    expect(await screen.findByText("No repositories match.")).toBeTruthy();
  });

  /// With no account connected the dialog asks for one instead.
  ///
  /// The same dialog rather than a separate route through Settings: the user asked to open a
  /// repository, and sending them somewhere else to come back afterwards is two journeys for one
  /// intention.
  it("asks for a token when no account is connected", async () => {
    draw({
      bridge: bridge({
        githubStatus: vi.fn(async () => ({ ok: true as const, connected: false, login: null, reason: null })),
      }),
    });

    expect(await screen.findByLabelText("Personal access token")).toBeTruthy();
  });

  it("connects with the token that was typed, then lists the repositories", async () => {
    const connectGitHub = vi.fn(async (_token: string) => ({ ok: true as const, login: "ada" }));
    let connected = false;

    draw({
      bridge: bridge({
        githubStatus: vi.fn(async () => ({ ok: true as const, connected,
          login: connected ? "ada" : null,
          reason: null,
        })),
        connectGitHub: vi.fn(async (token: string) => {
          connected = true;
          return connectGitHub(token);
        }),
      }),
    });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Personal access token"), "ghp_invented");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(connectGitHub).toHaveBeenCalledWith("ghp_invented");
    expect(await screen.findByRole("button", { name: /ada\/notes/ })).toBeTruthy();
  });

  // The token box is a password field, so a token pasted in front of somebody is not on screen.
  it("does not show the token as it is typed", async () => {
    draw({
      bridge: bridge({
        githubStatus: vi.fn(async () => ({ ok: true as const, connected: false, login: null, reason: null })),
      }),
    });

    const field = await screen.findByLabelText("Personal access token");
    expect(field.getAttribute("type")).toBe("password");
  });

  it("says why a token was refused, and stays on the connect form", async () => {
    draw({
      bridge: bridge({
        githubStatus: vi.fn(async () => ({ ok: true as const, connected: false, login: null, reason: null })),
        connectGitHub: vi.fn(async () => ({ ok: false as const, reason: "permission-denied" })),
      }),
    });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Personal access token"), "ghp_wrong");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Trypthos is not allowed to open that.")).toBeTruthy();
    expect(screen.getByLabelText("Personal access token")).toBeTruthy();
  });

  it("reports a listing GitHub refused", async () => {
    draw({
      bridge: bridge({
        listRepositories: vi.fn(async () => ({ ok: false as const, reason: "rate-limited" })),
      }),
    });

    expect(await screen.findByText(/as many requests as it allows/)).toBeTruthy();
  });

  // Repositories open read-only in this build, and a user about to edit one has to know before they
  // type rather than when they press save.
  it("says that a repository opens read-only", async () => {
    draw();
    expect(await screen.findByText(/read-only/i)).toBeTruthy();
  });

  it("closes on Escape without opening anything", async () => {
    const { onCancel, onOpen } = draw();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /ada\/notes/ });

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  // A browser tab has no credential store and no main process to make the calls. Saying so beats a
  // Connect button that silently does nothing.
  it("says the browser preview cannot connect, rather than offering a form that cannot work", async () => {
    draw({ bridge: null });

    expect(await screen.findByText(/needs the desktop app/)).toBeTruthy();
    expect(screen.queryByLabelText("Personal access token")).toBeNull();
  });
});

/// A dialog that cannot say what went wrong is the bug this pair guards.
describe("when the shell itself fails", () => {
  const broken = (): Promise<never> =>
    Promise.reject(new Error("No handler registered for 'github:status'"));

  beforeEach(() => expectsConsoleError(/A call to the shell did not complete/));

  // The reported symptom: the dialog sat on a loading message for ever, with no error and no way
  // out, because a rejected IPC call left the status check running.
  it("stops loading and says something went wrong, rather than spinning for ever", async () => {
    draw({ bridge: bridge({ githubStatus: vi.fn(broken) }) });

    expect(await screen.findByText("Something went wrong.")).toBeTruthy();
    expect(screen.queryByText("Checking your GitHub account...")).toBeNull();
    // And it falls back to the form, so there is something to do about it.
    expect(screen.getByLabelText("Personal access token")).toBeTruthy();
  });
});

describe("the two things it waits for", () => {
  // They read differently on purpose: a user who cannot tell "checking your account" from "fetching
  // your repositories" cannot say which one has gone wrong.
  it("says which one it is doing", async () => {
    let settle: (() => void) | null = null;
    draw({
      bridge: bridge({
        githubStatus: vi.fn(
          () =>
            new Promise<GitHubStatus>((resolve) => {
              settle = () => resolve({ ok: true, connected: true, login: "ada", reason: null });
            }),
        ),
      }),
    });

    expect(await screen.findByText("Checking your GitHub account...")).toBeTruthy();
    await act(async () => {
      settle!();
    });
    expect(await screen.findByRole("button", { name: /ada\/notes/ })).toBeTruthy();
  });
});
