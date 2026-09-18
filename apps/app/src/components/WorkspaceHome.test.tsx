import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { GraphSnapshot } from "@trypthos/domain";
import type { ReadmeState } from "../hooks/useReadme";
import type { RepoPageState } from "../hooks/useRepoPage";
import { homeProps, LINKED, NOTES } from "../testing/workspaceHomeProps";
import type { HomeOptions } from "../testing/workspaceHomeProps";
import WorkspaceHome from "./WorkspaceHome";

/// A workspace's home page. The heading and counts are always there; each section exists only when
/// it has something in it, and one control moves between them.

const VAULT = { ...NOTES, vault: true };
const REPO = { id: "Repo", name: "notes", ref: { kind: "github" as const, owner: "ada", repo: "notes" } };

const linked: GraphSnapshot = LINKED;
const unlinked: GraphSnapshot = { ...LINKED, edges: [] };

const NO_README: ReadmeState = { loading: false, source: null, path: null, failed: false };

const REPO_STATE: RepoPageState = { loading: false, stats: null, errorKey: null, pin: null };

function page(options: HomeOptions = {}) {
  const { props, graphClient, graphPage } = homeProps(options);
  render(<WorkspaceHome {...props} />);
  return { graphPage, graphClient };
}

describe("a workspace's home page", () => {
  it("names the workspace and what kind it is", () => {
    page();
    expect(screen.getByRole("heading", { name: "Notes", level: 2 })).toBeTruthy();
    expect(screen.getByText(/^Folder/)).toBeTruthy();
  });

  it("says a vault is a vault", () => {
    page({ workspace: VAULT });
    expect(screen.getByText(/^Obsidian vault/)).toBeTruthy();
  });

  it("counts what the index found", async () => {
    page();
    await waitFor(() =>
      expect(screen.getByText("2 notes - 1 links - 1 attachments - indexed just now")).toBeTruthy(),
    );
  });

  it("opens on the graph when something links to something", async () => {
    page();
    await waitFor(() => expect(screen.getByTestId("graph-section")).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Graph" }).getAttribute("aria-selected")).toBe("true");
  });

  it("moves to the README and back", async () => {
    page();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Readme" })).toBeTruthy());
    await userEvent.click(screen.getByRole("tab", { name: "Readme" }));
    await waitFor(() => expect(screen.getByText("Some prose.")).toBeTruthy());
    expect(screen.queryByTestId("graph-section")).toBe(null);

    await userEvent.click(screen.getByRole("tab", { name: "Graph" }));
    expect(screen.getByTestId("graph-section")).toBeTruthy();
  });

  // A graph with no edges is a field of dots, which is worse than no graph.
  it("offers no graph when nothing links to anything", async () => {
    page({ snapshot: unlinked });
    await waitFor(() => expect(screen.getByText("Some prose.")).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "Graph" })).toBe(null);
  });

  // A control with one choice is not a control.
  it("draws no tab list for a single section", async () => {
    page({ snapshot: unlinked });
    await waitFor(() => expect(screen.getByText("Some prose.")).toBeTruthy());
    expect(screen.queryByRole("tablist")).toBe(null);
  });

  it("says plainly when there is neither", async () => {
    page({ snapshot: unlinked, readme: NO_README });
    await waitFor(() =>
      expect(screen.getByText("This folder has no README, and none of its notes link to each other.")).toBeTruthy(),
    );
    expect(screen.queryByRole("tablist")).toBe(null);
  });

  // "There is no README" and "the README could not be read" are different facts.
  it("says when the README could not be read", async () => {
    page({ snapshot: unlinked, readme: { loading: false, source: null, path: null, failed: true } });
    await waitFor(() => expect(screen.getByText("The README could not be read.")).toBeTruthy());
  });

  it("says when the graph is not the whole folder", async () => {
    page({ snapshot: { ...linked, truncated: true } });
    await waitFor(() => expect(screen.getByText(/Only the first 5000 notes are in this graph/)).toBeTruthy());
  });

  // A repository has no index yet, so no counts and no Graph section - which falls out of the rule
  // that a section needs content, rather than being a case of its own.
  it("gives a repository its heading and README, and no graph", async () => {
    const { graphClient } = page({ workspace: REPO, snapshot: null, repo: REPO_STATE });
    await waitFor(() => expect(screen.getByText("Some prose.")).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "Graph" })).toBe(null);
    expect(screen.getByText("GitHub repository")).toBeTruthy();
    // Asking would only be answered "unsupported", so it is not asked.
    expect(graphClient.graphState).not.toHaveBeenCalled();
  });
});

/// Pictures in the README.
///
/// A source is a path in the workspace, and this page is drawn from the app's own origin - so
/// without resolving it every picture in every README is a broken icon. Moved here from the
/// repository page, which no longer draws a README.
describe("pictures in the README", () => {
  it("draws one written relative to the README", async () => {
    page({
      workspace: REPO,
      snapshot: null,
      repo: REPO_STATE,
      readme: { loading: false, source: "# Notes\n\n![An orb](docs/orb.png)", path: "notes/README.md", failed: false },
      readImage: async (path: string) => ({ ok: true as const, dataUrl: `data:image/png;base64,${path}` }) as never,
    });

    // Re-queried inside the wait, never captured before it. Putting the read picture back replaces
    // the rendered HTML, so the element found first is a detached node whose src never changes.
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "An orb" }).getAttribute("src")).toBe(
        "data:image/png;base64,notes/docs/orb.png",
      ),
    );
  });
});
