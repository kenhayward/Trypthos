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
  error: string | null;
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
  error: null,
};

/// Human wording for a failure reason.
///
/// An error a user reads should say what happened and what to do, never name an errno. "conflict" is
/// the one that matters most: it is not a failure of theirs, and the wording has to make clear their
/// work is still in the editor.
export function describeFailure(reason: string): string {
  switch (reason) {
    case "not-desktop":
      return "Opening folders needs the desktop app. This is the browser preview.";
    case "no-workspace":
      return "No folder is open yet.";
    case "not-found":
      return "That file is no longer there. It may have been moved or deleted.";
    case "permission-denied":
      return "Trypthos is not allowed to open that.";
    case "conflict":
      return "This file changed on disk since you opened it. Your edits are still here - save to a new name, or reopen the file to discard them.";
    case "cancelled":
      return "";
    default:
      return "Something went wrong.";
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
    const message = describeFailure(reason);
    setState((prev) => ({ ...prev, busy: false, error: message === "" ? null : message }));
  }, []);

  const list = useCallback(
    async (directory: string) => {
      setState((prev) => ({ ...prev, busy: true, error: null }));
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
    setState((prev) => ({ ...prev, busy: true, error: null }));
    const result = await client.openWorkspace();
    if (!result.ok) return fail(result.reason);

    setState((prev) => ({ ...prev, workspace: result.workspace, busy: false }));
    await list("");
  }, [client, fail, list]);

  const openFile = useCallback(
    async (node: RemoteNode) => {
      setState((prev) => ({ ...prev, busy: true, error: null }));
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

    setState((prev) => ({ ...prev, busy: true, error: null }));

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
