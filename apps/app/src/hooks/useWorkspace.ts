import { useCallback, useEffect, useRef, useState } from "react";
import { sortNodes } from "@trypthos/domain";
import type { Revision } from "@trypthos/domain";
import type { RemoteNode, WorkspaceClient, WorkspaceInfo } from "../lib/workspaceClient";

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
  /// Directory currently listed, relative to the root. Empty string is the root itself.
  directory: string;
  nodes: RemoteNode[];
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
  enter(directory: string): Promise<void>;
  goUp(): Promise<void>;
  openFile(node: RemoteNode): Promise<void>;
  edit(content: string): void;
  save(): Promise<void>;
  dismissError(): void;
}

const INITIAL: WorkspaceState = {
  workspace: null,
  directory: "",
  nodes: [],
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

  const list = useCallback(
    async (directory: string) => {
      setState((prev) => ({ ...prev, busy: true, errorKey: null }));
      const result = await client.listDirectory(directory);
      if (!result.ok) return fail(result.reason);

      setState((prev) => ({
        ...prev,
        directory,
        nodes: sortNodes(result.nodes),
        busy: false,
      }));
    },
    [client, fail],
  );

  const open = useCallback(async () => {
    setState((prev) => ({ ...prev, busy: true, errorKey: null }));
    const result = await client.openWorkspace();
    if (!result.ok) return fail(result.reason);

    setState((prev) => ({ ...prev, workspace: result.workspace, busy: false }));
    await list("");
  }, [client, fail, list]);

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

  const actions: WorkspaceActions = {
    open,
    enter: (directory: string) => list(directory),
    goUp: () => list(parentOf(state.directory)),
    openFile,
    edit: (content: string) =>
      setState((prev) => ({ ...prev, content, dirty: prev.file !== null })),
    save,
    dismissError: () => setState((prev) => ({ ...prev, error: null })),
  };

  return { state, actions };
}
