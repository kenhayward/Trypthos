interface Props {
  workspaceName: string | null;
}

/// Left panel: the folder browser.
///
/// Placeholder. Local and cloud backends both arrive through the StorageProvider interface in
/// @trypthos/domain, and both render into this one tree - with loading and error states on the node,
/// never a spinner over the whole panel.
export default function WorkspacePanel({ workspaceName }: Props) {
  return (
    <aside
      aria-label="Workspace"
      className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50"
    >
      <h2 className="border-b border-neutral-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Workspace
      </h2>
      <div className="p-3 text-sm text-neutral-600">
        {workspaceName ? workspaceName : "No folder open yet."}
      </div>
    </aside>
  );
}
