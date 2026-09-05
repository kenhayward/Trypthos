import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiscardChoice } from "@trypthos/domain";
import type { DocumentSet, OpenDocument, Revision } from "@trypthos/domain";
import {
  GUIDE_PATH,
  MAX_TEXT_FILE_BYTES,
  activateDocument,
  activeDocument,
  anyDirty as anyDocumentDirty,
  closeDocument,
  dirtyPaths as dirtyDocumentPaths,
  emptyDocumentSet,
  formatBytes,
  isOpen,
  markSaved,
  openDocument,
  updateContent,
} from "@trypthos/domain";
import type { RemoteNode, WorkspaceClient, WorkspaceInfo } from "../lib/workspaceClient";
import type { FolderState } from "../lib/treeRows";

/// All the workspace state and the transitions between them.
///
/// Separated from the panel so the interface can be redesigned without touching any of this, and so
/// the awkward cases - a conflicting save, a folder that disappeared, unsaved edits, a second click
/// on a file already open - can be tested without rendering anything.
///
/// The documents themselves are a `DocumentSet` from the domain: what is open, which is on screen,
/// and which have unsaved work. What is here is everything that needs the CLIENT - reading, writing,
/// and asking the user before anything is thrown away.

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
  /// Narrows the visible files by name.
  filter: string;
  /// The folder chat maps when its Folder button is on. "" is the workspace root.
  ///
  /// A real selection rather than something derived from the open file: which document you are
  /// reading and which folder your question is about are different questions, and asking about one
  /// folder while reading a file from another is the ordinary case rather than the odd one.
  selectedFolder: string;
  /// Every open document, in the order their tabs appear.
  documents: readonly OpenDocument[];
  /// The path of the document on screen, or null when only the scratch buffer is.
  activePath: string | null;
  /// The open documents with unsaved work. What draws the dot on a tab that is not on screen.
  dirtyPaths: readonly string[];
  /// True when ANY open document has unsaved work - the window's question, not the editor's.
  anyDirty: boolean;
  /// The document on screen, or null when it is the scratch buffer. Derived from `activePath`, so
  /// there is one answer to "which file is this" rather than two that can disagree.
  file: OpenFile | null;
  content: string;
  /// True when the document on screen differs from what is on disk.
  dirty: boolean;
  /// True when the document on screen has no file behind it, and so cannot be edited or saved.
  readOnly: boolean;
  busy: boolean;
  /// Translation key for the current failure, or null. Never a sentence - see `failureKey`.
  errorKey: string | null;
  /// What that key interpolates, or null when it needs nothing. See `failureParams`.
  errorParams: Record<string, string> | null;
}

export interface WorkspaceActions {
  open(): Promise<void>;
  /// Opens a remembered folder on launch, without a dialog.
  reopen(root: string): Promise<void>;
  /// Expands a collapsed folder, or collapses an expanded one.
  toggleFolder(path: string): Promise<void>;
  /// Re-lists a folder whose listing failed.
  retryFolder(path: string): Promise<void>;
  setFilter(filter: string): void;
  /// Chooses the folder chat maps. Expanding a folder is a separate act - see `toggleFolder`.
  selectFolder(path: string): void;
  openFile(node: RemoteNode): Promise<void>;
  /// Opens a file named only by its workspace-relative path - a link in a document, rather than a
  /// row in the tree. The same act as `openFile` and the same implementation, so the error banner
  /// and the revision cannot behave differently depending on which way the file was reached.
  ///
  /// A file that is ALREADY open is switched to rather than read again: what is on disk would
  /// replace what the user has typed.
  openPath(path: string): Promise<void>;
  /// Puts an open document on screen. No reading, no prompt - the other one is still open.
  activateFile(path: string): void;
  /// Opens the built-in markdown guide in a tab, or goes to it if it is already open.
  ///
  /// The text is passed in rather than read from anywhere: the guide is part of the app, not of the
  /// workspace, and nothing here should have to know how to find it. Read-only and never written,
  /// which is what keeps it out of the save path and out of the prompt about unsaved work.
  openGuide(content: string): void;
  /// Opens what the app was handed from outside - a folder from File Explorer, or a markdown file
  /// within one. A file names both, because every path here is relative to one open folder.
  openTarget(target: { root: string; file: string | null }): Promise<void>;
  /// Closes one document, asking about its unsaved work first. Nothing else is disturbed.
  closeFile(path: string): Promise<void>;
  edit(content: string): void;
  /// True when the file is on disk as the editor shows it. False on a failed save, and on no file
  /// open at all - the caller may be about to discard the document on the strength of the answer.
  save(path?: string): Promise<boolean>;
  /// Whether EVERY open document may be thrown away, asking about each unsaved one in turn. Used by
  /// the shell before closing the window, and before another folder replaces them all.
  mayDiscard(): Promise<boolean>;
  dismissError(): void;
}

/// What the hook actually holds. The state the interface reads is derived from this on each render,
/// so a document's text, its dirty flag and the tab that shows it cannot drift apart.
interface Internal {
  workspace: WorkspaceInfo | null;
  folders: Record<string, FolderState>;
  filter: string;
  documents: DocumentSet;
  selectedFolder: string;
  /// The buffer shown when no file is open. Kept while files are open rather than discarded: it is
  /// text somebody typed, and closing the last tab brings them back to it.
  scratch: string;
  busy: boolean;
  errorKey: string | null;
  errorParams: Record<string, string> | null;
}

const INITIAL: Internal = {
  workspace: null,
  folders: {},
  filter: "",
  selectedFolder: "",
  documents: emptyDocumentSet(),
  scratch: "",
  busy: false,
  errorKey: null,
  errorParams: null,
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
    // The read boundary. Three keys rather than one, because they are three different problems and
    // two of them are the user's to fix - a file they can shrink, and a file they can re-save as
    // UTF-8 elsewhere.
    case "too-large":
      return "errors.tooLarge";
    case "not-text":
      return "errors.notText";
    case "unsupported-encoding":
      return "errors.unsupportedEncoding";
    default:
      return "errors.unknown";
  }
}

/// What a failure message interpolates, or null when it needs nothing.
///
/// Numbers, not wording, and pure like `failureKey` beside it: the sizes come from the provider,
/// and the sentence they land in lives in the catalogue. Only one refusal carries anything, and it
/// is the one where the bare key would say the least - "too large" without a size names neither the
/// file's problem nor the app's limit.
export function failureParams(failure: {
  reason: string;
  sizeBytes?: number;
  limitBytes?: number;
}): Record<string, string> | null {
  if (failure.reason !== "too-large") return null;
  return {
    size: formatBytes(failure.sizeBytes ?? 0),
    limit: formatBytes(failure.limitBytes ?? MAX_TEXT_FILE_BYTES),
  };
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

/// Asks the user what to do about unsaved work in the named document. Null outside the desktop
/// shell, where there is nowhere to save to and so nothing to protect.
export type ConfirmDiscard = ((name?: string | null) => Promise<DiscardChoice>) | null;

export function useWorkspace(
  client: WorkspaceClient,
  initialContent = "",
  confirmDiscard: ConfirmDiscard = null,
) {
  const [internal, setInternal] = useState<Internal>({ ...INITIAL, scratch: initialContent });

  /// The latest state, readable from an async callback.
  ///
  /// A save has to read the content and revision AFTER awaiting, and a stale closure would save the
  /// text as it was when the handler was created. Assigned in an effect rather than during render,
  /// because a render can be discarded or run twice.
  const stateRef = useRef(internal);
  useEffect(() => {
    stateRef.current = internal;
  }, [internal]);

  /// Records a failure, as a key and whatever that key interpolates.
  ///
  /// Takes the whole result rather than its reason, because one refusal carries numbers with it and
  /// a reason string alone would have thrown them away at the call site.
  const fail = useCallback((result: { reason: string; sizeBytes?: number; limitBytes?: number }) => {
    setInternal((prev) => ({
      ...prev,
      busy: false,
      errorKey: failureKey(result.reason),
      errorParams: failureParams(result),
    }));
  }, []);

  const loadFolder = useCallback(
    async (path: string) => {
      setInternal((prev) => ({
        ...prev,
        folders: { ...prev.folders, [path]: { status: "loading" } },
        errorKey: null,
        errorParams: null,
      }));

      const result = await client.listDirectory(path);

      setInternal((prev) => ({
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

  /// Writes one document out, named rather than assumed.
  ///
  /// A named document rather than "the one on screen", because closing a background tab has to save
  /// that tab: the two are only the same until there is more than one.
  const save = useCallback(
    async (path?: string) => {
      const target = path ?? stateRef.current.documents.activePath;
      const open = stateRef.current.documents.documents.find(
        (document) => document.path === target,
      );
      if (!open) return false;
      // A read-only document has no file to be written to. Refused HERE rather than left to the
      // path guard in the main process, which would refuse it too - as an error banner about a
      // failed save, for a document the user was never told they could save.
      if (open.readOnly) return false;

      setInternal((prev) => ({ ...prev, busy: true, errorKey: null, errorParams: null }));

      const result = await client.writeFile(open.path, open.content, open.revision);
      if (!result.ok) {
        fail(result);
        // Reported, not thrown - and reported as FALSE, because the caller may be about to throw the
        // document away on the strength of it. A conflict that read as a save is how the prompt would
        // destroy the work it exists to protect.
        return false;
      }

      // The editor keeps the user's text either way. On success the revision advances so the next save
      // compares against what was just written; on a conflict nothing here changes, which is precisely
      // what leaves their work intact for them to decide about.
      setInternal((prev) => ({
        ...prev,
        documents: markSaved(prev.documents, open.path, result.revision),
        busy: false,
      }));
      return true;
    },
    [client, fail],
  );

  /// May this one document be thrown away?
  ///
  /// One implementation for every path that would discard it - closing its tab, opening another
  /// folder, and the shell asking whether the window may close - because three prompts would be
  /// three chances to get it subtly different, and the one that was wrong would be the one that lost
  /// somebody's writing.
  ///
  /// A clean document is always discardable and asks nothing.
  const mayDiscardOne = useCallback(
    async (path: string): Promise<boolean> => {
      const open = stateRef.current.documents.documents.find(
        (document) => document.path === path,
      );
      if (!open?.dirty || confirmDiscard === null) return true;

      // Named, because several documents can be unsaved at once: "this document" would be asking
      // about work the user cannot identify.
      const choice = await confirmDiscard(open.name);
      if (choice === "cancel") return false;
      if (choice === "discard") return true;
      // Save, and only proceed if it actually landed.
      return await save(path);
    },
    [confirmDiscard, save],
  );

  /// May everything be thrown away? Asked before the window closes, and before another folder
  /// replaces the lot.
  ///
  /// One prompt per unsaved document, in tab order, and the first cancel stops the rest: a close
  /// that carried on would shut the window on documents nobody had been asked about yet.
  const mayDiscard = useCallback(async (): Promise<boolean> => {
    for (const path of dirtyDocumentPaths(stateRef.current.documents)) {
      if (!(await mayDiscardOne(path))) return false;
    }
    return true;
  }, [mayDiscardOne]);

  const open = useCallback(async () => {
    if (!(await mayDiscard())) return;

    setInternal((prev) => ({ ...prev, busy: true, errorKey: null, errorParams: null }));
    const result = await client.openWorkspace();
    if (!result.ok) return fail(result);

    setInternal((prev) => ({
      ...prev,
      workspace: result.workspace,
      folders: {},
      // Every tab belonged to the folder that was open. Carrying them across would leave paths
      // pointing at files that are not in this workspace at all - and the same goes for the folder
      // chat was mapping, which may not exist here.
      documents: emptyDocumentSet(),
      selectedFolder: "",
      busy: false,
    }));
    await loadFolder("");
  }, [client, fail, loadFolder, mayDiscard]);

  const openPath = useCallback(
    async (path: string) => {
      // Already open: go to it, and read nothing. This is what makes a second click on a file in the
      // tree a switch rather than a reload over the top of unsaved work.
      if (isOpen(stateRef.current.documents, path)) {
        setInternal((prev) => ({ ...prev, documents: activateDocument(prev.documents, path) }));
        return;
      }

      setInternal((prev) => ({ ...prev, busy: true, errorKey: null, errorParams: null }));
      const result = await client.readFile(path);
      // A link can point at a file that has been renamed, moved or deleted since it was written, and
      // that is ordinary rather than exceptional - it reports through the same banner as any other
      // failed read, which already says "not found" in the user's language.
      if (!result.ok) return fail(result);

      setInternal((prev) => ({
        ...prev,
        documents: openDocument(prev.documents, {
          path,
          content: result.content,
          revision: result.revision,
        }),
        busy: false,
      }));
    },
    [client, fail],
  );

  /// Clicking a row in the tree. The node's id IS its workspace-relative path, and its name is the
  /// last segment of that path, so there is nothing here the path does not already say.
  const openFile = useCallback(async (node: RemoteNode) => await openPath(node.id), [openPath]);

  const closeFile = useCallback(
    async (path: string) => {
      if (!(await mayDiscardOne(path))) return;
      setInternal((prev) => ({ ...prev, documents: closeDocument(prev.documents, path) }));
    },
    [mayDiscardOne],
  );

  /// A folder, and optionally a document in it, handed over from outside the app.
  ///
  /// Built from the two acts the user already has rather than a third path of its own: the folder
  /// goes through the same validation the picker's does, and the document through the same `openPath`
  /// a click in the tree uses - so the prompt about unsaved work, the error banner and the revision
  /// cannot behave differently because a file arrived from Explorer.
  const openTarget = useCallback(
    async ({ root, file }: { root: string; file: string | null }) => {
      // Already the open folder: this is another tab, and reopening the workspace around the
      // documents already in it would close every one of them for nothing.
      if (stateRef.current.workspace?.root !== root) {
        if (!(await mayDiscard())) return;

        setInternal((prev) => ({ ...prev, busy: true, errorKey: null, errorParams: null }));
        const result = await client.reopenWorkspace(root);
        if (!result.ok) return fail(result);

        setInternal((prev) => ({
          ...prev,
          workspace: result.workspace,
          folders: {},
          documents: emptyDocumentSet(),
          selectedFolder: "",
          busy: false,
        }));
        await loadFolder("");
      }

      if (file !== null) await openPath(file);
    },
    [client, fail, loadFolder, mayDiscard, openPath],
  );

  const reopen = useCallback(
    async (root: string) => {
      const result = await client.reopenWorkspace(root);
      // Silent on failure: a remembered folder that has since gone is not an error the user caused,
      // and greeting them with a warning about a path they may not remember choosing is worse than
      // simply opening with nothing.
      if (!result.ok) return;

      setInternal((prev) => ({ ...prev, workspace: result.workspace, folders: {} }));
      await loadFolder("");
    },
    [client, loadFolder],
  );

  const toggleFolder = useCallback(
    async (path: string) => {
      const current = stateRef.current.folders[path];
      if (current !== undefined && current.status !== "error") {
        setInternal((prev) => ({ ...prev, folders: withoutSubtree(prev.folders, path) }));
        return;
      }
      await loadFolder(path);
    },
    [loadFolder],
  );

  const active = activeDocument(internal.documents);

  const state: WorkspaceState = useMemo(
    () => ({
      workspace: internal.workspace,
      folders: internal.folders,
      filter: internal.filter,
      selectedFolder: internal.selectedFolder,
      documents: internal.documents.documents,
      activePath: internal.documents.activePath,
      dirtyPaths: dirtyDocumentPaths(internal.documents),
      anyDirty: anyDocumentDirty(internal.documents),
      file: active === null ? null : { path: active.path, name: active.name, revision: active.revision },
      // The scratch buffer is what "no file open" shows. It is a real buffer with real text in it,
      // never a placeholder regenerated on each render - somebody may have typed into it.
      content: active?.content ?? internal.scratch,
      dirty: active?.dirty ?? false,
      readOnly: active?.readOnly ?? false,
      busy: internal.busy,
      errorKey: internal.errorKey,
      errorParams: internal.errorParams,
    }),
    [internal, active],
  );

  const actions: WorkspaceActions = {
    open,
    reopen,
    toggleFolder,
    retryFolder: loadFolder,
    setFilter: (filter: string) => setInternal((prev) => ({ ...prev, filter })),
    selectFolder: (path: string) => setInternal((prev) => ({ ...prev, selectedFolder: path })),
    openFile,
    openPath,
    openTarget,
    activateFile: (path: string) =>
      setInternal((prev) => ({ ...prev, documents: activateDocument(prev.documents, path) })),
    openGuide: (content: string) =>
      setInternal((prev) => ({
        ...prev,
        documents: openDocument(prev.documents, {
          path: GUIDE_PATH,
          content,
          // A revision nothing will ever present: the guide is never read from disk and never
          // written back, so this exists only because every document carries one.
          revision: { id: "built-in" },
          readOnly: true,
        }),
      })),
    closeFile,
    edit: (content: string) =>
      setInternal((prev) => {
        const path = prev.documents.activePath;
        // No document on screen means the scratch buffer, which is nowhere and so never dirty.
        if (path === null) return { ...prev, scratch: content };
        return { ...prev, documents: updateContent(prev.documents, path, content) };
      }),
    save,
    mayDiscard,
    // `errorKey`, and named that everywhere. It used to write `error`, a field this state does not
    // have, so the banner's Dismiss button did nothing - and nothing caught it, because an object
    // literal with a spread in it is exempt from TypeScript's excess property check.
    dismissError: () =>
      setInternal((prev) => ({ ...prev, errorKey: null, errorParams: null })),
  };

  return { state, actions };
}
