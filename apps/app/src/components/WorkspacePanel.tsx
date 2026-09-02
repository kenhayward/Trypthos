import { useTranslation } from "react-i18next";
import { isMarkdownFile } from "@trypthos/domain";
import type { RemoteNode } from "../lib/workspaceClient";

interface Props {
  workspaceName: string | null;
  directory: string;
  nodes: RemoteNode[];
  openFilePath: string | null;
  busy: boolean;
  onOpenWorkspace: () => void;
  onEnter: (directory: string) => void;
  onGoUp: () => void;
  onOpenFile: (node: RemoteNode) => void;
}

/// Left panel: the folder browser.
///
/// Presentational. Every decision - what is listed, what happens on a click, what an error says -
/// lives in useWorkspace, so this can be redesigned freely without touching behaviour.
///
/// Flat navigation with a breadcrumb rather than an expanding tree, for now. A tree is nicer and is
/// worth adding; a flat list is what makes the backend usable in the meantime.
export default function WorkspacePanel({
  workspaceName,
  directory,
  nodes,
  openFilePath,
  busy,
  onOpenWorkspace,
  onEnter,
  onGoUp,
  onOpenFile,
}: Props) {
  const { t } = useTranslation();

  return (
    <aside
      aria-label={t("workspace.title")}
      className="flex w-64 shrink-0 flex-col border-r border-rule bg-panel"
    >
      <div className="flex items-center justify-between border-b border-rule px-3 py-2">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-ink-4">
          {workspaceName ?? t("workspace.title")}
        </h2>
        <button
          type="button"
          onClick={onOpenWorkspace}
          className="rounded px-1.5 py-0.5 text-xs text-ink-4 hover:bg-hover hover:text-ink"
        >
          {t("workspace.openFolder")}
        </button>
      </div>

      {workspaceName === null ? (
        <p className="p-3 text-sm text-ink-3">{t("workspace.noFolder")}</p>
      ) : (
        <div className="min-h-0 grow overflow-auto py-1">
          {directory !== "" && (
            <button
              type="button"
              onClick={onGoUp}
              className="block w-full truncate px-3 py-1 text-left text-sm text-ink-4 hover:bg-hover"
            >
              {t("workspace.goUp", { directory })}
            </button>
          )}

          {nodes.length === 0 && !busy && (
            <p className="px-3 py-1 text-sm text-ink-4">{t("workspace.emptyFolder")}</p>
          )}

          {nodes.map((node) =>
            node.kind === "directory" ? (
              <button
                key={node.id}
                type="button"
                onClick={() => onEnter(node.id)}
                className="block w-full truncate px-3 py-1 text-left text-sm text-ink-3 hover:bg-hover"
              >
                {node.name}/
              </button>
            ) : (
              <button
                key={node.id}
                type="button"
                onClick={() => onOpenFile(node)}
                aria-current={node.id === openFilePath ? "true" : undefined}
                className={
                  node.id === openFilePath
                    ? "block w-full truncate bg-hover px-3 py-1 text-left text-sm text-ink"
                    : `block w-full truncate px-3 py-1 text-left text-sm hover:bg-hover ${
                        isMarkdownFile(node.name) ? "text-ink-3" : "text-faint"
                      }`
                }
              >
                {node.name}
              </button>
            ),
          )}
        </div>
      )}
    </aside>
  );
}
