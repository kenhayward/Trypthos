import type { Revision } from "./provider";

/// The set of documents open in the editor at once, and every rule about how a tab strip behaves.
///
/// Pure and separate from the hook that holds it, because these are the rules that are easy to get
/// subtly wrong and impossible to see when they are: which tab is selected after a close, whether a
/// second click on an open file re-reads it over the user's unsaved work, whether editing one
/// document marks another dirty. All of it is expressible over data, so none of it needs a rendered
/// editor to test.
///
/// Every function returns a NEW set. Nothing mutates, so a stale reference is always a snapshot of a
/// past state rather than a half-applied change.

export interface OpenDocument {
  /// Workspace-relative path. This is the tab's identity: one document per path, and a path is what
  /// the tree, a markdown link and a saved chat all name a file by.
  readonly path: string;
  /// The last segment of the path. What the tab shows, unless another tab shares it.
  readonly name: string;
  /// The revision as of the last successful read or write of THIS document. Per document, not per
  /// window: two open files change on disk independently, and so do their conflicts.
  readonly revision: Revision;
  readonly content: string;
  /// True when `content` differs from what was last read or written.
  readonly dirty: boolean;
  /// True for a document with no file behind it - the built-in markdown guide.
  ///
  /// One flag for the whole of what that means: it is never written anywhere, and so it must never
  /// become dirty. `updateContent` enforces the second half, because a read-only document that
  /// could go dirty would make the app ask about saving work it has nowhere to put.
  readonly readOnly: boolean;
}

export interface DocumentSet {
  readonly documents: readonly OpenDocument[];
  /// The path of the document on screen, or null when nothing is open.
  readonly activePath: string | null;
}

/// What opening a file supplies: what was read, and where it was read from.
export interface DocumentSource {
  readonly path: string;
  readonly content: string;
  readonly revision: Revision;
  /// Opens a document that is not a file. Defaults to false, so every ordinary read is unchanged.
  readonly readOnly?: boolean;
}

/// The path of the built-in markdown guide.
///
/// Not a workspace path, and it cannot be mistaken for one: every path in a workspace is relative
/// and forward-slashed, so nothing on disk collides with this and this shadows nothing on disk. It
/// is a document identity like any other - it names a tab, and it is what `readOnly` hangs on - but
/// no read or write is ever attempted against it.
export const GUIDE_PATH = "trypthos:markdown-guide";

export function emptyDocumentSet(): DocumentSet {
  return { documents: [], activePath: null };
}

/// The display name of a workspace-relative path: its last segment.
export function documentName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

export function openPaths(set: DocumentSet): readonly string[] {
  return set.documents.map((document) => document.path);
}

export function isOpen(set: DocumentSet, path: string): boolean {
  return set.documents.some((document) => document.path === path);
}

export function activeDocument(set: DocumentSet): OpenDocument | null {
  return set.documents.find((document) => document.path === set.activePath) ?? null;
}

export function dirtyPaths(set: DocumentSet): readonly string[] {
  return set.documents.filter((document) => document.dirty).map((document) => document.path);
}

export function anyDirty(set: DocumentSet): boolean {
  return set.documents.some((document) => document.dirty);
}

/// Opens a document, or selects it if it is already open.
///
/// The already-open case keeps the existing buffer untouched and only moves the selection. That is
/// the whole point of a tab: clicking a file you are already editing must not replace what you have
/// typed with what is on disk. The caller having just read the file does not change that - it is why
/// callers should check `isOpen` before reading at all.
export function openDocument(set: DocumentSet, source: DocumentSource): DocumentSet {
  if (isOpen(set, source.path)) return activateDocument(set, source.path);

  const document: OpenDocument = {
    path: source.path,
    name: documentName(source.path),
    revision: source.revision,
    content: source.content,
    dirty: false,
    readOnly: source.readOnly ?? false,
  };
  // Appended, never inserted beside the active tab. One rule the user can predict: new files arrive
  // at the end, and the order is the order they were opened in.
  return { documents: [...set.documents, document], activePath: source.path };
}

export function activateDocument(set: DocumentSet, path: string): DocumentSet {
  if (!isOpen(set, path) || set.activePath === path) return set;
  return { ...set, activePath: path };
}

/// Closes a tab. Unconditional and pure - asking about unsaved work happens where the user is.
///
/// Closing the ACTIVE tab moves to its right-hand neighbour, or to the left when there is nothing to
/// the right. Closing any other tab leaves the selection where it is: a close is not a request to go
/// somewhere else.
export function closeDocument(set: DocumentSet, path: string): DocumentSet {
  const index = set.documents.findIndex((document) => document.path === path);
  if (index === -1) return set;

  const documents = set.documents.filter((document) => document.path !== path);
  // `documents`, not `...set`. Spreading the original set here put the ORIGINAL list back, so every
  // close of a tab that was not the one on screen quietly did nothing - and the test beside this
  // asserted only the selection, which was correct all along.
  if (set.activePath !== path) return { ...set, documents };

  const next = documents[index] ?? documents[index - 1] ?? null;
  return { documents, activePath: next?.path ?? null };
}

/// Moves one document to another path - what Save As does to the tab it was invoked from.
///
/// A rename rather than a second tab. The user asked for this document to live somewhere else, and
/// two tabs would be two views of text that is now in two files, with no way to tell which one is
/// being typed into. The document keeps its place in the strip and its text; only where it lives,
/// what it is called and which revision it is measured against change - and it is clean, because the
/// write that prompted this is what put it on disk.
///
/// **A read-only document is refused.** It has no file behind it, so there is nothing to move -
/// Save As on the built-in guide is a copy, which is the caller's business rather than this one's.
export function renameDocument(
  set: DocumentSet,
  from: string,
  to: string,
  revision: Revision,
): DocumentSet {
  const document = set.documents.find((open) => open.path === from);
  if (document === undefined || document.readOnly) return set;

  const moved: OpenDocument = {
    ...document,
    path: to,
    name: documentName(to),
    revision,
    dirty: false,
  };

  // Saving over a file that is also open leaves two tabs naming one file, each with its own idea of
  // what is in it. The stale one goes: what was just written is what is on disk.
  const documents = set.documents
    .filter((open) => open.path === from || open.path !== to)
    .map((open) => (open.path === from ? moved : open));

  return { documents, activePath: set.activePath === from ? to : set.activePath };
}

/// Records an edit to one document. Dirty is measured against the text, not set by the act of
/// typing: retyping a character back to what it was leaves the file unmodified, and an indicator
/// that says otherwise is telling the user something untrue about their file.
export function updateContent(set: DocumentSet, path: string, content: string): DocumentSet {
  return mapDocument(set, path, (document) =>
    // A read-only document is unchanged by an edit rather than merely un-dirtied by one. Recording
    // the text and not the flag would leave the buffer disagreeing with what it says it holds, and
    // the disagreement would only surface in whatever read it next.
    document.content === content || document.readOnly
      ? document
      : { ...document, content, dirty: true },
  );
}

/// The document is on disk as the editor shows it, at `revision`.
///
/// Only the flag and the revision change. The text is deliberately not replaced with anything: a
/// save writes the buffer out, it does not read it back.
export function markSaved(set: DocumentSet, path: string, revision: Revision): DocumentSet {
  return mapDocument(set, path, (document) => ({ ...document, revision, dirty: false }));
}

function mapDocument(
  set: DocumentSet,
  path: string,
  change: (document: OpenDocument) => OpenDocument,
): DocumentSet {
  if (!isOpen(set, path)) return set;
  return {
    ...set,
    documents: set.documents.map((document) =>
      document.path === path ? change(document) : document,
    ),
  };
}

/// The entries of a tab's right-click menu, in the order they appear on it.
///
/// A closed list rather than free strings, so the menu, its translations and the function that
/// answers for each one cannot drift apart.
export const TAB_CLOSE_ACTIONS = [
  "close",
  "close-right",
  "close-all",
  "close-others",
  "close-saved",
] as const;

export type TabCloseAction = (typeof TAB_CLOSE_ACTIONS)[number];

/// Which tabs one entry of that menu would close, in strip order.
///
/// Expressed over the strip - the paths, which of them have unsaved work, and the one that was
/// clicked - rather than over a `DocumentSet`, because the strip is what the component holds and
/// what a person is looking at when they right-click.
///
/// **An empty answer is how the menu greys an entry.** "Close Tabs to the Right" on the last tab and
/// "Close Others" with one tab open both close nothing, and an entry that would do nothing is one
/// there is no point offering. That keeps the enabled state derived from the same function that does
/// the work, rather than being a second set of conditions that can disagree with it.
///
/// Order matters because the caller asks about unsaved work one tab at a time and a cancel stops the
/// rest: the tabs are dealt with left to right, which is the order they are being looked at in.
export function tabsToClose(
  action: TabCloseAction,
  paths: readonly string[],
  dirtyPaths: readonly string[],
  path: string,
): string[] {
  // The strip can change under a menu that is already open. A path that is no longer there closes
  // nothing rather than closing something else by index.
  const index = paths.indexOf(path);

  switch (action) {
    case "close":
      return index === -1 ? [] : [path];
    case "close-right":
      return index === -1 ? [] : paths.slice(index + 1);
    case "close-all":
      return [...paths];
    case "close-others":
      return index === -1 ? [] : paths.filter((open) => open !== path);
    // Deliberately including the clicked tab: the entry says what it closes, and a "Close Saved"
    // that quietly spared the one under the pointer would be answering a different question.
    case "close-saved":
      return paths.filter((open) => !dirtyPaths.includes(open));
  }
}

/// What each tab is called, in the order the paths were given.
///
/// A file's own name, until two open files share one - then both grow a folder, and keep growing
/// until they differ. Two tabs both reading "index.md" are two tabs the user cannot tell apart,
/// which defeats the one thing a tab strip is for. Only the clashing tabs are qualified: lengthening
/// every label because two unrelated files collide would make the whole strip harder to read.
export function tabLabels(paths: readonly string[]): string[] {
  const labels = paths.map((path) => ({ path, segments: path.split("/"), depth: 1 }));

  // Each pass lengthens only the labels that are still ambiguous, so a clash between two deep paths
  // cannot drag a third, unrelated tab out to its full path.
  for (let pass = 0; pass < 32; pass += 1) {
    const counts = new Map<string, number>();
    for (const label of labels) {
      const text = render(label.segments, label.depth);
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }

    const ambiguous = labels.filter(
      (label) =>
        (counts.get(render(label.segments, label.depth)) ?? 0) > 1 &&
        label.depth < label.segments.length,
    );
    // Either every label is unique, or the ones that are not have no more path left to show - two
    // identical paths cannot happen, since a path is a document's identity.
    if (ambiguous.length === 0) break;

    for (const label of ambiguous) label.depth += 1;
  }

  return labels.map((label) => render(label.segments, label.depth));
}

function render(segments: readonly string[], depth: number): string {
  return segments.slice(Math.max(0, segments.length - depth)).join("/");
}
