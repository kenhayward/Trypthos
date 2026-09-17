import { Suspense, lazy } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useVaultGraph } from "../hooks/useVaultGraph";
import type { GraphFilter } from "../lib/graphFilters";
import { percentRead } from "../lib/graphStatus";
import type { GraphClient } from "../lib/workspaceClient";
import Glyph from "./Glyph";
import type { LocalGraphProps } from "./LocalGraph";

/// The local graph pane under the workspace trees. Eager and small: the header, its controls and the
/// messages. The canvas underneath is `LocalGraph`, loaded only when there is something to draw.

const LazyLocalGraph = lazy(() => import("./LocalGraph"));

export interface LocalGraphPaneProps {
  client: GraphClient;
  workspaceId: string | null;
  activePath: string | null;
  filter: GraphFilter;
  depth: number;
  collapsed: boolean;
  onDepthChange(depth: number): void;
  onCollapsedChange(collapsed: boolean): void;
  onOpenPath(path: string): void;
  onCreateNote(request: { directory: string; name: string }): void;
  Body?: ComponentType<LocalGraphProps>;
}

export default function LocalGraphPane({
  client,
  workspaceId,
  activePath,
  filter,
  depth,
  collapsed,
  onDepthChange,
  onCollapsedChange,
  onOpenPath,
  onCreateNote,
  Body = LazyLocalGraph,
}: LocalGraphPaneProps) {
  const { t } = useTranslation();
  const { snapshot, progress } = useVaultGraph(client, workspaceId);
  const centre = activePath !== null && snapshot?.nodes.some((node) => node.id === activePath) ? activePath : null;

  let body: React.ReactNode;
  if (workspaceId !== null && snapshot === null && progress !== null) {
    body = <p className="p-3 text-xs text-ink-4">{t("graph.localIndexing", { percent: percentRead(progress) })}</p>;
  } else if (snapshot === null || centre === null) {
    body = <p className="p-3 text-xs text-ink-4">{t("graph.localEmpty")}</p>;
  } else {
    body = (
      <Suspense fallback={null}>
        <Body snapshot={snapshot} centre={centre} depth={depth} filter={filter} onOpenPath={onOpenPath} onCreateNote={onCreateNote} />
      </Suspense>
    );
  }

  const toggleLabel = collapsed ? t("graph.expand") : t("graph.collapse");
  return (
    <section aria-label={t("graph.localTitle")} className="flex shrink-0 flex-col border-t border-rule">
      <div className="relative flex items-center gap-1 px-3 py-1">
        <h2 className="grow text-xs font-semibold text-ink-3">{t("graph.localTitle")}</h2>
        <select
          aria-label={t("graph.depth")}
          value={depth}
          onChange={(event) => onDepthChange(Number(event.target.value))}
          className="rounded border border-rule bg-panel px-1 text-xs text-ink-3"
        >
          {[1, 2, 3].map((value) => (
            <option key={value} value={value}>
              {t("graph.depthValue", { count: value })}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
          className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
        >
          <Glyph className={collapsed ? "size-3.5 -rotate-90" : "size-3.5"}>
            <path d="M6 9l6 6 6-6" />
          </Glyph>
        </button>
        {progress !== null && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentRead(progress)}
            className="absolute inset-x-0 bottom-0 h-0.5 bg-hairline"
          >
            <div className="h-full bg-accent" style={{ width: `${percentRead(progress)}%` }} />
          </div>
        )}
      </div>
      {!collapsed && <div className="relative h-48">{body}</div>}
    </section>
  );
}
