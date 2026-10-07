import { z } from "zod";

/// Reading OneDrive, the pure half: personal accounts, through Microsoft Graph.
///
/// The shell owns the requests, the token and the pre-authenticated download addresses; this owns
/// every Graph address the shell asks, every shape it accepts, what a refusal means, and what a
/// folder's listing shows in the tree and in the picker. See docs/specs/onedrive-workspace.md.

export const GRAPH_API = "https://graph.microsoft.com/v1.0";

/// The fields every item request asks for. `remoteItem` is how a folder shared with the user shows,
/// in Shared with me and in their own drive alike; its id and drive are the real ones.
const ITEM_FIELDS = "id,name,size,folder,file,eTag,cTag,webUrl,parentReference,remoteItem";
/// One page of a listing. Further pages are followed through `@odata.nextLink`.
const PAGE_SIZE = 200;

export const ONEDRIVE_MY_DRIVE_URL = `${GRAPH_API}/me/drive?$select=id,driveType`;

/// Every drive and item id this app sends back to Graph is this alphabet: a personal drive id is hex,
/// an item id is `<drive>!<number>`, and the root has the alias `root`. An id that is not is refused
/// before it reaches an address - from settings, from the renderer, from anywhere.
const ONEDRIVE_ID_PATTERN = /^[A-Za-z0-9!._-]{1,256}$/;

export function isOneDriveId(value: string): boolean {
  return ONEDRIVE_ID_PATTERN.test(value);
}

export const OneDriveIdSchema = z.string().regex(ONEDRIVE_ID_PATTERN);

/// Whether two drive ids name the same drive. Case-insensitive: Graph does not promise one spelling
/// of a personal drive id across endpoints, and a false "another account" would lock the user out of
/// their own folder. Used for the account check only - a workspace's key is not folded.
export function sameOneDriveId(one: string, other: string): boolean {
  return one.toLowerCase() === other.toLowerCase();
}

/// A facet Graph sends as an object whose contents this app does not read: its presence is the fact.
const FacetSchema = z.object({});
const ParentSchema = z.object({ driveId: z.string().optional() });

export const OneDriveItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /// Bytes. A folder has one too - the sum of what is in it.
  size: z.number().int().nonnegative().optional(),
  eTag: z.string().optional(),
  /// Changes on a content write and not on a rename: the revision. The root has none.
  cTag: z.string().optional(),
  webUrl: z.string().optional(),
  folder: FacetSchema.optional(),
  file: z.object({ mimeType: z.string().optional() }).optional(),
  parentReference: ParentSchema.optional(),
  /// Present when the item stands for one in another drive: a folder shared with the user.
  remoteItem: z
    .object({
      id: z.string().min(1),
      folder: FacetSchema.optional(),
      parentReference: ParentSchema.optional(),
    })
    .optional(),
});

export type OneDriveItem = z.infer<typeof OneDriveItemSchema>;

export const OneDrivePageSchema = z.object({
  value: z.array(OneDriveItemSchema),
  "@odata.nextLink": z.string().optional(),
});

export const OneDriveDriveSchema = z.object({ id: z.string().min(1), driveType: z.string().optional() });

const GraphErrorSchema = z.object({ error: z.object({ code: z.string() }) });

/// The code in Graph's error body, or null when there is no body Graph would have written.
export function graphErrorCode(body: unknown): string | null {
  const parsed = GraphErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.code : null;
}

/// A workspace path as Graph's path syntax takes it: every segment encoded on its own, so a `#`, `?`
/// or `%` in a name can neither end the path nor start a query, and joined by the `/` it was split on.
function encodedPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/// An item by its id. The ids are encoded too, though `isOneDriveId` has already kept them to an
/// alphabet that needs none - the address does not rely on every caller having checked.
export function oneDriveItemUrl(driveId: string, itemId: string): string {
  return `${GRAPH_API}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
}

/// An item by its path below another item: the workspace's own root is `path` "", addressed by id.
export function oneDrivePathUrl(driveId: string, itemId: string, path: string): string {
  const item = oneDriveItemUrl(driveId, itemId);
  return path === "" ? item : `${item}:/${encodedPath(path)}:`;
}

export function oneDriveMetaUrl(driveId: string, itemId: string, path: string): string {
  return `${oneDrivePathUrl(driveId, itemId, path)}?$select=${ITEM_FIELDS}`;
}

export function oneDriveChildrenUrl(driveId: string, itemId: string, path: string): string {
  return `${oneDrivePathUrl(driveId, itemId, path)}/children?$top=${PAGE_SIZE}&$select=${ITEM_FIELDS}`;
}

/// A file's content. Graph answers 302 to a pre-authenticated address; the shell asks without
/// following it, so the token never travels to another host.
export function oneDriveContentUrl(driveId: string, itemId: string): string {
  return `${oneDriveItemUrl(driveId, itemId)}/content`;
}

export function oneDriveSharedWithMeUrl(): string {
  return `${GRAPH_API}/me/drive/sharedWithMe`;
}

/// Whether an address is Graph's own: https, Graph's host exactly, the v1.0 API. A next page's
/// address comes from Graph's answer, and the token goes with it.
export function isGraphUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host === "graph.microsoft.com" && url.pathname.startsWith("/v1.0/");
  } catch {
    return false;
  }
}

/// Whether an address is https - what a download address or a web page must be before the shell
/// fetches it or hands it to the browser.
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export type OneDriveFailure =
  | "not-connected"
  | "permission-denied"
  | "not-found"
  | "exists"
  | "conflict"
  | "too-large"
  | "rate-limited"
  | "offline"
  | "unknown";

/// What a refusal from Graph means to the user: the spec's error table, one mapping shared by the
/// client and the provider. A 4xx Graph does not name is `unknown` - Graph answered, so "check your
/// connection" would send the user to the wrong place - and only a 5xx reads as `offline`.
export function oneDriveFailure(status: number, code: string | null): OneDriveFailure {
  if (status === 401) return "not-connected";
  if (status === 403) return "permission-denied";
  if (status === 404) return "not-found";
  if (status === 409) return code === "nameAlreadyExists" ? "exists" : "conflict";
  if (status === 412) return "conflict";
  if (status === 413) return "too-large";
  if (status === 429 || status === 503) return "rate-limited";
  if (status >= 400 && status < 500) return "unknown";
  return "offline";
}

export const MAX_RETRY_AFTER_MS = 10_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;

/// How long to wait before the one retry after a 429 or 503: what `Retry-After` asks in seconds, never
/// more than ten, and a second when it asks in a form this does not read (a date, or nothing).
export function retryAfterMs(header: string | null): number {
  const value = header?.trim() ?? "";
  if (!/^\d+$/.test(value)) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(Number(value) * 1000, MAX_RETRY_AFTER_MS);
}

/// Whether a 206's `Content-Range` is exactly the inclusive range asked for. Anything else would be
/// played as the wrong part of the file.
export function contentRangeMatches(header: string | null, start: number, end: number): boolean {
  if (header === null) return false;
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header.trim());
  return match !== null && Number(match[1]) === start && Number(match[2]) === end;
}

export interface OneDriveEntry {
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly itemId: string;
  readonly cTag: string | null;
  readonly sizeBytes: number | null;
}

/// A name a path can carry as one segment. OneDrive forbids most of these already; the check is here
/// so the tree never depends on that.
function usableName(name: string): boolean {
  // eslint-disable-next-line no-control-regex -- a control character cannot be part of a path segment.
  return name !== "" && name !== "." && name !== ".." && !/[/\\\u0000-\u001f\u007f]/.test(name);
}

function compare(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

/// **The one function that decides what a folder's listing shows in the tree.**
///
/// Files and folders only - a notebook is neither - and never a remote item, which lives in another
/// drive that a path below this one cannot reach. Folders first, then names, case-insensitively.
/// OneDrive refuses two names in one folder that differ only in case, so no suffix is ever needed.
export function oneDriveEntriesOf(items: readonly OneDriveItem[]): OneDriveEntry[] {
  return items
    .filter(
      (item) => item.remoteItem === undefined && (item.folder !== undefined || item.file !== undefined) && usableName(item.name),
    )
    .map(
      (item): OneDriveEntry => ({
        name: item.name,
        kind: item.folder !== undefined ? "directory" : "file",
        itemId: item.id,
        cTag: item.cTag ?? null,
        sizeBytes: item.size ?? null,
      }),
    )
    .sort((one, other) =>
      one.kind === other.kind
        ? compare(one.name.toLowerCase(), other.name.toLowerCase()) || compare(one.name, other.name)
        : one.kind === "directory"
          ? -1
          : 1,
    );
}

export interface OneDriveFolder {
  readonly driveId: string;
  readonly itemId: string;
  readonly name: string;
  readonly shared: boolean;
}

/// The folders in a listing, for the picker: a drive's own folders (when `driveId` names the drive
/// listed), and every shared folder, addressed in the drive it really lives in. Shared with me has no
/// drive of its own, so it is listed with `driveId` null. Ids that could not be sent back are dropped.
export function oneDriveFoldersOf(items: readonly OneDriveItem[], driveId: string | null): OneDriveFolder[] {
  const folders: OneDriveFolder[] = [];
  for (const item of items) {
    const remote = item.remoteItem;
    if (remote !== undefined) {
      const owner = remote.parentReference?.driveId;
      if (remote.folder !== undefined && owner !== undefined && isOneDriveId(owner) && isOneDriveId(remote.id)) {
        folders.push({ driveId: owner, itemId: remote.id, name: item.name, shared: true });
      }
      continue;
    }
    if (item.folder !== undefined && driveId !== null && isOneDriveId(item.id)) {
      folders.push({ driveId, itemId: item.id, name: item.name, shared: false });
    }
  }
  return folders.sort((one, other) => compare(one.name.toLowerCase(), other.name.toLowerCase()) || compare(one.name, other.name));
}
