"use strict";

const {
  MAX_TEXT_FILE_BYTES,
  ONEDRIVE_UPLOAD_LIMIT_BYTES,
  createPathGuard,
  decodeTextFile,
  encodeTextFile,
  isOneDriveTag,
  oneDriveEntriesOf,
  oneDrivePathKey,
  sameOneDriveId,
} = require("@trypthos/domain");

/// A OneDrive folder, as a workspace: browsed, read and written - saves, new files, new folders and
/// renames (docs/specs/onedrive-workspace.md).
///
/// OneDrive addresses an item by its path below another and refuses two names in one folder, so -
/// unlike Google Drive - there is no map from paths to ids, no duplicate-name suffix and no re-keying.
/// Every request names its item by the workspace root's id plus the workspace-relative path, after the
/// shared path guard has resolved that path over a root that exists nowhere (GitHub's `/repo`, Drive's
/// `/drive`): `..`, absolute, drive-qualified and UNC paths are refused here exactly as they are for a
/// folder on disk, before anything is asked of Graph.
///
/// A read asks for the item's content tag BEFORE its bytes, so the revision the editor holds is never
/// newer than what it read. A save is ONE conditional request - `If-Match` with that tag - so, unlike
/// Drive's check-write-confirm, there is no window in which another writer's change is overwritten:
/// Graph refuses a stale tag with 412 and the editor is told `conflict`. A create asks Graph to fail
/// on a name already in use, and never replaces. Media streams from the pre-authenticated address
/// Graph's 302 names, kept per file until it expires; neither it nor the token ever leaves the main
/// process.
///
/// Graph compares names without regard to case, so the listing cache is keyed by `oneDrivePathKey`:
/// one folder reached by two spellings is one entry, and a write through either drops it.

const GUARD_ROOT = "/onedrive";

/// How long a folder's listing is trusted, as Drive's: the filter, Find in Files and the chat's
/// outline all walk the tree through `list`.
const LISTING_TTL_MS = 60_000;

function failure(reason) {
  return { ok: false, reason };
}

/// Microsoft's own hosts for a OneDrive or SharePoint page, matched exactly or on a dot boundary, so
/// neither `evilsharepoint.com` nor `onedrive.live.com.evil.example` passes.
const WEB_HOSTS = ["onedrive.live.com", "1drv.ms"];
const WEB_HOST_SUFFIXES = [".sharepoint.com"];

/// Whether an item's `webUrl` may be handed to openExternal: https, no user or password in it, and a
/// Microsoft host. Graph's answer is untrusted input like any other.
function isOneDriveWebUrl(value) {
  if (typeof value !== "string") return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  return WEB_HOSTS.includes(host) || WEB_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

function parentOf(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function nameOf(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

/// A listed entry as the tree receives it: its workspace path, its name and its kind - nothing of
/// OneDrive's crosses.
function treeNode(parent, entry) {
  return { id: parent === "" ? entry.name : `${parent}/${entry.name}`, name: entry.name, kind: entry.kind };
}

/// A refused save or create, in the provider contract's words. OneDrive's `exists` (409
/// `nameAlreadyExists`) is a name already taken, which every other provider calls a conflict - the
/// chat's create tool and New File read it so - and a conflict names no revision of theirs: asking for
/// one would be another request, and the editor keeps the user's text either way.
function writeRefusal(answer) {
  if (answer.reason === "exists" || answer.reason === "conflict") return { ok: false, reason: "conflict", theirs: null };
  return answer;
}

/// A refused New Folder or rename: a taken name is `conflict`, as on disk and in Drive - the rename
/// dialog reads it as "already called that".
function nameRefusal(answer) {
  return answer.reason === "exists" ? failure("conflict") : answer;
}

function createOneDriveProvider({ ref, api, now = Date.now, ttlMs = LISTING_TTL_MS }) {
  const guard = createPathGuard({ root: GUARD_ROOT, caseInsensitive: false });

  /// The workspace-relative form of a candidate path, "" for the root, or null when it escapes.
  function relativePath(candidate) {
    const resolved = guard.resolve(candidate === "" ? "." : candidate);
    if (!resolved.ok) return null;
    if (resolved.path === GUARD_ROOT) return "";
    return resolved.path.slice(GUARD_ROOT.length + 1);
  }

  /// `oneDrivePathKey(path)` -> `{ at, generation, entries }` of that folder's last successful
  /// listing. Folded, because Graph is case-insensitive: one folder reached by two spellings is one
  /// entry, and a write through either drops it.
  const listings = new Map();
  /// `oneDrivePathKey(path)` -> `{ generation, promise }` for the listing in flight, so concurrent
  /// walks of one folder - by any spelling - ask Graph once.
  const inFlight = new Map();
  /// `oneDrivePathKey(path)` -> how many times the app has written into that folder. A listing that
  /// began before a write is not kept: what it brings back may predate the write.
  const writes = new Map();
  const writesTo = (key) => writes.get(key) ?? 0;
  /// Item id -> the pre-authenticated address its bytes were last fetched from.
  const locations = new Map();
  /// Content tag -> whether the bytes read or written at it began with a byte-order mark, so a save
  /// keeps a mark the editor never showed. A tag names one version of one file, so the record is about
  /// exactly the bytes a save replaces. Not cleared by `refresh()`: the editor still holds what it read.
  const boms = new Map();
  /// Bumped by `refresh()`. A listing begun under an older generation is never cached or joined.
  let generation = 0;

  async function entriesOf(path) {
    const key = oneDrivePathKey(path);
    const cached = listings.get(key);
    if (cached !== undefined && cached.generation === generation && now() - cached.at < ttlMs) {
      return { ok: true, entries: cached.entries };
    }
    const joined = inFlight.get(key);
    if (joined !== undefined && joined.generation === generation) return joined.promise;

    const started = generation;
    const startedWrites = writesTo(key);
    const pending = { generation: started, promise: null };
    pending.promise = (async () => {
      try {
        const listed = await api.children(ref.driveId, ref.itemId, path);
        if (!listed.ok) return listed;
        const entries = oneDriveEntriesOf(listed.items);
        if (started === generation && writesTo(key) === startedWrites) {
          listings.set(key, { at: now(), generation: started, entries });
        }
        return { ok: true, entries };
      } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
    return pending.promise;
  }

  /// A folder's entries as they are now: a listing that a Refresh overtook is asked for again, so a
  /// Refresh pressed mid-listing cannot be undone by it.
  async function currentEntriesOf(path) {
    for (;;) {
      const started = generation;
      const listed = await entriesOf(path);
      if (!listed.ok || generation === started) return listed;
    }
  }

  /// Drops what is known of a folder the app has just written into, so its next listing is asked of
  /// OneDrive: the cached listing, any listing in flight (which may predate the write and, through
  /// `writes`, is not kept when it lands), and - with `below` - every folder under it, for a rename
  /// that moved them all. Called after every write request, whatever it answered: one that failed
  /// as `offline` or `unknown` may have landed.
  function forget(path, { below = false } = {}) {
    const key = oneDrivePathKey(path);
    const hit = (other) => other === key || (below && other.startsWith(`${key}/`));
    const keys = new Set([key, ...[...listings.keys(), ...inFlight.keys()].filter(hit)]);
    for (const each of keys) {
      listings.delete(each);
      inFlight.delete(each);
      writes.set(each, writesTo(each) + 1);
    }
  }

  /// A file's metadata, asked for fresh by its path: a revision is never a cached one.
  async function fileAt(candidate) {
    const path = relativePath(candidate);
    if (path === null || path === "") return failure("permission-denied");
    const meta = await api.item(ref.driveId, ref.itemId, path);
    if (!meta.ok) return meta;
    if (meta.item.file === undefined || meta.item.folder !== undefined) return failure("not-found");
    return { ok: true, item: meta.item };
  }

  /// A file's bytes, refused by its size before anything is downloaded, and by what arrives after.
  async function bytesOf(item, limitBytes) {
    if (typeof item.size === "number" && item.size > limitBytes) {
      return { ok: false, reason: "too-large", sizeBytes: item.size, limitBytes };
    }
    return api.download(ref.driveId, item.id, limitBytes);
  }

  /// A write that landed, as the editor receives it: the content tag Graph answered the write with,
  /// never one asked for afterwards - by then it could be a concurrent writer's, and the next save
  /// would overwrite them. A write whose answer has no usable tag landed as something nobody can
  /// name, which is `unknown`. The item's download address is dropped: it may serve the old bytes.
  function landed(item, bom) {
    if (!isOneDriveTag(item.cTag)) return failure("unknown");
    boms.set(item.cTag, bom);
    locations.delete(item.id);
    return { ok: true, revision: { id: item.cTag } };
  }

  /// A new file at a path nobody has. Its folder is asked for first, fresh rather than through the
  /// listing cache: Graph's path PUT may make the folders on the way, and the app makes only what it
  /// was asked for - a folder deleted on the web since it was listed must not come back. Graph
  /// refuses a name already in use, case-insensitively, rather than replacing it.
  async function create(path, content) {
    const parent = parentOf(path);
    const folder = await api.item(ref.driveId, ref.itemId, parent);
    if (!folder.ok) return folder;
    if (folder.item.folder === undefined) return failure("not-found");
    const created = await api.createContent(ref.driveId, ref.itemId, path, encodeTextFile(content, { bom: false }));
    forget(parent);
    if (!created.ok) return writeRefusal(created);
    return landed(created.item, false);
  }

  return {
    id: ref.itemId,
    kind: "onedrive",

    async list(candidate) {
      const path = relativePath(candidate);
      if (path === null) return failure("permission-denied");
      const listed = await currentEntriesOf(path);
      if (!listed.ok) return listed;
      return { ok: true, nodes: listed.entries.map((entry) => treeNode(path, entry)) };
    },

    /// A folder as far as it is already known, with no request to Graph - as Drive's: the filter and
    /// Find in Files search through this, so a large OneDrive is never read all at once. `complete`
    /// is false for a folder nobody has opened since the last refresh or write into it.
    async listKnown(candidate) {
      const path = relativePath(candidate);
      if (path === null) return failure("permission-denied");
      const known = listings.get(oneDrivePathKey(path));
      if (known === undefined || known.generation !== generation) return { ok: true, nodes: [], complete: false };
      return { ok: true, nodes: known.entries.map((entry) => treeNode(path, entry)), complete: true };
    },

    /// The revision is the content tag, which a save presents with If-Match. A tag that could not go
    /// back in a header is nothing honest to hand the editor. A file larger than Graph's simple upload
    /// takes opens read-only: it could be edited, and never saved.
    async read(candidate) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      if (!isOneDriveTag(found.item.cTag)) return failure("unknown");
      const fetched = await bytesOf(found.item, MAX_TEXT_FILE_BYTES);
      if (!fetched.ok) return fetched;
      const decoded = decodeTextFile(fetched.bytes);
      if (!decoded.ok) return failure(decoded.reason);
      boms.set(found.item.cTag, decoded.bom);
      return {
        ok: true,
        content: decoded.content,
        revision: { id: found.item.cTag },
        ...(fetched.bytes.length > ONEDRIVE_UPLOAD_LIMIT_BYTES ? { readOnly: true } : {}),
      };
    },

    async readBytes(candidate, limitBytes) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      return bytesOf(found.item, limitBytes);
    },

    /// A file as a source of byte ranges, for the protocol that streams video and audio.
    ///
    /// The size and the item id come from the parent's listing, through the TTL'd cache, so the player's
    /// quick succession of ranges does not each start with a metadata call. Each range is fetched from
    /// the pre-authenticated address with no token; an address refused as expired is replaced once.
    async mediaSource(candidate) {
      const path = relativePath(candidate);
      if (path === null || path === "") return failure("permission-denied");
      const listed = await currentEntriesOf(parentOf(path));
      if (!listed.ok) return listed;
      const wanted = nameOf(path).toLowerCase();
      const entry = listed.entries.find((known) => known.name.toLowerCase() === wanted);
      if (entry === undefined || entry.kind !== "file" || entry.sizeBytes === null) return failure("not-found");
      const { itemId, sizeBytes: size } = entry;

      async function locate(fresh) {
        const known = locations.get(itemId);
        if (!fresh && known !== undefined) return { ok: true, url: known };
        const got = await api.downloadLocation(ref.driveId, itemId);
        if (got.ok) locations.set(itemId, got.url);
        return got;
      }

      return {
        ok: true,
        size,
        /// `signal` is the window's request: when the player gives up on a range, the request stops too.
        open: async (start, end, signal) => {
          let where = await locate(false);
          if (!where.ok) return where;
          let ranged = await api.rangeFrom(where.url, start, end, { signal });
          if (!ranged.ok && ranged.reason === "expired") {
            locations.delete(itemId);
            // Nobody is left to read the answer: no new address is asked for, and the failure is the
            // one an abandoned range answers everywhere else.
            if (signal?.aborted) return failure("offline");
            where = await locate(true);
            if (!where.ok) return where;
            ranged = await api.rangeFrom(where.url, start, end, { signal });
          }
          // Refused twice in a row, straight after a new address was issued: not an expiry.
          if (!ranged.ok) return failure(ranged.reason === "expired" ? "permission-denied" : ranged.reason);
          // A 200 is the whole file: only a correct answer to a range that IS the whole file. For any
          // other, the protocol would label the full body a 206 of the wrong length. Checked here as
          // well as in the client, which only knows where the range starts.
          if (ranged.status === 200 && (start !== 0 || end !== size - 1)) {
            await ranged.body?.cancel().catch(() => {});
            return failure("offline");
          }
          return { ok: true, body: ranged.body };
        },
      };
    },

    /// A save, or - with no revision - a new file. `file:write`, New File and the chat's create-file
    /// tool all come here.
    ///
    /// A save is one conditional PUT: Graph writes only if the file is still at the tag the editor
    /// read, and refuses with 412 (`conflict`) otherwise, so another writer's change is never
    /// overwritten. The tag comes back from the renderer and is checked before it goes into a header.
    /// `options` (Save As's `overwrite`, GitHub's commit message) means nothing here: Save As never
    /// reaches a provider without a folder on disk.
    async write(candidate, content, expected) {
      const path = relativePath(candidate);
      if (path === null || path === "") return failure("permission-denied");
      if (expected === null) return create(path, content);
      if (!isOneDriveTag(expected?.id)) return failure("bad-request");

      const bom = boms.get(expected.id) === true;
      const written = await api.writeContent(ref.driveId, ref.itemId, path, encodeTextFile(content, { bom }), expected.id);
      forget(parentOf(path));
      if (!written.ok) return writeRefusal(written);
      return landed(written.item, bom);
    },

    /// One new folder, in a folder that is already there. Graph refuses a name already in use.
    async createDirectory(candidate) {
      const path = relativePath(candidate);
      if (path === null || path === "") return failure("permission-denied");
      const parent = parentOf(path);
      const created = await api.createFolder(ref.driveId, ref.itemId, parent, nameOf(path));
      forget(parent);
      return created.ok ? { ok: true } : nameRefusal(created);
    },

    /// A new name for a file or folder, in the folder it is already in; answers its new
    /// workspace-relative path. A change of case alone is a rename like any other. What was listed
    /// below the old path and the new one is dropped and asked again: nothing is re-keyed.
    async rename(candidate, name) {
      const path = relativePath(candidate);
      // The workspace's own folder is what was opened; renaming it would pull the root out from under
      // every open path, exactly as on disk.
      if (path === null || path === "") return failure("permission-denied");
      const parent = parentOf(path);
      const target = relativePath(parent === "" ? name : `${parent}/${name}`);
      // A NAME, never a destination: whatever the guard reads as anything but one more segment of
      // this folder is refused.
      if (target === null || target === "" || parentOf(target) !== parent || nameOf(target) !== name) {
        return failure("bad-request");
      }
      const renamed = await api.rename(ref.driveId, ref.itemId, path, name);
      forget(parent);
      forget(path, { below: true });
      forget(target, { below: true });
      return renamed.ok ? { ok: true, path: target } : nameRefusal(renamed);
    },

    /// Where an entry lives on the web, for Open in OneDrive: the item's own `webUrl`, and only an
    /// https one at a Microsoft host. It stays in the main process: the shell opens it, the renderer
    /// never sees it.
    async webAddress(candidate) {
      const path = relativePath(candidate);
      if (path === null) return failure("permission-denied");
      const meta = await api.item(ref.driveId, ref.itemId, path);
      if (!meta.ok) return meta;
      const url = meta.item.webUrl;
      return isOneDriveWebUrl(url) ? { ok: true, url } : failure("not-found");
    },

    async refresh() {
      generation += 1;
      listings.clear();
      locations.clear();
      return { ok: true, truncated: false };
    },
  };
}

/// Opens a OneDrive folder: it must exist and be a folder. Answers its CURRENT name - the one in the
/// reference is what it was called when it was chosen - except for My files, which Graph calls `root`.
///
/// An own-drive reference is checked against the connected account's drive first: a folder remembered
/// under one Microsoft account is never shown under another (`other-account`). A folder shared with the
/// user lives in someone else's drive by design, so it is not checked that way.
async function openOneDriveWorkspace({ ref, api, now, ttlMs }) {
  if (ref.shared !== true) {
    const mine = await api.drive();
    if (!mine.ok) return mine;
    if (!sameOneDriveId(mine.drive.id, ref.driveId)) return failure("other-account");
  }
  const root = await api.item(ref.driveId, ref.itemId, "");
  if (!root.ok) return root;
  if (root.item.folder === undefined) return failure("not-found");
  return {
    ok: true,
    name: ref.itemId === "root" ? ref.name : root.item.name,
    provider: createOneDriveProvider({ ref, api, now, ttlMs }),
  };
}

module.exports = { openOneDriveWorkspace, GUARD_ROOT };
