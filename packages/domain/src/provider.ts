/// The storage provider contract: one interface over local directories and cloud accounts.
///
/// Shaped now for a backend that does not exist yet. Phase 1 ships local only, then OneDrive,
/// Google Drive, Dropbox, GitHub. The first three are the same shape - OAuth, a mutable file at a
/// stable id, last-writer-wins. GitHub is not: a save is a commit on a branch. Two consequences are
/// baked in here rather than retrofitted through every call site later:
///
///  - a write RETURNS a revision, never void, so a commit id has somewhere to live;
///  - a conflict is a RESULT, not a thrown error, so the local backend can answer "never" while the
///    interface still expresses it.

/// Opaque provider-defined version token. A local mtime+size, an ETag, a Drive revision id, a commit
/// SHA. Never parsed by the app - only compared and passed back.
export interface Revision {
  readonly id: string;
}

export interface NodeMeta {
  /// Provider-scoped identifier. For local this is the workspace-relative path; for cloud backends
  /// it may be an opaque id, so never assume it is a path - it is untrusted input either way and
  /// goes through the workspace path guard before touching a filesystem.
  readonly id: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly revision: Revision | null;
  readonly sizeBytes: number | null;
  readonly modifiedAt: string | null;
}

/// Cloud listings are paged, slow and can fail part-way. The cursor is what lets the tree show a
/// partially loaded directory honestly instead of pretending it has everything.
export interface ListPage {
  readonly nodes: readonly NodeMeta[];
  readonly cursor: string | null;
}

export type ProviderError =
  | "not-found"
  | "permission-denied"
  | "offline"
  | "rate-limited"
  | "unsupported";

export type ReadResult =
  | { ok: true; content: string; revision: Revision }
  | { ok: false; reason: ProviderError };

export type ListResult =
  | { ok: true; page: ListPage }
  | { ok: false; reason: ProviderError };

export type WriteResult =
  /// The write landed. `revision` is what a subsequent conditional write must present.
  | { ok: true; revision: Revision }
  /// Somebody else wrote since `expected`. Never resolve this silently: the editor must not report
  /// a save that did not happen, and the user picks what wins.
  | { ok: false; reason: "conflict"; theirs: Revision }
  | { ok: false; reason: ProviderError };

export interface StorageProvider {
  readonly id: string;
  readonly kind: "local" | "onedrive" | "google-drive" | "dropbox" | "github";

  list(directoryId: string, cursor: string | null): Promise<ListResult>;
  read(fileId: string): Promise<ReadResult>;

  /// `expected` is the revision the caller last saw, or null to create. A provider that cannot do
  /// conditional writes must still report a conflict it detects rather than overwriting.
  write(fileId: string, content: string, expected: Revision | null): Promise<WriteResult>;
}
