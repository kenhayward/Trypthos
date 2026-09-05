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
}

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
  if (set.activePath !== path) return { ...set, activePath: set.activePath };

  const next = documents[index] ?? documents[index - 1] ?? null;
  return { documents, activePath: next?.path ?? null };
}

/// Records an edit to one document. Dirty is measured against the text, not set by the act of
/// typing: retyping a character back to what it was leaves the file unmodified, and an indicator
/// that says otherwise is telling the user something untrue about their file.
export function updateContent(set: DocumentSet, path: string, content: string): DocumentSet {
  return mapDocument(set, path, (document) =>
    document.content === content ? document : { ...document, content, dirty: true },
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
