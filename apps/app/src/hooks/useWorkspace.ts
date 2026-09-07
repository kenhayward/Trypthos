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
  isImageName,
  isOpen,
  markSaved,
  draftPath,
  openDocument,
  qualifyPath,
  renameDocument,
  splitQualified,
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
  /// Every open folder, in the order they were opened.
  ///
  /// A list rather than one, and the id on each is what every path in that folder carries on its
  /// front - which is how two files both called `notes.md` stay two files.
  workspaces: readonly WorkspaceInfo[];
  /// What is known about each folder, keyed by workspace-relative path. "" is the root.
  ///
  /// Absent means collapsed and never opened. Status is per folder rather than per panel because one
  /// folder can fail or hang while the rest are fine, and a spinner over the whole panel would hide
  /// the parts that worked.
  folders: Record<string, FolderState>;
  /// Narrows the visible files by name.
  filter: string;
  /// The folder chat maps when its Folder button is on, qualified. "" is no selection at all.
  ///
  /// A real selection rather than something derived from the open file: which document you are
  /// reading and which folder your question is about are different questions, and asking about one
  /// folder while reading a file from another is the ordinary case rather than the odd one. With
  /// several folders open it also has to say which of them, which is what qualifying it does.
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
  /// A data URL when the document on screen is looked at rather than read - an image. Null
  /// otherwise, which is nearly always.
  media: string | null;
  busy: boolean;
  /// Translation key for the current failure, or null. Never a sentence - see `failureKey`.
  errorKey: string | null;
  /// What that key interpolates, or null when it needs nothing. See `failureParams`.
  errorParams: Record<string, string> | null;
}

export interface WorkspaceActions {
  /// Adds a folder, chosen from the native dialog.
  ///
  /// ADDS rather than replaces, since 0.57.0: every open document belongs to a named folder now, so
  /// opening another one has no reason to disturb them. Opening a folder that is already open is
  /// answered with the workspace it is already open as.
  open(): Promise<void>;
  /// Opens remembered folders on launch, without a dialog. Each is opened in turn, and one that has
  /// since been deleted is skipped in silence.
  reopen(roots: readonly string[]): Promise<void>;
  /// Closes one folder, and every document that came from it.
  ///
  /// The documents go with it, asking about unsaved work one at a time and stopping at the first
  /// cancel - the same rule as Close Others. A tab whose folder is closed would be a tab that can
  /// neither be saved nor re-read, which is worse than being asked about.
  closeWorkspace(workspaceId: string): Promise<void>;
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
  /// Opens a document that has never been saved - File > New.
  ///
  /// It has a name and nowhere to be. Where it goes is answered by the save dialog the first time it
  /// is saved, not here: two dialogs asking the same question would be two answers that can
  /// disagree, and the one that decided first would be the one with the least information.
  newDocument(name: string): void;
  /// Opens what the app was handed from outside - a folder from File Explorer, or a markdown file
  /// within one. A file names both, because every path here is relative to one open folder.
  openTarget(target: { root: string; file: string | null }): Promise<void>;
  /// Closes one document, asking about its unsaved work first. Nothing else is disturbed.
  closeFile(path: string): Promise<void>;
  /// Closes several, in the order given, asking about each unsaved one in turn.
  ///
  /// **The first cancel stops the rest.** Same rule as closing the window: a "Close Others" that
  /// carried on past a cancel would shut tabs nobody had been asked about yet. What closed before
  /// the cancel stays closed - the user agreed to each of those.
  closeFiles(paths: readonly string[]): Promise<void>;
  edit(content: string): void;
  /// True when the file is on disk as the editor shows it. False on a failed save, and on no file
  /// open at all - the caller may be about to discard the document on the strength of the answer.
  save(path?: string): Promise<boolean>;
  /// Writes the document on screen somewhere the user chooses, and reports whether it landed.
  ///
  /// The choosing happens in the shell - see `saveFileAs`, which is deliberately unable to take a
  /// destination. What is decided here is what happens to the TAB afterwards, and that differs by
  /// what was being saved: a file MOVES, because the user asked for this document to live somewhere
  /// else. The scratch buffer and the built-in guide have no file to move, so they are copied out
  /// and stay where they are - which is also how either of them reaches disk at all.
  saveAs(): Promise<boolean>;
  /// Whether EVERY open document may be thrown away, asking about each unsaved one in turn. Used by
  /// the shell before closing the window, and before another folder replaces them all.
  mayDiscard(): Promise<boolean>;
  dismissError(): void;
}

/// What the hook actually holds. The state the interface reads is derived from this on each render,
/// so a document's text, its dirty flag and the tab that shows it cannot drift apart.
interface Internal {
  workspaces: readonly WorkspaceInfo[];
  folders: Record<string, FolderState>;
  filter: string;
  documents: DocumentSet;
  selectedFolder: string;
  /// The buffer shown when no file is open. Kept while files are open rather than discarded: it is
  /// text somebody typed, and closing the last tab brings them back to it.
  scratch: string;
  /// How many drafts this session has made. Only ever used to tell two of them apart: nothing stops
  /// somebody making a second "notes.md", and the tab strip tells documents apart by path.
  drafts: number;
  busy: boolean;
  errorKey: string | null;
  errorParams: Record<string, string> | null;
}

const INITIAL: Internal = {
  workspaces: [],
  folders: {},
  filter: "",
  selectedFolder: "",
  documents: emptyDocumentSet(),
  scratch: "",
  drafts: 0,
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
    // Its own key rather than "permission denied". The user picked a real folder they can write to;
    // the app is the thing declining, so it has to say which of the two it means.
    case "outside-workspace":
      return "errors.outsideWorkspace";
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

/// The absolute root of the workspace a qualified path is in, or undefined when there is none.
///
/// What the recent-files list records: a path means nothing without the folder it is relative to,
/// and with several open the folder is no longer "the workspace".
function rootOf(workspaces: readonly WorkspaceInfo[], qualified: string): string | undefined {
  const workspaceId = splitQualified(qualified)?.workspaceId;
  return workspaces.find((workspace) => workspace.id === workspaceId)?.root;
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

/// Told when a file has actually been opened, so the File menu's recent list can record it.
///
/// A report rather than a write: this hook holds no settings, and one that did would be two things.
/// It fires where a file is READ - not where one is switched to, which reads nothing, and not for a
/// chat attachment, which goes through the same client call for a different reason. A list that
/// collected those would fill with files nobody opened.
export type ReportOpened = ((file: { root: string; path: string }) => void) | null;

export function useWorkspace(
  client: WorkspaceClient,
  initialContent = "",
  confirmDiscard: ConfirmDiscard = null,
  reportOpened: ReportOpened = null,
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

  const saveAs = useCallback(async () => {
    const active = activeDocument(stateRef.current.documents);
    // The scratch buffer has never been anywhere, so the dialog is told nothing about where to
    // start. Its text is still a document worth saving - it is why Save As can be reached with
    // nothing open at all.
    const content = active?.content ?? stateRef.current.scratch;

    setInternal((prev) => ({ ...prev, busy: true, errorKey: null, errorParams: null }));
    // A DRAFT sends its name rather than its path: its path is an identity, not a place, and a
    // dialog opened at "trypthos:draft/1/notes.md" would start nowhere useful. The name is exactly
    // what the dialog wants - the workspace root, with the file already called what the user called
    // it. A read-only document has no path worth offering either.
    const openAt = active === null || active.draft ? (active?.name ?? null) : active.path;
    // WHICH folder this saves into. From the document when it is in one, and otherwise from the
    // first open folder - the scratch buffer, a draft and the built-in guide are in none, and with
    // several open something has to say. Nothing open at all means there is nowhere to save to.
    const workspaceId =
      splitQualified(active?.path ?? "")?.workspaceId ?? stateRef.current.workspaces[0]?.id;
    if (workspaceId === undefined) {
      fail({ reason: "no-workspace" });
      return false;
    }

    const result = await client.saveFileAs(workspaceId, openAt, content);

    if (!result.ok) {
      // Cancelling is not a failure and raises nothing - `failureKey` answers null for it - but the
      // busy flag still has to come down, which is what routing it through `fail` does.
      fail(result);
      return false;
    }

    setInternal((prev) => {
      const moved = active === null || active.readOnly ? null : active.path;
      return {
        ...prev,
        documents:
          moved === null
            ? // A copy: there was no file to move. Both the scratch buffer and the guide stay
              // exactly where they are, and the copy opens as an ordinary editable document.
              openDocument(prev.documents, { path: result.path, content, revision: result.revision })
            : renameDocument(prev.documents, moved, result.path, result.revision),
        busy: false,
      };
    });

    // Save As leaves the user editing a file they have never opened. Leaving it off the list would
    // put the original there and not the one they are actually working in.
    const root = rootOf(stateRef.current.workspaces, result.path);
    const relative = splitQualified(result.path)?.path;
    if (root !== undefined && relative !== undefined) reportOpened?.({ root, path: relative });
    return true;
  }, [client, fail, reportOpened]);

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
      // A draft has no path to write to, so saving one asks where it should go. Routed here rather
      // than at each call site, so Ctrl+S, the menu and closing a tab all reach the same question.
      if (open.draft) return await saveAs();

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
    [client, fail, saveAs],
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

  /// Puts a workspace on the list and lists its root. Shared by the dialog and by reopening.
  ///
  /// Nothing is discarded. Every path names the folder it is in, so a second folder cannot make the
  /// documents from the first ambiguous - which is the whole reason opening one is additive now.
  const addWorkspace = useCallback(
    async (workspace: WorkspaceInfo) => {
      setInternal((prev) => ({
        ...prev,
        workspaces: prev.workspaces.some((open) => open.id === workspace.id)
          ? prev.workspaces
          : [...prev.workspaces, workspace],
        busy: false,
      }));
      await loadFolder(workspace.id);
    },
    [loadFolder],
  );

  const open = useCallback(async () => {
    setInternal((prev) => ({ ...prev, busy: true, errorKey: null, errorParams: null }));
    const result = await client.openWorkspace();
    if (!result.ok) return fail(result);

    await addWorkspace(result.workspace);
  }, [addWorkspace, client, fail]);

  const closeWorkspace = useCallback(
    async (workspaceId: string) => {
      // Its documents first, one at a time, and the first cancel stops the whole close: a folder
      // that went while somebody was still deciding about a file in it would take the answer away
      // along with the question.
      const inside = stateRef.current.documents.documents
        .filter((document) => splitQualified(document.path)?.workspaceId === workspaceId)
        .map((document) => document.path);

      for (const path of inside) {
        if (!(await mayDiscardOne(path))) return;
        setInternal((prev) => ({ ...prev, documents: closeDocument(prev.documents, path) }));
      }

      await client.closeWorkspace(workspaceId);

      setInternal((prev) => ({
        ...prev,
        workspaces: prev.workspaces.filter((workspace) => workspace.id !== workspaceId),
        // Its rows go with it, and so does the selection if it pointed inside. A folder chat was
        // mapping in a workspace that is gone is a question about nothing.
        folders: withoutSubtree(prev.folders, workspaceId),
        selectedFolder:
          splitQualified(prev.selectedFolder)?.workspaceId === workspaceId
            ? ""
            : prev.selectedFolder,
      }));
    },
    [client, mayDiscardOne],
  );

  const openPath = useCallback(
    async (path: string) => {
      // Already open: go to it, and read nothing. This is what makes a second click on a file in the
      // tree a switch rather than a reload over the top of unsaved work.
      if (isOpen(stateRef.current.documents, path)) {
        setInternal((prev) => ({ ...prev, documents: activateDocument(prev.documents, path) }));
        return;
      }

      setInternal((prev) => ({ ...prev, busy: true, errorKey: null, errorParams: null }));

      // An image goes down a different channel, because `readFile` decodes and would refuse it -
      // which is right for a document and wrong for a picture. Decided from the NAME rather than
      // from the settings: whether the type is turned on is already answered by the tree that
      // offered the file and by `linkAction` for a link, and this only needs to know which of two
      // reads to make.
      if (isImageName(path)) {
        const image = await client.readImage(path);
        if (!image.ok) return fail(image);

        setInternal((prev) => ({
          ...prev,
          documents: openDocument(prev.documents, {
            path,
            // Nothing in it, deliberately: `content` is what chat sends and what the editor holds.
            content: "",
            revision: { id: "image" },
            readOnly: true,
            media: image.dataUrl,
          }),
          busy: false,
        }));

        const imageRoot = rootOf(stateRef.current.workspaces, path);
        const imageRelative = splitQualified(path)?.path;
        if (imageRoot !== undefined && imageRelative !== undefined) {
          reportOpened?.({ root: imageRoot, path: imageRelative });
        }
        return;
      }

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

      // After the read, so a file that could not be opened is not remembered as one that was. The
      // root comes from the path itself now: it names its workspace, and this is the side that knows
      // which absolute folder that workspace is.
      const root = rootOf(stateRef.current.workspaces, path);
      const relative = splitQualified(path)?.path;
      if (root !== undefined && relative !== undefined) reportOpened?.({ root, path: relative });
    },
    [client, fail, reportOpened],
  );

  /// Clicking a row in the tree. The node's id IS its workspace-relative path, and its name is the
  /// last segment of that path, so there is nothing here the path does not already say.
  const openFile = useCallback(async (node: RemoteNode) => await openPath(node.id), [openPath]);

  const closeFiles = useCallback(
    async (paths: readonly string[]) => {
      // One at a time, and in the order given. Asking about them all first and closing afterwards
      // would leave the user answering three prompts before seeing any of them take effect.
      for (const path of paths) {
        if (!(await mayDiscardOne(path))) return;
        setInternal((prev) => ({ ...prev, documents: closeDocument(prev.documents, path) }));
      }
    },
    [mayDiscardOne],
  );

  /// Closing one tab is closing a list of one. Written that way rather than beside it, so the prompt
  /// and the order cannot behave differently depending on how the close was reached.
  const closeFile = useCallback(async (path: string) => await closeFiles([path]), [closeFiles]);

  /// A folder, and optionally a document in it, handed over from outside the app.
  ///
  /// Built from the two acts the user already has rather than a third path of its own: the folder
  /// goes through the same validation the picker's does, and the document through the same `openPath`
  /// a click in the tree uses - so the prompt about unsaved work, the error banner and the revision
  /// cannot behave differently because a file arrived from Explorer.
  const openTarget = useCallback(
    async ({ root, file }: { root: string; file: string | null }) => {
      // Already open: this is another tab in a folder that is already on screen, and nothing about
      // the workspace needs disturbing.
      let workspace = stateRef.current.workspaces.find((open) => open.root === root) ?? null;

      if (workspace === null) {
        setInternal((prev) => ({ ...prev, busy: true, errorKey: null, errorParams: null }));
        const result = await client.reopenWorkspace(root);
        if (!result.ok) return fail(result);

        workspace = result.workspace;
        await addWorkspace(workspace);
      }

      // The file arrives relative to the root it was named with - from File Explorer, or from a
      // model opening something in the folder it was given - so it is qualified here, where the
      // workspace that root belongs to has just been established.
      if (file !== null) await openPath(qualifyPath(workspace.id, file));
    },
    [addWorkspace, client, fail, openPath],
  );

  const reopen = useCallback(
    async (roots: readonly string[]) => {
      // In turn rather than at once, so the order on screen is the order they were opened in - and
      // so one folder that has since gone cannot take the rest with it.
      for (const root of roots) {
        const result = await client.reopenWorkspace(root);
        // Silent on failure: a remembered folder that has since gone is not an error the user
        // caused, and greeting them with a warning about a path they may not remember choosing is
        // worse than simply opening without it.
        if (result.ok) await addWorkspace(result.workspace);
      }
    },
    [addWorkspace, client],
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
      workspaces: internal.workspaces,
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
      media: active?.media ?? null,
      busy: internal.busy,
      errorKey: internal.errorKey,
      errorParams: internal.errorParams,
    }),
    [internal, active],
  );

  const actions: WorkspaceActions = {
    open,
    closeWorkspace,
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
    newDocument: (name: string) =>
      setInternal((prev) => {
        const serial = prev.drafts + 1;
        return {
          ...prev,
          drafts: serial,
          documents: openDocument(prev.documents, {
            path: draftPath(serial, name),
            content: "",
            // A revision nothing will ever present: a draft is never read from disk, and the first
            // write it makes is a Save As, which creates the file rather than replacing one.
            revision: { id: "unsaved" },
            draft: true,
          }),
        };
      }),
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
    closeFiles,
    edit: (content: string) =>
      setInternal((prev) => {
        const path = prev.documents.activePath;
        // No document on screen means the scratch buffer, which is nowhere and so never dirty.
        if (path === null) return { ...prev, scratch: content };
        return { ...prev, documents: updateContent(prev.documents, path, content) };
      }),
    save,
    saveAs,
    mayDiscard,
    // `errorKey`, and named that everywhere. It used to write `error`, a field this state does not
    // have, so the banner's Dismiss button did nothing - and nothing caught it, because an object
    // literal with a spread in it is exempt from TypeScript's excess property check.
    dismissError: () =>
      setInternal((prev) => ({ ...prev, errorKey: null, errorParams: null })),
  };

  return { state, actions };
}
