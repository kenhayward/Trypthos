import { Suspense, lazy, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useGraphLayout } from "../hooks/useGraphLayout";
import { useVaultGraph } from "../hooks/useVaultGraph";
import { graphNodeAction } from "../lib/graphActions";
import { hiddenNodes, searchMatches } from "../lib/graphFilters";
import type { GraphFilter } from "../lib/graphFilters";
import type { LayoutRunner } from "../lib/graphLayoutTypes";
import { indexAge, linkCount, noteCount, percentRead } from "../lib/graphStatus";
import type { IndexAge } from "../lib/graphStatus";
import { useLayoutRunner } from "../lib/layoutClient";
import type { GraphClient } from "../lib/workspaceClient";
import type { GraphCanvasProps } from "./GraphCanvas";
import Glyph from "./Glyph";

/// The vault graph tab. Lazy only - see `graphBundle.test.ts`.

/// The canvas, fetched when the tab first draws a graph.
///
/// `lazy` rather than a static import, although `graphBundle.test.ts` would allow one here: sigma
/// reads `WebGL2RenderingContext` as its module body runs, and jsdom has no such global, so a static
/// import would make this whole file unloadable in the jsdom suite - every test below would fail on
/// importing a canvas that no test here even draws. It is also what `GraphCanvas`'s own doc asks
/// for. The cost is one more chunk on a tab that is itself already lazy.
const GraphCanvas = lazy(() => import("./GraphCanvas"));

export interface GraphPageProps {
  workspaceId: string;
  vaultName: string;
  client: GraphClient;
  activePath: string | null;
  filter: GraphFilter;
  onFilterChange(change: Partial<GraphFilter>): void;
  onOpenPath(path: string): void;
  onCreateNote(request: { directory: string; name: string }): void;
  layout?: LayoutRunner;
  Canvas?: ComponentType<GraphCanvasProps>;
  now?: () => number;
}

/// The runner used if `useLayoutRunner` ever answers "no runner yet". It never does - it hands back
/// a stable function that waits for its worker - but its type says it can, and a promise that never
/// settles is the honest stand-in: the view reads as "not drawn yet", exactly as it would while a
/// real layout was still running.
const never: LayoutRunner = () => new Promise(() => {});

function useAgeText(): (age: IndexAge) => string {
  const { t } = useTranslation();
  return (age) => {
    if (age.unit === "minutes") return t("graph.ageMinutes", { count: age.count });
    if (age.unit === "hours") return t("graph.ageHours", { count: age.count });
    if (age.unit === "days") return t("graph.ageDays", { count: age.count });
    return t("graph.ageNow");
  };
}

export default function GraphPage({
  workspaceId,
  vaultName,
  client,
  activePath,
  filter,
  onFilterChange,
  onOpenPath,
  onCreateNote,
  layout,
  Canvas = GraphCanvas,
  now = Date.now,
}: GraphPageProps) {
  const { t } = useTranslation();
  const ageText = useAgeText();
  const graph = useVaultGraph(client, workspaceId);
  const run = useLayoutRunner(layout);
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);

  const { snapshot, building, progress, error } = graph;
  const input = useMemo(() => (snapshot === null ? null : { nodes: snapshot.nodes, edges: snapshot.edges }), [snapshot]);
  const positions = useGraphLayout(input, run ?? never);
  const hidden = useMemo(() => (snapshot === null ? new Set<string>() : hiddenNodes(snapshot, filter)), [snapshot, filter]);
  const matches = useMemo(() => (snapshot === null ? [] : searchMatches(snapshot, query)), [snapshot, query]);
  const highlighted = useMemo(() => (query.trim() === "" ? null : new Set(matches)), [matches, query]);
  const activeId = snapshot?.nodes.some((node) => node.id === activePath) ? activePath : null;

  const chips: { key: keyof GraphFilter; label: string }[] = [
    { key: "notes", label: t("graph.chipNotes") },
    { key: "attachments", label: t("graph.chipAttachments") },
    { key: "tags", label: t("graph.chipTags") },
    { key: "unresolved", label: t("graph.chipUnresolved") },
    { key: "orphans", label: t("graph.chipOrphans") },
  ];

  const progressText = (value: NonNullable<typeof progress>) =>
    value.walking ? t("graph.progressWalking", { read: value.read, total: value.total }) : t("graph.progress", { read: value.read, total: value.total });

  let status: { text: string; danger: boolean } | null = null;
  if (error !== null) status = { text: t("graph.buildFailed"), danger: true };
  else if (progress !== null && snapshot !== null) {
    status = {
      text: t("graph.refreshing", { read: progress.read, total: progress.total, age: ageText(indexAge(snapshot.builtAt, now())) }),
      danger: false,
    };
  } else if (snapshot !== null) {
    status = {
      text: t("graph.status", { notes: noteCount(snapshot), links: linkCount(snapshot), age: ageText(indexAge(snapshot.builtAt, now())) }),
      danger: false,
    };
  }

  let body: React.ReactNode = null;
  if (snapshot === null && progress !== null) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-ink-3">
        <p>{t("graph.indexing", { name: vaultName })}</p>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentRead(progress)} className="h-1 w-56 overflow-hidden rounded bg-hairline">
          <div className="h-full bg-accent" style={{ width: `${percentRead(progress)}%` }} />
        </div>
        <p className="text-xs text-ink-4">{progressText(progress)}</p>
      </div>
    );
  } else if (snapshot !== null && snapshot.nodes.length === 0) {
    body = <p className="flex h-full items-center justify-center text-sm text-ink-4">{t("graph.empty")}</p>;
  } else if (snapshot !== null && positions !== null) {
    body = (
      // Nothing while the canvas chunk arrives: the graph appears when it can be drawn, and a
      // spinner for one local chunk is a flash of something nobody reads.
      <Suspense fallback={null}>
        <Canvas
          graph={snapshot}
          positions={positions}
          hidden={hidden}
          highlighted={highlighted}
          activeId={activeId}
          focusId={focusId}
          label={t("graph.canvas", { name: vaultName })}
          onOpen={(node) => {
            const action = graphNodeAction(node, snapshot);
            if (action?.kind === "open") onOpenPath(action.path);
            else if (action?.kind === "create") onCreateNote({ directory: action.directory, name: action.name });
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-app">
      <div className="relative flex flex-col gap-1.5 border-b border-rule px-3 py-2">
        <div role="group" aria-label={t("graph.filters")} className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-label={t("graph.refresh")}
            title={t("graph.refresh")}
            disabled={building !== null}
            onClick={graph.refresh}
            className="flex size-5 items-center justify-center rounded border border-rule bg-sunken text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            <Glyph className={building !== null ? "size-3 animate-spin" : "size-3"}>
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v5h-5" />
            </Glyph>
          </button>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-pressed={filter[chip.key]}
              onClick={() => onFilterChange({ [chip.key]: !filter[chip.key] })}
              className={
                filter[chip.key]
                  ? "rounded-full border border-obsidian bg-selected px-2.5 text-xs text-ink"
                  : "rounded-full border border-rule px-2.5 text-xs text-ink-4 hover:bg-hover"
              }
            >
              {chip.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label={t("graph.search")}
          placeholder={t("graph.searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0] !== undefined) setFocusId(matches[0]);
          }}
          className="w-full rounded border border-rule bg-panel px-2 py-1 text-sm text-ink placeholder:text-ink-4"
        />
        {progress !== null && snapshot !== null && (
          <div className="absolute inset-x-0 -bottom-px h-0.5 bg-hairline">
            <div className="h-full bg-accent" style={{ width: `${percentRead(progress)}%` }} />
          </div>
        )}
      </div>
      <div className="relative min-h-0 grow">
        {body}
        {status !== null && (
          <p className={status.danger ? "absolute bottom-2 left-3 text-xs text-danger" : "absolute bottom-2 left-3 text-xs text-ink-4"}>
            {status.text}
            {snapshot !== null && snapshot.unreadable > 0 && ` - ${t("graph.unreadable", { count: snapshot.unreadable })}`}
          </p>
        )}
      </div>
    </div>
  );
}
