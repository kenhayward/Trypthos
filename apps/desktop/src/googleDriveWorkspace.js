"use strict";

const {
  FOLDER_MIME,
  MAX_TEXT_FILE_BYTES,
  childrenToEntries,
  createPathGuard,
  decodeTextFile,
  displayNameFor,
  encodeTextFile,
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

function parentOf(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
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
  /// Drive file id -> whether its text began with a byte-order mark when last read, so a save keeps it.
  const boms = new Map();

  /// The files of one folder: from the cache while it is fresh, else from Drive. A failure is passed
  /// on and never remembered.
  async function filesOf(folderId) {
    const cached = listings.get(folderId);
    if (cached !== undefined && cached.generation === generation && now() - cached.at < ttlMs) {
      return { ok: true, files: cached.files };
    }
    const joined = inFlight.get(folderId);
    if (joined !== undefined && joined.generation === generation) return joined.promise;

    const started = generation;
    const pending = { generation: started, promise: null };
    pending.promise = (async () => {
      try {
        const listed = await api.listChildren(folderId);
        if (listed.ok && started === generation) {
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
  async function listInto(path, folderId) {
    const started = generation;
    const listed = await filesOf(folderId);
    if (!listed.ok) return listed;
    // A refresh while this listing was in flight: what arrived predates it, so ask again.
    if (generation !== started) return listInto(path, folderId);

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

  function conflict(current) {
    return { ok: false, reason: "conflict", theirs: current === null ? null : { id: current } };
  }

  /// A new file at a path nobody has: created in its folder, under exactly the name the path gives.
  async function create(path, content, expected) {
    // A revision expected of a file that is not there: it was deleted, or never existed.
    if (expected !== null) return conflict(null);
    const parent = parentOf(path);
    const folder = await folderIdAt(parent);
    if (!folder.ok) return folder;

    const name = parent === "" ? path : path.slice(parent.length + 1);
    const mimeType = textMimeFor(name);
    // A name the tree would show differently would land the file under another path than the one
    // asked for.
    if (displayNameFor({ name, mimeType }) !== name) return failure("bad-request");

    // The cached listing can predate a file Drive already has under this name. Creating a second one
    // would leave the path naming the older file, so the folder is asked for afresh first.
    listings.delete(folder.id);
    const fresh = await listInto(parent, folder.id);
    if (!fresh.ok) return fresh;
    const existing = entries.get(path);
    if (existing !== undefined) return existing.kind === "file" ? conflict(existing.revision) : failure("permission-denied");

    const created = await api.createFile(folder.id, name, encodeTextFile(content, { bom: false }), mimeType);
    if (!created.ok) return created;
    listings.delete(folder.id);
    // Re-listed so the new file has its path in the map; the file landed whatever this answers.
    await listInto(parent, folder.id);
    return { ok: true, revision: { id: created.file.headRevisionId ?? created.file.id } };
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
        nodes: listed.children.map((child) => ({ id: child.path, name: child.name, kind: child.kind })),
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
        .map((entry) => ({ id: entry.path, name: entry.name, kind: entry.kind }));
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
      boms.set(entry.fileId, decoded.bom);
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

      // 1. Check.
      const meta = await api.fileMeta(entry.fileId);
      if (!meta.ok && meta.reason !== "not-found") return meta;
      const current = !meta.ok || meta.file.trashed === true ? null : (meta.file.headRevisionId ?? null);
      if (expected === null || current === null || current !== expected.id) return conflict(current);

      // 2. Write.
      const bytes = encodeTextFile(content, { bom: boms.get(entry.fileId) === true });
      const uploaded = await api.uploadContent(entry.fileId, bytes, entry.mimeType);
      if (!uploaded.ok) return uploaded;

      // 3. Confirm: the revision is Drive's answer to the write, never a guess.
      let revision = uploaded.file.headRevisionId;
      if (revision === undefined) {
        const after = await api.fileMeta(entry.fileId);
        revision = after.ok ? after.file.headRevisionId : undefined;
      }
      // The content landed but Drive will not say as what; reporting success with a made-up revision
      // would let the next save overwrite blindly, so it is reported as unknown instead.
      if (revision === undefined) return failure("unknown");

      entries.set(path, { ...entry, revision, sizeBytes: bytes.length });
      const parent = await folderIdAt(parentOf(path));
      if (parent.ok) listings.delete(parent.id);
      return { ok: true, revision: { id: revision } };
    },

    async refresh() {
      generation += 1;
      boms.clear();
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

module.exports = { openGoogleDriveWorkspace, GUARD_ROOT };
