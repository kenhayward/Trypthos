import { vi } from "vitest";
import type { GraphSnapshot, WorkspaceRef } from "@trypthos/domain";
import type { ReadmeState } from "../hooks/useReadme";
import type { RepoPageState } from "../hooks/useRepoPage";
import type { WorkspaceHomeProps } from "../components/WorkspaceHome";

/// A workspace's home page's props, described once for the jsdom suite and the browser suite alike.
///
/// Two descriptions of the same props would drift, and the one that was wrong would be whichever
/// suite nobody happened to be looking at.

export const NOTES = { id: "Notes", name: "Notes", ref: { kind: "local" as const, root: "D:/Notes" } };

export const LINKED: GraphSnapshot = {
  workspaceId: "Notes",
  builtAt: "2026-09-18T09:00:00.000Z",
  unreadable: 0,
  truncated: false,
  newNotes: { mode: "root" },
  nodes: [
    { id: "Notes/Home.md", kind: "note", label: "Home", path: "Notes/Home.md", degree: 1 },
    { id: "Notes/Plan.md", kind: "note", label: "Plan", path: "Notes/Plan.md", degree: 1 },
    { id: "Notes/map.png", kind: "attachment", label: "map.png", path: "Notes/map.png", degree: 0 },
  ],
  edges: [{ source: "Notes/Home.md", target: "Notes/Plan.md", both: false }],
};

export const README: ReadmeState = {
  loading: false,
  source: "# Notes\n\nSome prose.",
  path: "Notes/README.md",
  failed: false,
};

export interface HomeOptions {
  workspace?: { id: string; name: string; ref: WorkspaceRef; vault?: boolean };
  snapshot?: GraphSnapshot | null;
  readme?: ReadmeState;
  repo?: RepoPageState | null;
  readImage?: WorkspaceHomeProps["readImage"];
}

export function homeProps({
  workspace = NOTES,
  snapshot = LINKED,
  readme = README,
  repo = null,
  readImage = async () => ({ ok: false as const, reason: "not-found" }),
}: HomeOptions = {}) {
  const graphClient = {
    graphState: vi.fn(async () => ({ ok: true as const, state: { snapshot, building: null, error: null } })),
    refreshGraph: vi.fn(async () => ({ ok: true as const })),
    onGraphProgress: () => () => {},
    onGraphChanged: () => () => {},
  };
  // A section that fills whatever it is given, so the browser suite can measure the area the page
  // hands the graph without drawing one.
  const graphPage = vi.fn(() => <div data-testid="graph-section" className="h-full w-full" />);
  const props: WorkspaceHomeProps = {
    workspace,
    graphClient: graphClient as never,
    readme,
    repo,
    fileTypes: ["markdown"],
    readImage,
    onOpenExternal: vi.fn(),
    onOpenRepo: vi.fn(),
    onRefreshRepo: vi.fn(),
    graphPage,
    now: () => Date.parse("2026-09-18T09:00:30.000Z"),
  };
  return { props, graphClient, graphPage };
}
