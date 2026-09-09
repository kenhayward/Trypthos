import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RepoStats } from "@trypthos/domain";
import RepoPage from "./RepoPage";
import type { RepoPageState } from "../hooks/useRepoPage";

const STATS: RepoStats = {
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
  render(
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
      readImage={async () => ({ ok: false as const, reason: "not-found" })}
    />,
  );
  return { onOpenExternal };
}

describe("RepoPage", () => {
  it("names the repository and what it is for", () => {
    draw();
    expect(screen.getByText("ada/notes")).toBeTruthy();
    expect(screen.getByText("A notebook")).toBeTruthy();
  });

  it("draws the six cards", () => {
    draw();
    for (const label of [
      "Stars",
      "Forks",
      "Issues and pull requests",
      "Language",
      "Licence",
      "Last push",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
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
