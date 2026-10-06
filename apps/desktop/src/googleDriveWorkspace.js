"use strict";

const {
  FOLDER_MIME,
  GOOGLE_DOC_MIME,
  MAX_TEXT_FILE_BYTES,
  childrenToEntries,
  createPathGuard,
  decodeTextFile,
  displayNameFor,
  driveRootWebUrl,
  driveWebUrl,
  encodeTextFile,
  isDriveId,
  textMimeFor,
} = require("@trypthos/domain");

/// A Google Drive folder, as a workspace.
///
/// Drive names a file by id; the tree, the editor, recent files and wiki links all name it by path.
/// This keeps the map between the two, filled as folders are listed (`childrenToEntries` decides the
/// names) and walked on demand for a path no listing has reached yet - a restored tab, a followed
/// link.
///
/// Saving is check, write, confirm: the file's current revision is asked of Drive and must be the
/// one the editor read, the new content is uploaded to the same id (keeping a byte-order mark the
/// file had), and the revision Drive answers the upload with is what the editor gets. Drive has no
/// conditional write, so a save landing between the check and the write is overwritten - a window
/// one request long, with Drive's version history holding what it replaced. A Google Doc is the one
/// read-only file: it is read as exported markdown, and writing that back would make it another kind
/// of file.
///
/// The path guard is the shared one, over a root that exists nowhere - the same arrangement as
/// GitHub's `/repo` - so `..`, absolute and drive-qualified paths are refused here exactly as they
/// are for a folder on disk.

const GUARD_ROOT = "/drive";

function failure(reason) {
  return { ok: false, reason };
}

/// A listed entry as the tree receives it. A Google Doc says so, because the tree shows it under its
/// own title rather than as the `.md` it opens as; nothing else about the entry crosses.
function treeNode(entry) {
  const node = { id: entry.path, name: entry.name, kind: entry.kind };
  return entry.googleDoc ? { ...node, googleDoc: true } : node;
}

function parentOf(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/// What is known about the workspace after one entry is renamed: the entry, and every path known
/// beneath it, moved from `from` to `to` - entries and listed folders alike, in the order they were.
///
/// A rename's own re-listing cannot do this: the parent's new listing no longer shows the old name, so
/// `listInto` would drop everything learned beneath it and collapse what the user had expanded. Pure,
/// over copies, so it is tested on its own.
function rekeyKnown(entries, listedPaths, from, to) {
  const moved = (path) => (path === from ? to : path.startsWith(from + "/") ? to + path.slice(from.length) : null);

  const nextEntries = new Map();
  for (const [path, entry] of entries) {
    const next = moved(path);
    if (next === null) nextEntries.set(path, entry);
    else if (path === from) nextEntries.set(next, { ...entry, path: next, name: next.slice(next.lastIndexOf("/") + 1) });
    else nextEntries.set(next, { ...entry, path: next });
  }
  const nextListed = new Set([...listedPaths].map((path) => moved(path) ?? path));
  return { entries: nextEntries, listedPaths: nextListed };
}

/// How long a folder's listing is trusted. The filter, Find in Files and the chat's outline all walk
/// the tree through `list`, so without this each query is a storm of sequential Drive requests.
const LISTING_TTL_MS = 60_000;

function createGoogleDriveProvider({ ref, api, now = Date.now, ttlMs = LISTING_TTL_MS }) {
  const guard = createPathGuard({ root: GUARD_ROOT, caseInsensitive: false });
  /// Workspace-relative path -> `DriveEntry`. The root is not in it: its id is the ref's.
  const entries = new Map();

  /// The workspace-relative form of a candidate path, "" for the root, or null when it escapes.
  function drivePath(candidate) {
    const resolved = guard.resolve(candidate === "" ? "." : candidate);
    if (!resolved.ok) return null;
    if (resolved.path === GUARD_ROOT) return "";
    return resolved.path.slice(GUARD_ROOT.length + 1);
  }

  /// Drive folder id -> the raw files of its last successful listing, when that was, and under which
  /// generation.
  const listings = new Map();
  /// Drive folder id -> `{ generation, promise }` for the request in flight, so concurrent walks of
  /// one folder ask Drive once.
  const inFlight = new Map();
  /// Workspace-relative paths of the folders whose listing has succeeded since the last `refresh()`.
  /// What `listKnown` answers from: the root is in it once listed.
  const listedPaths = new Set();
  /// Bumped by `refresh()`. A listing that started under an older generation is never cached, never
  /// joined, and `listInto` asks again - so a Refresh pressed mid-listing cannot be undone by it.
  let generation = 0;
  /// Drive folder id -> how many times the app has written to that folder (a new entry, a rename) and
  /// re-listed it. A listing that started before such a write is not applied: it is asked again.
  const writes = new Map();
  const writesTo = (folderId) => writes.get(folderId) ?? 0;
  /// Bumped by every rename, whose re-keying moves paths out from under a listing in flight.
  let moves = 0;
  /// `<file id>@<revision>` -> whether those bytes began with a byte-order mark, so a save keeps it.
  /// Keyed by revision because a save proceeds only when Drive's current revision is the one the
  /// editor expects - so the record looked up is about exactly the bytes being replaced. Not cleared
  /// by `refresh()`: the editor still holds the text it read, and must not lose a mark it never showed.
  const boms = new Map();
  const bomKey = (fileId, revision) => `${fileId}@${revision}`;

  /// The files of one folder: from the cache while it is fresh, else from Drive. A failure is passed
  /// on and never remembered.
  ///
  /// `fresh` neither reads the cache nor joins a request in flight: that request may have been asked
  /// before a write to the folder, and would answer it as it was. A request superseded this way is
  /// never cached either - only the newest one asked of a folder is.
  async function filesOf(folderId, { fresh = false } = {}) {
    const cached = listings.get(folderId);
    if (!fresh && cached !== undefined && cached.generation === generation && now() - cached.at < ttlMs) {
      return { ok: true, files: cached.files };
    }
    const joined = inFlight.get(folderId);
    if (!fresh && joined !== undefined && joined.generation === generation) return joined.promise;

    const started = generation;
    const pending = { generation: started, promise: null };
    pending.promise = (async () => {
      try {
        const listed = await api.listChildren(folderId);
        if (listed.ok && started === generation && inFlight.get(folderId) === pending) {
          listings.set(folderId, { at: now(), files: listed.files, generation: started });
        }
        return listed;
      } finally {
        if (inFlight.get(folderId) === pending) inFlight.delete(folderId);
      }
    })();
    inFlight.set(folderId, pending);
    return pending.promise;
  }

  /// Lists one folder and records its children, replacing only that folder's direct children - what
  /// is known about the folders below them stays.
  ///
  /// `sinceMoves` is the rename count to check against when the caller resolved `folderId` earlier
  /// than this call (see `relist`); by default it is the count now.
  async function listInto(path, folderId, { fresh = false, sinceMoves = moves } = {}) {
    const started = generation;
    const startedMoves = sinceMoves;
    const startedWrites = writesTo(folderId);
    const listed = await filesOf(folderId, { fresh });
    if (!listed.ok) return listed;
    // The re-asks below drop `fresh`. That is safe only because `relist` - the one place `writes` is
    // bumped - also deletes the cache and starts a fresh request, which replaces any older one in
    // `inFlight`: a plain ask here can only reach Drive or join that newer request. A write that bumped
    // `writes` without deleting the cache, or without asking afresh, would break it - the re-ask would
    // be answered by the very listing the write made stale.
    // A refresh while this listing was in flight: what arrived predates it, so ask again.
    if (generation !== started) return listInto(path, folderId);
    // A rename while it was in flight, and the path no longer names this folder: filing its children
    // under it would give live files a second, dead path.
    if (moves !== startedMoves && path !== "" && entries.get(path)?.fileId !== folderId) return failure("not-found");
    // The app wrote to this folder while it was in flight: what arrived may predate the write - a
    // rename it would undo, a new entry it would drop - so ask again, which finds the fresh listing.
    if (writesTo(folderId) !== startedWrites) return listInto(path, folderId);

    const children = childrenToEntries(path, listed.files);
    const incoming = new Map(children.map((child) => [child.path, child]));
    for (const [key, former] of [...entries]) {
      if (parentOf(key) !== path) continue;
      entries.delete(key);
      const now = incoming.get(key);
      // A child that is gone, or is now a different file, takes what was learned beneath it.
      if (now === undefined || now.fileId !== former.fileId || now.kind !== former.kind) {
        for (const below of [...entries.keys()]) {
          if (below.startsWith(key + "/")) entries.delete(below);
        }
        for (const below of [...listedPaths]) {
          if (below === key || below.startsWith(key + "/")) listedPaths.delete(below);
        }
      }
    }
    for (const child of children) entries.set(child.path, child);
    listedPaths.add(path);
    return { ok: true, children };
  }

  /// The entry at a non-root path, listing its way down from the nearest known folder if needed.
  async function ensure(path) {
    const known = entries.get(path);
    if (known !== undefined) return { ok: true, entry: known };

    const parent = parentOf(path);
    let folderId = ref.folderId;
    if (parent !== "") {
      const up = await ensure(parent);
      if (!up.ok) return up;
      if (up.entry.kind !== "directory") return failure("not-found");
      folderId = up.entry.fileId;
    }

    const listed = await listInto(parent, folderId);
    if (!listed.ok) return listed;
    const entry = entries.get(path);
    return entry === undefined ? failure("not-found") : { ok: true, entry };
  }

  async function fileAt(candidate) {
    const path = drivePath(candidate);
    if (path === null || path === "") return failure("permission-denied");
    const found = await ensure(path);
    if (!found.ok) return found;
    return found.entry.kind === "file" ? found : failure("not-found");
  }

  /// A file's bytes, refused by its listed size before anything is downloaded, and by its real size
  /// after (a Google Doc has no listed size).
  async function bytesOf(entry, limitBytes) {
    if (entry.sizeBytes !== null && entry.sizeBytes > limitBytes) {
      return { ok: false, reason: "too-large", sizeBytes: entry.sizeBytes, limitBytes };
    }
    const fetched = entry.googleDoc ? await api.exportMarkdown(entry.fileId) : await api.download(entry.fileId);
    if (!fetched.ok) return fetched;
    if (fetched.bytes.length > limitBytes) {
      return { ok: false, reason: "too-large", sizeBytes: fetched.bytes.length, limitBytes };
    }
    return fetched;
  }

  /// The Drive id of a folder by its workspace path ("" is the workspace's own folder).
  async function folderIdAt(path) {
    if (path === "") return { ok: true, id: ref.folderId };
    const found = await ensure(path);
    if (!found.ok) return found;
    return found.entry.kind === "directory" ? { ok: true, id: found.entry.fileId } : failure("not-found");
  }

  /// A conflict, naming their revision when there is one - never `{ id: undefined }`.
  function conflict(current) {
    return { ok: false, reason: "conflict", theirs: typeof current === "string" ? { id: current } : null };
  }

  /// A new file at a path nobody has: created in its folder, under exactly the name the path gives.
  async function create(path, content, expected) {
    // A revision expected of a file that is not there: it was deleted, or never existed.
    if (expected !== null) return conflict(null);
    const parent = parentOf(path);
    // Taken before `parent` is resolved to an id, so a rename of it while Drive is asked is seen.
    const sinceMoves = moves;
    const folder = await folderIdAt(parent);
    if (!folder.ok) return folder;

    const name = parent === "" ? path : path.slice(parent.length + 1);
    const mimeType = textMimeFor(name);
    // A name the tree would show differently would land the file under another path than the one
    // asked for.
    if (displayNameFor({ name, mimeType }) !== name) return failure("bad-request");

    // The cached listing can predate a file Drive already has under this name. Creating a second one
    // would leave the path naming the older file, so the folder is asked for afresh first.
    const fresh = await relist(parent, folder.id, sinceMoves);
    if (!fresh.ok) return fresh;
    const existing = entries.get(path);
    if (existing !== undefined) return existing.kind === "file" ? conflict(existing.revision) : failure("permission-denied");

    const created = await api.createFile(folder.id, name, encodeTextFile(content, { bom: false }), mimeType);
    if (!created.ok) return created;
    // Re-listed so the new file has its path in the map; the file landed whatever this answers. If
    // `parent` was renamed meanwhile this answers not-found and files nothing, and the folder's
    // listing, dropped from the cache, is asked for afresh under its new path.
    await relist(parent, folder.id, sinceMoves);
    // The file landed, but without Drive's revision for it there is nothing honest to hand the
    // editor: its id is not a revision, and the next save's check would fail against it or worse.
    if (created.file.headRevisionId === undefined) return failure("unknown");
    return { ok: true, revision: { id: created.file.headRevisionId } };
  }

  /// A folder listed afresh, around a write to it: Drive allows two entries of one name and the app
  /// does not, so whether a name is free is never answered from a listing that could predate it - and
  /// after the write, the map must learn what it did. Neither the cache nor a request already in
  /// flight will do, since either can predate the write; and a listing in flight is told the folder
  /// was written to, so it asks again rather than applying what it brings back.
  ///
  /// `sinceMoves` is `moves` as it was when the caller resolved `folderId` from `parent`. A rename
  /// that lands while the caller awaits Drive can move `parent` before this listing starts, and the
  /// listing's own count would then never see it - so the caller's is the one checked.
  async function relist(parent, folderId, sinceMoves) {
    listings.delete(folderId);
    writes.set(folderId, writesTo(folderId) + 1);
    return listInto(parent, folderId, { fresh: true, sinceMoves });
  }

  /// Whether another entry in a folder already has this name. Case-insensitive, as a folder on
  /// Windows or a default macOS volume is - with the entry being renamed excepted, so a change of
  /// case alone is allowed.
  function nameTaken(parent, name, except) {
    const wanted = name.toLowerCase();
    for (const entry of entries.values()) {
      if (parentOf(entry.path) !== parent || entry.fileId === except) continue;
      if (entry.name.toLowerCase() === wanted) return true;
    }
    return false;
  }

  /// The name Drive is to hold for an entry the tree will show as `requested`, or null when no Drive
  /// name gives exactly that path. A Google Doc's path carries `.md` and its title does not; anything
  /// `displayNameFor` would show differently - a separator, a control character - would land the entry
  /// under another path than the one asked for.
  function driveNameFor(requested, mimeType) {
    const name = mimeType === GOOGLE_DOC_MIME ? (requested.endsWith(".md") ? requested.slice(0, -3) : null) : requested;
    if (name === null || displayNameFor({ name, mimeType }) !== requested) return null;
    return name;
  }

  return {
    id: ref.folderId,
    kind: "google-drive",

    async list(candidate) {
      const path = drivePath(candidate);
      if (path === null) return failure("permission-denied");

      let folderId = ref.folderId;
      if (path !== "") {
        const found = await ensure(path);
        if (!found.ok) return found;
        if (found.entry.kind !== "directory") return failure("not-found");
        folderId = found.entry.fileId;
      }

      const listed = await listInto(path, folderId);
      if (!listed.ok) return listed;
      return {
        ok: true,
        nodes: listed.children.map(treeNode),
      };
    },

    /// A folder as far as it is already known, with no request to Drive. The filter, Find in Files and
    /// the chat outline search through this, so a large Drive is never read all at once; `complete` is
    /// false for a folder nobody has opened, and they report the answer as partial.
    async listKnown(candidate) {
      const path = drivePath(candidate);
      if (path === null) return failure("permission-denied");
      if (!listedPaths.has(path)) return { ok: true, nodes: [], complete: false };
      const nodes = [...entries.values()]
        .filter((entry) => parentOf(entry.path) === path)
        .map(treeNode);
      return { ok: true, nodes, complete: true };
    },

    async read(candidate) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      const entry = found.entry;

      // The revision is asked for BEFORE the bytes, so any skew between them errs toward a conflict
      // the user is told about, never toward overwriting a change they have not seen.
      let revision = entry.revision ?? entry.fileId;
      if (!entry.googleDoc) {
        const meta = await api.fileMeta(entry.fileId);
        if (!meta.ok) return meta;
        if (meta.file.trashed === true) return failure("not-found");
        revision = meta.file.headRevisionId ?? revision;
      }

      const fetched = await bytesOf(entry, MAX_TEXT_FILE_BYTES);
      if (!fetched.ok) return fetched;
      const decoded = decodeTextFile(fetched.bytes);
      if (!decoded.ok) return failure(decoded.reason);
      boms.set(bomKey(entry.fileId, revision), decoded.bom);
      return {
        ok: true,
        content: decoded.content,
        revision: { id: revision },
        // A Google Doc is read as exported markdown; writing that back would turn it into another kind
        // of file.
        ...(entry.googleDoc ? { readOnly: true } : {}),
      };
    },

    async readBytes(candidate, limitBytes) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      return bytesOf(found.entry, limitBytes);
    },

    /// A file as a source of byte ranges, for the protocol that streams video and audio.
    ///
    /// The size is the LISTING's, so answering costs no request beyond the walk `read` already does:
    /// the player asks for ranges in quick succession and each one must not start with a metadata call.
    /// A file with no listed size - a Google Doc, or anything Drive did not size - cannot be ranged, so
    /// it is `not-found` rather than a stream of unknown length. The token stays in the api; what leaves
    /// here is a body.
    ///
    /// The parent is listed again through the TTL'd cache before the size is read. An entry on its own
    /// lives until its folder is next listed, which could be an hour; this makes the listing's TTL the
    /// limit on how stale a size can be, so a clip replaced in Drive is served at its new size within
    /// that, and one removed is `not-found`. Inside the TTL it costs nothing.
    async mediaSource(candidate) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      const path = found.entry.path;
      const parent = parentOf(path);
      const folder = await folderIdAt(parent);
      if (!folder.ok) return folder;
      const fresh = await listInto(parent, folder.id);
      if (!fresh.ok) return fresh;

      const entry = entries.get(path);
      if (entry === undefined || entry.kind !== "file") return failure("not-found");
      if (entry.googleDoc || entry.sizeBytes === null) return failure("not-found");

      return {
        ok: true,
        size: entry.sizeBytes,
        /// `signal` is the window's request: when the player gives up on a range - a fast seek, a
        /// closed tab - the Drive request behind it stops too, rather than running on to hand a body
        /// to nobody.
        open: async (start, end, signal) => {
          const ranged = await api.downloadRange(entry.fileId, start, end, { signal });
          if (!ranged.ok) return ranged;
          // Drive ignoring the Range answers 200 with the whole file. That is only a correct answer
          // to a range that IS the whole file; for any other, the protocol would label the full body
          // a 206 of the wrong length, so it is refused rather than passed on.
          if (ranged.status === 200 && end !== entry.sizeBytes - 1) {
            await ranged.body?.cancel().catch(() => {});
            return failure("offline");
          }
          return { ok: true, body: ranged.body };
        },
      };
    },

    /// Check, write, confirm. Drive has no conditional write, so the check is a request of its own: a
    /// save landing between the check and the write is overwritten. That window is one request long,
    /// and Drive's version history keeps what it replaced.
    ///
    /// `expected === null` on a path nobody has creates the file, as it does in a folder on disk -
    /// the chat's create-file tool relies on it.
    async write(candidate, content, expected) {
      const path = drivePath(candidate);
      if (path === null || path === "") return failure("permission-denied");

      const found = await ensure(path);
      if (!found.ok) return found.reason === "not-found" ? create(path, content, expected) : found;
      const entry = found.entry;
      if (entry.kind !== "file") return failure("permission-denied");
      if (entry.googleDoc) return failure("read-only");
      // A rename while this save is in Drive's hands can move `path` off this file; see step 3.
      const startedMoves = moves;

      // 1. Check.
      const meta = await api.fileMeta(entry.fileId);
      if (!meta.ok && meta.reason !== "not-found") return meta;
      const current = !meta.ok || meta.file.trashed === true ? null : (meta.file.headRevisionId ?? null);
      if (expected === null || current === null || current !== expected.id) return conflict(current);

      // 2. Write.
      const bom = boms.get(bomKey(entry.fileId, expected.id)) === true;
      const bytes = encodeTextFile(content, { bom });
      const uploaded = await api.uploadContent(entry.fileId, bytes, entry.mimeType);
      if (!uploaded.ok) return uploaded;

      // 3. Confirm: the revision is Drive's answer to the write, never a guess. Asking again would be
      // one too - by then it could be a concurrent writer's revision, and the next save would
      // overwrite them. The content landed, but as what Drive will not say, so it is unknown.
      const revision = uploaded.file.headRevisionId;
      if (revision === undefined) return failure("unknown");
      boms.set(bomKey(entry.fileId, revision), bom);

      // Only while `path` still names this file: renamed meanwhile - it, or a folder above it - the
      // path is dead, and setting it would give the live file a second one.
      if (moves === startedMoves || entries.get(path)?.fileId === entry.fileId) {
        entries.set(path, { ...entry, revision, sizeBytes: bytes.length });
      }
      const parent = await folderIdAt(parentOf(path));
      if (parent.ok) listings.delete(parent.id);
      return { ok: true, revision: { id: revision } };
    },

    /// A new folder, made the way `create` makes a file: its parent asked for afresh so a name Drive
    /// already has is seen, and listed again after so the new folder has its path. It is not counted
    /// as listed until somebody opens it.
    async createDirectory(candidate) {
      const path = drivePath(candidate);
      if (path === null || path === "") return failure("permission-denied");
      const parent = parentOf(path);
      // As in `create`: taken before `parent` is resolved, so a rename of it mid-request is seen.
      const sinceMoves = moves;
      const folder = await folderIdAt(parent);
      if (!folder.ok) return folder;

      const name = parent === "" ? path : path.slice(parent.length + 1);
      if (driveNameFor(name, FOLDER_MIME) === null) return failure("bad-request");

      const fresh = await relist(parent, folder.id, sinceMoves);
      if (!fresh.ok) return fresh;
      if (nameTaken(parent, name, null)) return failure("conflict");

      const created = await api.createFolder(folder.id, name);
      if (!created.ok) return created;
      // The folder landed whatever this answers; it only teaches the map its id.
      await relist(parent, folder.id, sinceMoves);
      return { ok: true };
    },

    /// A new name for a file or folder, in the folder it is already in. Answers its new
    /// workspace-relative path - for a Google Doc, `<title>.md`, the path it is opened by.
    ///
    /// What was known beneath a renamed folder moves with it (`rekeyKnown`), so what the user had
    /// expanded stays expanded and a known path under it is still found without asking Drive.
    async rename(candidate, requested) {
      const path = drivePath(candidate);
      // The workspace's own folder is what was opened; renaming it would pull the root out from under
      // every open path, exactly as on disk.
      if (path === null || path === "") return failure("permission-denied");
      const found = await ensure(path);
      if (!found.ok) return found;

      const driveName = driveNameFor(requested, found.entry.mimeType);
      if (driveName === null) return failure("bad-request");

      const parent = parentOf(path);
      // As in `create`: taken before `parent` is resolved, so a rename of it mid-request is seen. This
      // rename's own bump below is harmless - `parent` still names `folder.id` after it.
      const sinceMoves = moves;
      const folder = await folderIdAt(parent);
      if (!folder.ok) return folder;
      const fresh = await relist(parent, folder.id, sinceMoves);
      if (!fresh.ok) return fresh;
      const entry = entries.get(path);
      if (entry === undefined || entry.fileId !== found.entry.fileId) return failure("not-found");
      if (nameTaken(parent, requested, entry.fileId)) return failure("conflict");

      const renamed = await api.renameFile(entry.fileId, driveName);
      if (!renamed.ok) return renamed;

      const target = parent === "" ? requested : `${parent}/${requested}`;
      moves += 1;
      const moved = rekeyKnown(entries, listedPaths, path, target);
      entries.clear();
      for (const [key, value] of moved.entries) entries.set(key, value);
      listedPaths.clear();
      for (const key of moved.listedPaths) listedPaths.add(key);
      // The rename landed whatever this answers; it brings the parent's listing up to date.
      await relist(parent, folder.id, sinceMoves);
      return { ok: true, path: target };
    },

    /// Where an entry lives on the web, for Open in Google Drive. Built from ids that have passed
    /// `isDriveId`, so nothing but Drive's own alphabet is spliced into the address. The address stays
    /// in the main process: the shell opens it, the renderer never sees it.
    async webAddress(candidate) {
      const path = drivePath(candidate);
      if (path === null) return failure("permission-denied");
      if (path === "") {
        return isDriveId(ref.folderId) ? { ok: true, url: driveRootWebUrl(ref.folderId) } : failure("not-found");
      }
      const found = await ensure(path);
      if (!found.ok) return found;
      const { kind, fileId, googleDoc } = found.entry;
      if (!isDriveId(fileId)) return failure("not-found");
      return { ok: true, url: driveWebUrl({ kind, fileId, googleDoc }) };
    },

    async refresh() {
      generation += 1;
      entries.clear();
      listings.clear();
      listedPaths.clear();
      return { ok: true, truncated: false };
    },
  };
}

/// Opens a Drive folder: it must exist, be a folder, and not be in the trash. Answers its CURRENT
/// name - the one in the reference is what it was called when it was chosen.
///
/// A shared drive's root answers the generic name "Drive" to `files.get`; its real name is only in
/// `drives.get`, so that is asked, and the name it was chosen under stands in if the ask fails - a
/// name is not worth failing the open over. Also answers `variant`, what kind of place this is.
async function openGoogleDriveWorkspace({ ref, api, now, ttlMs }) {
  const meta = await api.fileMeta(ref.folderId);
  if (!meta.ok) return meta;
  if (meta.file.mimeType !== FOLDER_MIME || meta.file.trashed === true) return failure("not-found");

  // My Drive is opened by the alias "root", which means whichever account is connected. Its real id
  // is remembered on first open, and a later open whose real root differs is a different account.
  let openedRef = ref;
  if (ref.folderId === "root") {
    if (ref.rootId !== undefined && ref.rootId !== meta.file.id) return failure("other-account");
    openedRef = { ...ref, rootId: meta.file.id };
  }

  const sharedDriveRoot = ref.driveId !== undefined && ref.driveId === ref.folderId;
  let name = meta.file.name;
  if (sharedDriveRoot) {
    const drive = await api.sharedDrive(ref.driveId);
    name = drive.ok ? drive.drive.name : ref.name;
  }

  let variant = "folder";
  if (ref.folderId === "root") variant = "my-drive";
  else if (sharedDriveRoot) variant = "shared-drive";
  else if (meta.file.shared === true) variant = "shared-folder";

  return {
    ok: true,
    name,
    variant,
    ref: openedRef,
    provider: createGoogleDriveProvider({ ref: openedRef, api, now, ttlMs }),
  };
}

module.exports = { openGoogleDriveWorkspace, rekeyKnown, GUARD_ROOT };
