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
  return (
    <aside
      aria-label="Workspace"
      className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50"
    >
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {workspaceName ?? "Workspace"}
        </h2>
        <button
          type="button"
          onClick={onOpenWorkspace}
          className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
        >
          Open folder
        </button>
      </div>

      {workspaceName === null ? (
        <p className="p-3 text-sm text-neutral-600">No folder open yet.</p>
      ) : (
        <div className="min-h-0 grow overflow-auto py-1">
          {directory !== "" && (
            <button
              type="button"
              onClick={onGoUp}
              className="block w-full truncate px-3 py-1 text-left text-sm text-neutral-500 hover:bg-neutral-200"
            >
              .. {directory}
            </button>
          )}

          {nodes.length === 0 && !busy && (
            <p className="px-3 py-1 text-sm text-neutral-500">This folder is empty.</p>
          )}

          {nodes.map((node) =>
            node.kind === "directory" ? (
              <button
                key={node.id}
                type="button"
                onClick={() => onEnter(node.id)}
                className="block w-full truncate px-3 py-1 text-left text-sm text-neutral-700 hover:bg-neutral-200"
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
                    ? "block w-full truncate bg-neutral-200 px-3 py-1 text-left text-sm text-neutral-900"
                    : `block w-full truncate px-3 py-1 text-left text-sm hover:bg-neutral-200 ${
                        isMarkdownFile(node.name) ? "text-neutral-700" : "text-neutral-400"
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
