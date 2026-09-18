import { Suspense, lazy, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useAgeText } from "../hooks/useAgeText";
import { useGraphLayout } from "../hooks/useGraphLayout";
import type { VaultGraphView } from "../hooks/useVaultGraph";
import { graphNodeAction } from "../lib/graphActions";
import { hiddenNodes, searchMatches } from "../lib/graphFilters";
import type { GraphFilter } from "../lib/graphFilters";
import type { LayoutRunner } from "../lib/graphLayoutTypes";
import { indexAge, linkCount, noteCount, percentRead } from "../lib/graphStatus";
import { useLayoutRunner } from "../lib/layoutClient";
import CanvasBoundary from "./CanvasBoundary";
import type { GraphCanvasProps, GraphFocus } from "./GraphCanvas";
import Glyph from "./Glyph";

/// A workspace's graph, drawn as the Graph section of its home page. Lazy only - see
/// `graphBundle.test.ts`.

/// The canvas, fetched when the tab first draws a graph.
///
/// `lazy` rather than a static import, although `graphBundle.test.ts` would allow one here: sigma
/// reads `WebGL2RenderingContext` as its module body runs, and jsdom has no such global, so a static
/// import would make this whole file unloadable in the jsdom suite - every test below would fail on
/// importing a canvas that no test here even draws. It is also what `GraphCanvas`'s own doc asks
/// for. The cost is one more chunk on a tab that is itself already lazy.
const GraphCanvas = lazy(() => import("./GraphCanvas"));

export interface GraphPageProps {
  /// What the canvas is labelled with - any folder's name, not only a vault's.
  workspaceName: string;
  /// The index's answer for this workspace. Passed in rather than subscribed to here: the home page
  /// that holds this already subscribes, to decide whether a Graph section exists at all, and two
  /// subscriptions to one workspace were two fetches and two listeners for one answer.
  graph: VaultGraphView;
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


export default function GraphPage({
  workspaceName,
  graph,
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
  const run = useLayoutRunner(layout);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<GraphFocus | null>(null);

  const { snapshot, building, progress, error } = graph;
  const input = useMemo(() => (snapshot === null ? null : { nodes: snapshot.nodes, edges: snapshot.edges }), [snapshot]);
  const positions = useGraphLayout(input, run ?? never);
  const hidden = useMemo(() => (snapshot === null ? new Set<string>() : hiddenNodes(snapshot, filter)), [snapshot, filter]);
  /// Matches the user can actually see. A hidden node is not a search result: highlighting one dims
  /// every visible node around something nobody can point at, and centring on one moves the camera
  /// to empty space.
  const matches = useMemo(
    () => (snapshot === null ? [] : searchMatches(snapshot, query).filter((id) => !hidden.has(id))),
    [snapshot, query, hidden],
  );
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
        <p>{t("graph.indexing", { name: workspaceName })}</p>
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
      // The boundary is outside the Suspense, so it catches the chunk that would not arrive as well
      // as anything the canvas throws while rendering. Nothing while the chunk is on its way: the
      // graph appears when it can be drawn, and a spinner for one local chunk is a flash of
      // something nobody reads.
      <CanvasBoundary message={t("graph.drawFailed")}>
        <Suspense fallback={null}>
          <Canvas
            graph={snapshot}
            positions={positions}
            hidden={hidden}
            highlighted={highlighted}
            activeId={activeId}
            focus={focus}
            label={t("graph.canvas", { name: workspaceName })}
            onOpen={(node) => {
              const action = graphNodeAction(node, snapshot);
              if (action?.kind === "open") onOpenPath(action.path);
              else if (action?.kind === "create") onCreateNote({ directory: action.directory, name: action.name });
            }}
          />
        </Suspense>
      </CanvasBoundary>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-app">
      <div className="relative flex flex-col gap-1.5 border-b border-rule px-3 py-2">
        {/* Refresh sits beside the chips, not among them: it rebuilds the index and changes nothing
            about what is shown, so inside the group a screen reader announces it as a filter. */}
        <div className="flex flex-wrap items-center gap-1.5">
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
          <div role="group" aria-label={t("graph.filters")} className="flex flex-wrap items-center gap-1.5">
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
        </div>
        <input
          type="search"
          aria-label={t("graph.search")}
          placeholder={t("graph.searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            const best = matches[0];
            // A fresh request each time, so pressing Enter again on the same match centres again
            // rather than being swallowed as a write of the value already there.
            if (event.key === "Enter" && best !== undefined) setFocus((asked) => ({ id: best, nonce: (asked?.nonce ?? 0) + 1 }));
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
