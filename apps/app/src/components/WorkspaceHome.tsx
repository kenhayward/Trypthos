import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceRef } from "@trypthos/domain";
import { useAgeText } from "../hooks/useAgeText";
import type { ReadmeState } from "../hooks/useReadme";
import type { RepoPageState } from "../hooks/useRepoPage";
import { useVaultGraph } from "../hooks/useVaultGraph";
import type { VaultGraphView } from "../hooks/useVaultGraph";
import { attachmentCount, indexAge, linkCount, noteCount } from "../lib/graphStatus";
import { homeSections, openingSection } from "../lib/homeSections";
import type { HomeSection } from "../lib/homeSections";
import type { GraphClient, ImageResult } from "../lib/workspaceClient";
import MarkdownPreview from "./MarkdownPreview";
import RepoHeading from "./RepoHeading";

/// A workspace's home page: what it is, how much is in it, its README and its graph.
///
/// One page for every kind. It replaced a repository page and a vault graph that had nothing in
/// common but being a workspace's own tab, and a plain folder that had no page at all.
///
/// **The heading never scrolls.** It says which workspace is on screen, which is the one thing that
/// must not be lost while reading something inside it.
///
/// **The sections do not share the area.** A graph canvas takes the wheel to zoom and a README
/// scrolls; put one inside the other and the wheel is wrong in one of them - either the page jumps
/// when the pointer crosses the graph, or the graph cannot be zoomed. Each gets the whole remaining
/// height in turn, and one control moves between them.
///
/// **Eager, and never names the graph.** `graphPage` is a render function `App` supplies, because
/// the graph page and everything under it is lazy and `graphBundle.test.ts` would fail on a static
/// import here - rightly, since it would put sigma on every page load.

/// Mirrors `NOTE_LIMIT` in the main process's index, for the line that says a graph stopped there.
const NOTE_LIMIT = 5000;

export interface WorkspaceHomeProps {
  workspace: { id: string; name: string; ref: WorkspaceRef; vault?: boolean };
  graphClient: GraphClient;
  /// The workspace's README, read in `App` rather than here so a repository's Refresh can read it
  /// again along with its statistics.
  readme: ReadmeState;
  /// The repository's heading, for a GitHub workspace; null for every other kind.
  repo: RepoPageState | null;
  fileTypes: readonly string[];
  readImage: (path: string) => Promise<ImageResult>;
  onOpenExternal: (url: string) => void;
  onOpenRepo: (ref: WorkspaceRef) => void;
  onRefreshRepo: () => void;
  graphPage: (graph: VaultGraphView) => React.ReactNode;
  now?: () => number;
}

export default function WorkspaceHome({
  workspace,
  graphClient,
  readme,
  repo,
  fileTypes,
  readImage,
  onOpenExternal,
  onOpenRepo,
  onRefreshRepo,
  graphPage,
  now = Date.now,
}: WorkspaceHomeProps) {
  const { t } = useTranslation();
  const ageText = useAgeText();
  // A repository has no index yet. Asking would only be answered "unsupported", so it is not asked.
  const graph = useVaultGraph(graphClient, workspace.ref.kind === "local" ? workspace.id : null);

  const snapshot = graph.snapshot;
  const sections = homeSections({ edges: snapshot?.edges.length ?? 0, hasReadme: readme.source !== null });
  /// Null until the user chooses. Until then the page follows `openingSection`, so a graph that
  /// finishes building after the page opened is where the page goes, rather than where it was.
  const [chosen, setChosen] = useState<HomeSection | null>(null);
  const shown = chosen !== null && sections.includes(chosen) ? chosen : openingSection(sections);
  const settled = !readme.loading && graph.building === null;

  return (
    // `h-full`, not `grow`: the slot this sits in is a plain block with a definite height rather
    // than a flex container, so `grow` would do nothing and the page would size to its content.
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-rule px-4 pt-3 pb-3">
        {workspace.ref.kind === "github" && repo !== null ? (
          <RepoHeading state={repo} onOpenExternal={onOpenExternal} onOpenRepo={onOpenRepo} onRefresh={onRefreshRepo} />
        ) : (
          <h2 className="text-lg font-semibold text-ink">{workspace.name}</h2>
        )}

        <p className="mt-1 text-xs text-ink-4">
          {workspace.ref.kind === "github"
            ? t("home.kindRepository")
            : `${workspace.vault === true ? t("home.kindVault") : t("home.kindFolder")} - ${workspace.ref.root}`}
        </p>

        {snapshot !== null && (
          <p className="mt-2 text-xs text-ink-3">
            {t("home.counts", {
              notes: noteCount(snapshot),
              links: linkCount(snapshot),
              attachments: attachmentCount(snapshot),
              age: ageText(indexAge(snapshot.builtAt, now())),
            })}
          </p>
        )}
        {/* A graph that stopped quietly would be a wrong answer given confidently. */}
        {snapshot?.truncated === true && (
          <p className="mt-1 text-xs text-ink-4">{t("home.truncated", { count: NOTE_LIMIT })}</p>
        )}

        {/* A control with one choice is not a control, so a single section draws none. */}
        {sections.length > 1 && (
          <div role="tablist" aria-label={t("home.sections")} className="mt-3 flex gap-1">
            {sections.map((section) => (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={section === shown}
                onClick={() => setChosen(section)}
                className={
                  section === shown
                    ? "rounded-full border border-rule bg-sunken px-3 py-0.5 text-xs text-ink"
                    : "rounded-full border border-rule px-3 py-0.5 text-xs text-ink-4 hover:text-ink"
                }
              >
                {section === "graph" ? t("home.sectionGraph") : t("home.sectionReadme")}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* The whole remaining height, for whichever section is shown. `min-h-0` is what lets a flex
          child be smaller than its content, which is what lets the README scroll inside it. */}
      <div className="min-h-0 grow">
        {shown === "graph" && graphPage(graph)}
        {shown === "readme" && readme.source !== null && (
          <MarkdownPreview source={readme.source} fileTypes={fileTypes} readImage={readImage} fromPath={readme.path} />
        )}
        {shown === null && settled && (
          <p className="p-4 text-sm text-ink-3">{readme.failed ? t("home.readmeFailed") : t("home.empty")}</p>
        )}
      </div>
    </div>
  );
}
