import { z } from "zod";

/// Reading Google Drive, the pure half.
///
/// The shell owns the requests and the token; this owns every address it asks, every shape it
/// accepts, and the one function that decides what a folder's listing shows in the tree. See
/// docs/specs/google-drive-workspace.md ("PR 2 decisions taken while planning").

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_APPS_PREFIX = "application/vnd.google-apps.";

/// Every Drive id is this alphabet. An id is spliced into a query string, so one that is not is
/// refused before it gets there - from settings, from the renderer, from anywhere.
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function isDriveId(value: string): boolean {
  return DRIVE_ID_PATTERN.test(value);
}

export const DriveIdSchema = z.string().regex(DRIVE_ID_PATTERN);

const FILE_FIELDS = "id,name,mimeType,size,headRevisionId,modifiedTime,createdTime,trashed";

export const DriveFileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string(),
  /// Drive sends a size as a string, and none at all for Google's own types and folders.
  size: z.string().optional(),
  headRevisionId: z.string().optional(),
  modifiedTime: z.string().optional(),
  createdTime: z.string().optional(),
  trashed: z.boolean().optional(),
});

export type DriveFile = z.infer<typeof DriveFileSchema>;

export const DriveFileListSchema = z.object({
  files: z.array(DriveFileSchema).default([]),
  nextPageToken: z.string().optional(),
});

export const SharedDriveListSchema = z.object({
  drives: z.array(z.object({ id: z.string().min(1), name: z.string() })).default([]),
  nextPageToken: z.string().optional(),
});

export function childrenUrl(folderId: string, pageToken: string | null, foldersOnly = false): string {
  const clauses = [`'${folderId}' in parents`, "trashed = false"];
  if (foldersOnly) clauses.push(`mimeType = '${FOLDER_MIME}'`);
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    pageSize: "1000",
    orderBy: "folder,name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (pageToken !== null) params.set("pageToken", pageToken);
  return `${DRIVE_API}/files?${params.toString()}`;
}

export function fileUrl(id: string): string {
  return `${DRIVE_API}/files/${id}?${new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: "true" }).toString()}`;
}

export function driveMediaUrl(id: string): string {
  return `${DRIVE_API}/files/${id}?alt=media&supportsAllDrives=true`;
}

export function exportUrl(id: string): string {
  return `${DRIVE_API}/files/${id}/export?${new URLSearchParams({ mimeType: "text/markdown" }).toString()}`;
}

export function sharedDrivesUrl(pageToken: string | null): string {
  const params = new URLSearchParams({ pageSize: "100", fields: "nextPageToken,drives(id,name)" });
  if (pageToken !== null) params.set("pageToken", pageToken);
  return `${DRIVE_API}/drives?${params.toString()}`;
}

const DriveErrorBodySchema = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string() })).optional() }),
});

export type DriveFailure = "not-connected" | "permission-denied" | "not-found" | "rate-limited" | "offline";

/// What a refusal from Drive means to the user. A 403 is read for its reason, because Drive answers
/// both "you may not" and "slow down" with it.
export function driveErrorFor(status: number, body: unknown): DriveFailure {
  if (status === 401) return "not-connected";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status === 403) {
    const parsed = DriveErrorBodySchema.safeParse(body);
    const reasons = parsed.success ? (parsed.data.error.errors ?? []).map((entry) => entry.reason) : [];
    return reasons.some((reason) => reason === "userRateLimitExceeded" || reason === "rateLimitExceeded")
      ? "rate-limited"
      : "permission-denied";
  }
  return "offline";
}

/// The name a Drive file is shown and addressed by.
///
/// Drive allows `/`, `\`, `:` and control characters in a name; a path cannot hold them, so they
/// become `_` - for display only, nothing is written back. A Google Doc is named `.md` because that
/// is what it opens as, and the interface decides what it can open by extension.
export function displayNameFor(file: { name: string; mimeType: string }): string {
  // eslint-disable-next-line no-control-regex -- Drive allows control characters in a name; a path cannot hold them.
  const cleaned = file.name.replace(/[/\\:\u0000-\u001f\u007f]/g, "_");
  const safe = cleaned.trim() === "" || cleaned === "." || cleaned === ".." ? "_" : cleaned;
  return file.mimeType === GOOGLE_DOC_MIME && !/\.md$/i.test(safe) ? `${safe}.md` : safe;
}

export interface DriveEntry {
  /// Workspace-relative, `/`-separated, built from display names.
  path: string;
  name: string;
  kind: "file" | "directory";
  fileId: string;
  mimeType: string;
  googleDoc: boolean;
  sizeBytes: number | null;
  /// `headRevisionId`, or `modified:<time>` for a Google Doc, which has none.
  revision: string | null;
}

/// Whether a listed item belongs in the tree: not trashed, and a folder, a Google Doc, or an
/// ordinary file. Shortcuts are left out - their target can be outside the workspace.
function isListed(file: DriveFile): boolean {
  if (file.trashed === true) return false;
  if (file.mimeType === FOLDER_MIME || file.mimeType === GOOGLE_DOC_MIME) return true;
  return !file.mimeType.startsWith(GOOGLE_APPS_PREFIX);
}

function compare(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

function withSuffix(name: string, id: string): string {
  const tag = `~${id.slice(0, 6)}`;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}${tag}${name.slice(dot)}` : `${name}${tag}`;
}

/// **The one function that decides what a folder's listing shows.**
///
/// Hides what cannot be opened, names what remains, and gives the second and later of same-named
/// siblings a suffix from their id - ordered by creation time then id, so the same listing always
/// produces the same paths. Folders first, then names, case-insensitively.
export function childrenToEntries(parentPath: string, files: readonly DriveFile[]): DriveEntry[] {
  const byName = new Map<string, DriveFile[]>();
  for (const listed of files.filter(isListed)) {
    const name = displayNameFor(listed);
    byName.set(name, [...(byName.get(name) ?? []), listed]);
  }

  const entries: DriveEntry[] = [];
  for (const [name, group] of byName) {
    const ordered = [...group].sort(
      (one, other) => compare(one.createdTime ?? "", other.createdTime ?? "") || compare(one.id, other.id),
    );
    ordered.forEach((listed, index) => {
      const finalName = index === 0 ? name : withSuffix(name, listed.id);
      const googleDoc = listed.mimeType === GOOGLE_DOC_MIME;
      entries.push({
        path: parentPath === "" ? finalName : `${parentPath}/${finalName}`,
        name: finalName,
        kind: listed.mimeType === FOLDER_MIME ? "directory" : "file",
        fileId: listed.id,
        mimeType: listed.mimeType,
        googleDoc,
        sizeBytes: listed.size === undefined ? null : Number(listed.size),
        revision:
          listed.headRevisionId ??
          (googleDoc && listed.modifiedTime !== undefined ? `modified:${listed.modifiedTime}` : null),
      });
    });
  }

  return entries.sort((one, other) =>
    one.kind === other.kind
      ? compare(one.name.toLowerCase(), other.name.toLowerCase()) || compare(one.name, other.name)
      : one.kind === "directory"
        ? -1
        : 1,
  );
}

/// The folders in a listing, by their real names, for the folder picker.
export function foldersOf(files: readonly DriveFile[]): { id: string; name: string }[] {
  return files
    .filter((listed) => listed.mimeType === FOLDER_MIME && listed.trashed !== true)
    .map((listed) => ({ id: listed.id, name: listed.name }));
}
