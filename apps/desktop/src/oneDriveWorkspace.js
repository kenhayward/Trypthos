"use strict";

const {
  MAX_TEXT_FILE_BYTES,
  createPathGuard,
  decodeTextFile,
  oneDriveEntriesOf,
  oneDrivePathKey,
  sameOneDriveId,
} = require("@trypthos/domain");

/// A OneDrive folder, as a workspace. Read-only in this release: saving, New File, New Folder and
/// rename are PR 3 (docs/specs/onedrive-workspace.md).
///
/// OneDrive addresses an item by its path below another and refuses two names in one folder, so -
/// unlike Google Drive - there is no map from paths to ids, no duplicate-name suffix and no re-keying.
/// Every request names its item by the workspace root's id plus the workspace-relative path, after the
/// shared path guard has resolved that path over a root that exists nowhere (GitHub's `/repo`, Drive's
/// `/drive`): `..`, absolute, drive-qualified and UNC paths are refused here exactly as they are for a
/// folder on disk, before anything is asked of Graph.
///
/// A read asks for the item's content tag BEFORE its bytes, so the revision the editor holds is never
/// newer than what it read. Media streams from the pre-authenticated address Graph's 302 names, kept
/// per file until it expires; neither it nor the token ever leaves the main process.

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
  /// Item id -> the pre-authenticated address its bytes were last fetched from.
  const locations = new Map();
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
    const pending = { generation: started, promise: null };
    pending.promise = (async () => {
      try {
        const listed = await api.children(ref.driveId, ref.itemId, path);
        if (!listed.ok) return listed;
        const entries = oneDriveEntriesOf(listed.items);
        if (started === generation) listings.set(key, { at: now(), generation: started, entries });
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
    /// is false for a folder nobody has opened since the last refresh.
    async listKnown(candidate) {
      const path = relativePath(candidate);
      if (path === null) return failure("permission-denied");
      const known = listings.get(oneDrivePathKey(path));
      if (known === undefined || known.generation !== generation) return { ok: true, nodes: [], complete: false };
      return { ok: true, nodes: known.entries.map((entry) => treeNode(path, entry)), complete: true };
    },

    /// Read-only in this release: the shell says so per file, and the editor offers no save.
    async read(candidate) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      // The content tag is the revision a save in PR 3 presents with If-Match. A file without one has
      // nothing honest to hand the editor.
      if (typeof found.item.cTag !== "string") return failure("unknown");
      const fetched = await bytesOf(found.item, MAX_TEXT_FILE_BYTES);
      if (!fetched.ok) return fetched;
      const decoded = decodeTextFile(fetched.bytes);
      if (!decoded.ok) return failure(decoded.reason);
      return { ok: true, content: decoded.content, revision: { id: found.item.cTag }, readOnly: true };
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

    /// Nothing is written to OneDrive in this release. `file:write`, Save As and the chat's
    /// create-file tool all call this, so it exists and refuses, as Drive's did in its PR 2.
    async write() {
      return failure("read-only");
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
