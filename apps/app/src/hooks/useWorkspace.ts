import { useCallback, useEffect, useRef, useState } from "react";
import type { Revision } from "@trypthos/domain";
import type { RemoteNode, WorkspaceClient, WorkspaceInfo } from "../lib/workspaceClient";
import type { FolderState } from "../lib/treeRows";

/// All the workspace state and the transitions between them.
///
/// Separated from the panel so the interface can be redesigned without touching any of this, and so
/// the awkward cases - a conflicting save, a folder that disappeared, unsaved edits - can be tested
/// without rendering anything.

export interface OpenFile {
  path: string;
  name: string;
  /// The revision as of the last successful read or write. This is what a save presents, and what
  /// makes a conflict detectable rather than a silent overwrite.
  revision: Revision;
}

export interface WorkspaceState {
  workspace: WorkspaceInfo | null;
  /// What is known about each folder, keyed by workspace-relative path. "" is the root.
  ///
  /// Absent means collapsed and never opened. Status is per folder rather than per panel because one
  /// folder can fail or hang while the rest are fine, and a spinner over the whole panel would hide
  /// the parts that worked.
  folders: Record<string, FolderState>;
  /// Narrows the visible markdown files by name.
  filter: string;
  file: OpenFile | null;
  content: string;
  /// True when `content` differs from what is on disk.
  dirty: boolean;
  busy: boolean;
  /// Translation key for the current failure, or null. Never a sentence - see `failureKey`.
  errorKey: string | null;
}

export interface WorkspaceActions {
  open(): Promise<void>;
  /// Expands a collapsed folder, or collapses an expanded one.
  toggleFolder(path: string): Promise<void>;
  /// Re-lists a folder whose listing failed.
  retryFolder(path: string): Promise<void>;
  setFilter(filter: string): void;
  openFile(node: RemoteNode): Promise<void>;
  edit(content: string): void;
  save(): Promise<void>;
  dismissError(): void;
}

const INITIAL: WorkspaceState = {
  workspace: null,
  folders: {},
  filter: "",
  file: null,
  content: "",
  dirty: false,
  busy: false,
  errorKey: null,
};

/// The translation key for a failure reason, or null when there is nothing to say.
///
/// A key rather than a sentence, so this module stays free of both wording and of i18next - it is
/// exercised without rendering anything. The component translates at the edge, where it already has
/// `t`.
///
/// Cancelling a folder picker returns null: it is not a failure and must not raise anything.
export function failureKey(reason: string): string | null {
  switch (reason) {
    case "cancelled":
      return null;
    case "not-desktop":
      return "errors.notDesktop";
    case "no-workspace":
      return "errors.noWorkspace";
    case "not-found":
      return "errors.notFound";
    case "permission-denied":
      return "errors.permissionDenied";
    case "conflict":
      return "errors.conflict";
    default:
      return "errors.unknown";
  }
}

/// The parent of a workspace-relative directory path. "" is the root and has no parent.
export function parentOf(directory: string): string {
  const cut = directory.lastIndexOf("/");
  return cut === -1 ? "" : directory.slice(0, cut);
}

/// Removes a folder and everything beneath it from the map.
///
/// Collapsing has to forget descendants, not just the folder itself. Keeping them would mean
/// re-expanding shows a tree as it was however long ago, with files that have since been deleted.
export function withoutSubtree(
  folders: Record<string, FolderState>,
  path: string,
): Record<string, FolderState> {
  const prefix = `${path}/`;
  return Object.fromEntries(
    Object.entries(folders).filter(([key]) => key !== path && !key.startsWith(prefix)),
  );
}

export function useWorkspace(client: WorkspaceClient, initialContent = "") {
  const [state, setState] = useState<WorkspaceState>({ ...INITIAL, content: initialContent });

  /// The latest state, readable from an async callback.
  ///
  /// A save has to read the content and revision AFTER awaiting, and a stale closure would save the
  /// text as it was when the handler was created. Assigned in an effect rather than during render,
  /// because a render can be discarded or run twice.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const fail = useCallback((reason: string) => {
    setState((prev) => ({ ...prev, busy: false, errorKey: failureKey(reason) }));
  }, []);

  const loadFolder = useCallback(
    async (path: string) => {
      setState((prev) => ({
        ...prev,
        folders: { ...prev.folders, [path]: { status: "loading" } },
        errorKey: null,
      }));

      const result = await client.listDirectory(path);

      setState((prev) => ({
        ...prev,
        folders: {
          ...prev.folders,
          [path]: result.ok
            ? { status: "loaded", children: result.nodes }
            : // The failure is recorded on the FOLDER, not raised as a banner. An unreadable folder
              // is a fact about that row, and the rest of the tree is still usable.
              { status: "error" },
        },
      }));
    },
    [client],
  );

  const open = useCallback(async () => {
    setState((prev) => ({ ...prev, busy: true, errorKey: null }));
    const result = await client.openWorkspace();
    if (!result.ok) return fail(result.reason);

    setState((prev) => ({ ...prev, workspace: result.workspace, folders: {}, busy: false }));
    await loadFolder("");
  }, [client, fail, loadFolder]);

  const openFile = useCallback(
    async (node: RemoteNode) => {
      setState((prev) => ({ ...prev, busy: true, errorKey: null }));
      const result = await client.readFile(node.id);
      if (!result.ok) return fail(result.reason);

      setState((prev) => ({
        ...prev,
        file: { path: node.id, name: node.name, revision: result.revision },
        content: result.content,
        dirty: false,
        busy: false,
      }));
    },
    [client, fail],
  );

  const save = useCallback(async () => {
    const open = stateRef.current.file;
    if (!open) return;

    setState((prev) => ({ ...prev, busy: true, errorKey: null }));

    const result = await client.writeFile(open.path, stateRef.current.content, open.revision);
    if (!result.ok) return fail(result.reason);

    // The editor keeps the user's text either way. On success the revision advances so the next save
    // compares against what was just written; on a conflict nothing here changes, which is precisely
    // what leaves their work intact for them to decide about.
    setState((prev) => ({
      ...prev,
      file: prev.file ? { ...prev.file, revision: result.revision } : null,
      dirty: false,
      busy: false,
    }));
  }, [client, fail]);

  const toggleFolder = useCallback(
    async (path: string) => {
      const current = stateRef.current.folders[path];
      if (current !== undefined && current.status !== "error") {
        setState((prev) => ({ ...prev, folders: withoutSubtree(prev.folders, path) }));
        return;
      }
      await loadFolder(path);
    },
    [loadFolder],
  );

  const actions: WorkspaceActions = {
    open,
    toggleFolder,
    retryFolder: loadFolder,
    setFilter: (filter: string) => setState((prev) => ({ ...prev, filter })),
    openFile,
    edit: (content: string) =>
      setState((prev) => ({ ...prev, content, dirty: prev.file !== null })),
    save,
    dismissError: () => setState((prev) => ({ ...prev, error: null })),
  };

  return { state, actions };
}
