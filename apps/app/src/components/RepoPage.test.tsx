import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RepoStats } from "@trypthos/domain";
import RepoPage from "./RepoPage";
import type { RepoPageState } from "../hooks/useRepoPage";

const STATS: RepoStats = {
  owner: { login: "ada", name: "Ada Lovelace", avatarUrl: "https://avatars.example/ada.png" },
  parent: null,
  branches: 9,
  tags: 3,
  divergence: null,
  fullName: "ada/notes",
  description: "A notebook",
  private: false,
  archived: false,
  topics: ["notes", "markdown"],
  defaultBranch: "main",
  url: "https://github.com/ada/notes",
  homepage: "https://example.com",
  stars: 1234,
  forks: 56,
  issuesAndPullRequests: 7,
  language: "TypeScript",
  license: "MIT",
  pushedAt: "2026-01-02T00:00:00Z",
};

function draw(state: Partial<RepoPageState> = {}) {
  const onOpenExternal = vi.fn();
  const onOpenRepo = vi.fn();
  const onRefresh = vi.fn();
  const { container } = render(
    <RepoPage
      state={{
        loading: false,
        stats: STATS,
        readme: "# Notes\n\nSome prose.",
        readmeFailed: false,
        readmePath: "notes/README.md",
        errorKey: null,
        ...state,
      }}
      fileTypes={["markdown"]}
      onOpenExternal={onOpenExternal}
      onOpenRepo={onOpenRepo}
      onRefresh={onRefresh}
      readImage={async () => ({ ok: false as const, reason: "not-found" })}
    />,
  );
  return { onOpenExternal, onOpenRepo, onRefresh, container };
}

describe("RepoPage", () => {
  it("names the repository and what it is for", () => {
    draw();
    expect(screen.getByText("ada/notes")).toBeTruthy();
    expect(screen.getByText("A notebook")).toBeTruthy();
  });

  it("draws a card for each figure", () => {
    draw();
    for (const label of [
      "Stars",
      "Forks",
      "Branches",
      "Tags",
      "Issues and pull requests",
      "Language",
      "Licence",
      "Last push",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("counts the branches and the tags", () => {
    draw();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  /// Unknown is not zero.
  ///
  /// Neither count is on the repository response, so each is a request of its own that can fail on
  /// its own. A repository drawn as having no branches at all - which is impossible - would be a
  /// wrong answer given confidently.
  it("says a count is unknown rather than showing it as none", () => {
    draw({ stats: { ...STATS, branches: null, tags: null } });
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
  });

  // Colour and position are not enough on their own, and a row of bare numbers reads as a row of
  // bare numbers. The mark is what makes a figure scannable.
  it("gives every figure a mark of its own", () => {
    const { container } = draw();

    // One per card, drawn decoratively - the label beside it is what a reader hears.
    expect(container.querySelectorAll("dl svg[aria-hidden='true']")).toHaveLength(8);
  });

  // Grouped by the reader's locale, because 1234 stars is harder to read than 1,234.
  it("groups the numbers", () => {
    draw();
    expect(screen.getByText("1,234")).toBeTruthy();
    expect(screen.getByText("56")).toBeTruthy();
  });

  /// The honesty the label exists for.
  ///
  /// GitHub counts pull requests in `open_issues_count`, and there is no field separating them
  /// without a second request. A card labelled "Issues" would be a wrong answer given confidently.
  it("says that the issue count includes pull requests", () => {
    draw();
    expect(screen.getByText("Issues and pull requests")).toBeTruthy();
  });

  it("renders the README", () => {
    draw();
    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
    expect(screen.getByText("Some prose.")).toBeTruthy();
  });

  // Plenty of repositories have none, and that is not an error.
  it("says when there is no README", () => {
    draw({ readme: null });
    expect(screen.getByText("This repository has no README.")).toBeTruthy();
  });

  // Different from having none, and it must not be shown as the same thing.
  it("says when the README could not be read", () => {
    draw({ readme: null, readmeFailed: true });
    expect(screen.getByText("The README could not be read.")).toBeTruthy();
    expect(screen.queryByText("This repository has no README.")).toBeNull();
  });

  // Private and archived both change what you can expect of a repository, and neither is visible
  // from its contents.
  it("marks a private repository, and an archived one", () => {
    draw({ stats: { ...STATS, private: true, archived: true } });
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
  });

  it("leaves the badges off an ordinary repository", () => {
    draw();
    expect(screen.queryByText("Private")).toBeNull();
    expect(screen.queryByText("Archived")).toBeNull();
  });

  it("says so rather than drawing a blank for a repository with no licence or language", () => {
    draw({ stats: { ...STATS, license: null, language: null, description: null } });
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByText("Not detected")).toBeTruthy();
    expect(screen.getByText("No description.")).toBeTruthy();
  });

  it("lists the topics", () => {
    draw();
    expect(screen.getByText("notes")).toBeTruthy();
    expect(screen.getByText("markdown")).toBeTruthy();
  });

  /// A link out of the app is a button, not an anchor.
  ///
  /// The delegated handler on the app root matches `data-md-link`, which only rendered markdown
  /// carries - so an anchor drawn here would follow itself, and a frameless window that navigates
  /// has replaced the application with that page.
  it("hands a link to the browser rather than following it", async () => {
    const { onOpenExternal } = draw();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "View on GitHub" }));
    expect(onOpenExternal).toHaveBeenCalledWith("https://github.com/ada/notes");

    await user.click(screen.getByRole("button", { name: "Website" }));
    expect(onOpenExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("offers no website link when there is not one", () => {
    draw({ stats: { ...STATS, homepage: null } });
    expect(screen.queryByRole("button", { name: "Website" })).toBeNull();
  });

  // The numbers are gone but the README is not, so the page says which half failed rather than
  // showing an empty grid.
  it("shows the README even when the statistics could not be loaded", () => {
    draw({ stats: null, errorKey: "errors.rateLimited" });

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Some prose.")).toBeTruthy();
    expect(screen.queryByText("Stars")).toBeNull();
  });

  it("says it is working while it loads", () => {
    draw({ loading: true, stats: null, readme: null });
    expect(screen.getByText("Loading repository information...")).toBeTruthy();
  });
});

/// Who the repository belongs to.
///
/// The owner rather than the connected account, deliberately: a fork's upstream can be opened from
/// this page, and that repository belongs to somebody else. Reading the identity off the repository
/// is what makes the header right for every repository rather than for most of them.
describe("the owner", () => {
  it("shows their picture, their name and their login", () => {
    draw();
    expect(screen.getByRole("img", { name: "ada" }).getAttribute("src")).toBe(
      "https://avatars.example/ada.png",
    );
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("ada")).toBeTruthy();
  });

  // An account that has never set a display name. Showing the login twice would read as a mistake,
  // and a blank line above it as a missing name.
  it("shows the login alone when there is no display name", () => {
    draw({ stats: { ...STATS, owner: { login: "ada", name: null, avatarUrl: null } } });
    expect(screen.getAllByText("ada")).toHaveLength(1);
  });

  // A source that is not there draws a broken image where a face should be.
  it("draws no picture when there is none", () => {
    draw({ stats: { ...STATS, owner: { ...STATS.owner, avatarUrl: null } } });
    expect(screen.queryByRole("img", { name: "ada" })).toBeNull();
  });
});

/// Where a fork came from.
///
/// Worth saying because it changes how the rest of the page reads: a repository with two stars and
/// one commit is a different thing when it is a fork of something with two thousand.
describe("a fork", () => {
  const FORK: RepoStats = {
    ...STATS,
    parent: { fullName: "grace/notes", owner: "grace", name: "notes" },
    divergence: { ahead: 2, behind: 5 },
  };

  it("names what it was forked from", () => {
    draw({ stats: FORK });
    expect(screen.getByRole("button", { name: "grace/notes" })).toBeTruthy();
  });

  /// Opened in the app, not in a browser.
  ///
  /// The upstream is a repository this app can open like any other - the picker's own list is
  /// filtered to the account's own repositories, which is exactly why there would otherwise be no
  /// way to reach this one.
  it("opens the upstream as a workspace", async () => {
    const { onOpenRepo, onOpenExternal } = draw({ stats: FORK });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "grace/notes" }));

    expect(onOpenRepo).toHaveBeenCalledWith({ kind: "github", owner: "grace", repo: "notes" });
    expect(onOpenExternal).not.toHaveBeenCalled();
  });

  it("says how far it has moved from the upstream", () => {
    draw({ stats: FORK });
    expect(screen.getByText("2 ahead, 5 behind")).toBeTruthy();
  });

  // A comparison GitHub could not make - no common ancestor, or a difference too large. The fork is
  // still a fork, and saying so is still worth it.
  it("still names the upstream when the comparison could not be made", () => {
    draw({ stats: { ...FORK, divergence: null } });
    expect(screen.getByRole("button", { name: "grace/notes" })).toBeTruthy();
    expect(screen.queryByText(/ahead/)).toBeNull();
  });

  it("says nothing about forks for a repository that is nobody's fork", () => {
    draw();
    expect(screen.queryByText("Forked from")).toBeNull();
  });
});

/// Asking again.
///
/// The page is held for the session, which is right for something a reader keeps returning to and
/// wrong the moment they push a commit. Without this the only way to see it is to restart the app.
describe("refreshing", () => {
  it("asks the page to load again", async () => {
    const { onRefresh } = draw();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  // Nothing to ask again for while the first answer is still on its way, and a second click would
  // be a second request for the same page.
  it("offers nothing to click while the page is loading", () => {
    draw({ loading: true, stats: null, readme: null });
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  // The numbers failing is the case a refresh is most wanted for - a spent rate limit comes back.
  it("can be asked again when the statistics could not be loaded", () => {
    draw({ stats: null, errorKey: "errors.rateLimited" });
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });
});

/// Pictures in the README.
///
/// A source is a path in the workspace, and this page is drawn from the app's own origin - so
/// without resolving it every picture in every README is a broken icon.
describe("pictures in the README", () => {
  it("draws one written relative to the README", async () => {
    render(
      <RepoPage
        state={{
          loading: false,
          stats: STATS,
          readme: "# Notes\n\n![An orb](docs/orb.png)",
          readmeFailed: false,
          readmePath: "notes/README.md",
          errorKey: null,
        }}
        fileTypes={["markdown"]}
        onOpenExternal={vi.fn()}
        onOpenRepo={vi.fn()}
        onRefresh={vi.fn()}
        readImage={async (path: string) => ({
          ok: true as const,
          dataUrl: `data:image/png;base64,${path}`,
        })}
      />,
    );

    // Re-queried inside the wait, never captured before it. Putting the read picture back replaces
    // the rendered HTML, so the element found first is a detached node whose src never changes.
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "An orb" }).getAttribute("src")).toBe(
        "data:image/png;base64,notes/docs/orb.png",
      ),
    );
  });
});
