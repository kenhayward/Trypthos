"use strict";

const {
  FOLDER_MIME,
  MAX_TEXT_FILE_BYTES,
  childrenToEntries,
  createPathGuard,
  decodeTextFile,
} = require("@trypthos/domain");

/// A Google Drive folder, as a workspace.
///
/// Drive names a file by id; the tree, the editor, recent files and wiki links all name it by path.
/// This keeps the map between the two, filled as folders are listed (`childrenToEntries` decides the
/// names) and walked on demand for a path no listing has reached yet - a restored tab, a followed
/// link. Read-only in this release: `write` refuses.
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

function createGoogleDriveProvider({ ref, api }) {
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

  /// Lists one folder and records its children, replacing only that folder's direct children - what
  /// is known about the folders below them stays.
  async function listInto(path, folderId) {
    const listed = await api.listChildren(folderId);
    if (!listed.ok) return listed;

    for (const key of [...entries.keys()]) {
      if (parentOf(key) === path) entries.delete(key);
    }
    const children = childrenToEntries(path, listed.files);
    for (const child of children) entries.set(child.path, child);
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

    async read(candidate) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      const fetched = await bytesOf(found.entry, MAX_TEXT_FILE_BYTES);
      if (!fetched.ok) return fetched;
      const decoded = decodeTextFile(fetched.bytes);
      if (!decoded.ok) return failure(decoded.reason);
      return { ok: true, content: decoded.content, revision: { id: found.entry.revision ?? found.entry.fileId } };
    },

    async readBytes(candidate, limitBytes) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      return bytesOf(found.entry, limitBytes);
    },

    /// Saving to Drive is the next release. Refused here as well as in the interface, because the
    /// chat's tools write through the provider too.
    async write() {
      return failure("read-only");
    },

    async refresh() {
      entries.clear();
      return { ok: true, truncated: false };
    },
  };
}

/// Opens a Drive folder: it must exist, be a folder, and not be in the trash. Answers its CURRENT
/// name - the one in the reference is what it was called when it was chosen.
async function openGoogleDriveWorkspace({ ref, api }) {
  const meta = await api.fileMeta(ref.folderId);
  if (!meta.ok) return meta;
  if (meta.file.mimeType !== FOLDER_MIME || meta.file.trashed === true) return failure("not-found");
  return { ok: true, name: meta.file.name, provider: createGoogleDriveProvider({ ref, api }) };
}

module.exports = { openGoogleDriveWorkspace, GUARD_ROOT };
