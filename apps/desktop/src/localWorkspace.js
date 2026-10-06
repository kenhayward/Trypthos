"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  MAX_TEXT_FILE_BYTES,
  decodeTextFile,
  encodeTextFile,
  hasUtf8Bom,
} = require("@trypthos/domain");

/// The local filesystem backend.
///
/// Every path that arrives here comes from the renderer and is therefore untrusted. Two checks, and
/// both are needed:
///
///  1. The lexical guard (domain `createPathGuard`) rejects traversal, absolute, drive-relative and
///     UNC paths before any syscall.
///  2. `realpath` on the result, checked against the root again. The lexical guard cannot see
///     symlinks - it has no filesystem access by design - and `notes.md` satisfies it perfectly while
///     pointing at /etc/passwd. This second check is where that is caught.
///
/// Dropping either leaves a hole, and the hole is invisible in ordinary use.

/// mtime and size together. Cheap to obtain, and changes whenever a write lands - which is all a
/// conflict check needs. Opaque to callers: never parsed, only compared.
function revisionOf(stats) {
  return { id: `${Math.trunc(stats.mtimeMs)}-${stats.size}` };
}

function failure(reason) {
  return { ok: false, reason };
}

/// Maps a filesystem error to the provider's vocabulary. Anything unrecognised is rethrown rather
/// than flattened into a plausible-looking reason - a surprising errno should reach the log, not be
/// reported to the user as "not found".
function mapError(error) {
  if (error.code === "ENOENT") return failure("not-found");
  if (error.code === "EEXIST") return failure("conflict");
  if (error.code === "EACCES" || error.code === "EPERM") return failure("permission-denied");
  if (error.code === "ENOTDIR") return failure("not-found");
  throw error;
}

/// Whether the file already on disk begins with a UTF-8 byte order mark.
///
/// Three bytes through a handle rather than `readFile`: the file can be megabytes, and all that is
/// wanted is its first three. A file that cannot be opened has no mark to preserve - and if that is
/// a real problem it is one the write below reports properly.
async function existingBom(filePath) {
  let handle = null;
  try {
    handle = await fs.open(filePath, "r");
    const head = Buffer.alloc(3);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return hasUtf8Bom(head.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    if (handle !== null) await handle.close();
  }
}

function createLocalWorkspace({ root, guard }) {
  /// Resolves a workspace-relative path to a real one inside the root, or explains the refusal.
  async function resolve(relativePath, { mustExist }) {
    const lexical = guard.resolve(relativePath);
    if (!lexical.ok) return failure("permission-denied");

    const absolute = path.resolve(root, relativePath);

    let real;
    try {
      real = await fs.realpath(absolute);
    } catch (error) {
      if (error.code === "ENOENT" && !mustExist) {
        // A file being created does not exist yet, so its own realpath cannot be taken. Its parent
        // must still be inside the workspace, which is the check that matters.
        const parent = await fs.realpath(path.dirname(absolute)).catch(() => null);
        if (parent === null || !guard.contains(parent)) return failure("permission-denied");
        return { ok: true, path: absolute };
      }
      return mapError(error);
    }

    // The realpath check, not the lexical one. This is the line that stops a symlink out of the
    // workspace, and it must compare the RESOLVED path.
    if (!guard.contains(real)) return failure("permission-denied");
    return { ok: true, path: real };
  }

  return {
    id: "local",
    kind: "local",

    async list(relativePath) {
      const resolved = await resolve(relativePath || ".", { mustExist: true });
      if (!resolved.ok) return resolved;

      let entries;
      try {
        entries = await fs.readdir(resolved.path, { withFileTypes: true });
      } catch (error) {
        return mapError(error);
      }

      const nodes = entries
        // Symlinks are listed as neither file nor directory rather than followed. Following one here
        // would put its target's contents inside the tree under a name that is inside the workspace.
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
          id: relativePath ? `${relativePath}/${entry.name}` : entry.name,
        }));

      return { ok: true, nodes };
    },

    /// Makes one directory and never fills in missing parents. The resolved parent is checked
    /// before the syscall, so a path that exists only through a symlink outside the workspace is
    /// refused just as a file write there would be.
    async createDirectory(relativePath) {
      const resolved = await resolve(relativePath, { mustExist: false });
      if (!resolved.ok) return resolved;

      try {
        await fs.mkdir(resolved.path);
        return { ok: true };
      } catch (error) {
        return mapError(error);
      }
    },

    /// Gives one file or folder a new name in the folder it is already in, and answers with its new
    /// workspace-relative path.
    ///
    /// The ENTRY is renamed, never what a link points at: its parent is resolved and checked, and
    /// the entry itself is looked at with `lstat`. A link is refused outright - the tree never lists
    /// one, so nothing the user can see is asking for it.
    ///
    /// `fs.rename` replaces an existing file without a word on every platform, so whether the name is
    /// free is checked first. The one existing entry allowed is the entry itself, reached by a name
    /// that differs only in case - which Windows and a default macOS volume treat as the same file,
    /// and which is exactly how a user fixes the case of a name.
    async rename(relativePath, name) {
      const lexical = guard.resolve(relativePath);
      if (!lexical.ok) return failure("permission-denied");

      const absolute = path.resolve(root, relativePath);
      // The workspace folder is what the app opened, and renaming it would pull the root out from
      // under every open path. Refused however it is spelled.
      if (path.relative(root, absolute) === "") return failure("permission-denied");

      const target = path.join(path.dirname(relativePath), name).split(path.sep).join("/");
      if (!guard.resolve(target).ok || path.dirname(path.resolve(root, target)) !== path.dirname(absolute)) {
        return failure("permission-denied");
      }

      let parent;
      try {
        parent = await fs.realpath(path.dirname(absolute));
      } catch (error) {
        return mapError(error);
      }
      if (!guard.contains(parent)) return failure("permission-denied");

      const from = path.join(parent, path.basename(absolute));
      const to = path.join(parent, name);

      let source;
      try {
        source = await fs.lstat(from, { bigint: true });
      } catch (error) {
        return mapError(error);
      }
      if (source.isSymbolicLink()) return failure("permission-denied");

      try {
        const existing = await fs.lstat(to, { bigint: true });
        const itself = existing.ino === source.ino && existing.dev === source.dev;
        if (!itself) return failure("conflict");
      } catch (error) {
        if (error.code !== "ENOENT") return mapError(error);
      }

      try {
        await fs.rename(from, to);
      } catch (error) {
        return mapError(error);
      }
      return { ok: true, path: target.startsWith("./") ? target.slice(2) : target };
    },

    /// Where one entry is on disk, and whether it is a file or a folder - for showing it in the
    /// operating system's file manager. The same guard as a read, so the answer is never a path
    /// outside the workspace.
    async locate(relativePath) {
      const resolved = await resolve(relativePath || ".", { mustExist: true });
      if (!resolved.ok) return resolved;

      try {
        const stats = await fs.stat(resolved.path);
        return { ok: true, path: resolved.path, kind: stats.isDirectory() ? "directory" : "file" };
      } catch (error) {
        return mapError(error);
      }
    },

    /// Where a FILE is, and how big, for the one caller that must stream rather than read.
    ///
    /// The media protocol serves byte ranges out of a file that may be gigabytes, so it cannot go
    /// through `readBytes` - that answers with the whole thing in memory, which is the very thing
    /// a streaming transport exists to avoid. What it needs is a path it is allowed to open, and
    /// granting that permission is this function's whole purpose.
    ///
    /// Its own method rather than a flag on `locate` above, because the two answer different
    /// questions: `locate` is for showing an entry in the operating system's file manager, so a
    /// FOLDER is a perfectly good answer there and is refused here. One function returning either
    /// shape would make every caller check which it got.
    ///
    /// **The boundary is unchanged.** Same `resolve`, so the same lexical guard and the same
    /// realpath check that stops a symlink out of the workspace. A streaming caller gets no cheaper
    /// check than a reading one - which matters more here than anywhere, because this is a second
    /// route out of the shell.
    ///
    /// The size comes back with the path because a range response needs both, and asking twice is
    /// two answers about a file that can change in between.
    ///
    /// Deliberately absent from the GitHub provider: a repository's blobs arrive base64 over an API
    /// with no ranges, so playback is unavailable there and this absence (with no `mediaSource`
    /// either) is the one place that says so. Google Drive streams through its own `mediaSource`.
    async locateFile(relativePath) {
      const resolved = await resolve(relativePath, { mustExist: true });
      if (!resolved.ok) return resolved;

      try {
        const stats = await fs.stat(resolved.path);
        if (!stats.isFile()) return failure("not-found");
        return { ok: true, path: resolved.path, size: stats.size };
      } catch (error) {
        return mapError(error);
      }
    },

    /// Reads a file, or refuses it.
    ///
    /// Three refusals live here rather than in the renderer, because the renderer only ever sees
    /// what this hands it: by the time bytes have become a string, the damage this is guarding
    /// against has already been done.
    async read(relativePath) {
      const resolved = await resolve(relativePath, { mustExist: true });
      if (!resolved.ok) return resolved;

      let stats;
      try {
        stats = await fs.stat(resolved.path);
      } catch (error) {
        return mapError(error);
      }

      // BEFORE the read, which is the whole point: a file this large must never become a string,
      // cross IPC, and reach CodeMirror. Failing afterwards would be failing after the harm.
      if (stats.size > MAX_TEXT_FILE_BYTES) {
        return {
          ok: false,
          reason: "too-large",
          sizeBytes: stats.size,
          limitBytes: MAX_TEXT_FILE_BYTES,
        };
      }

      let bytes;
      try {
        // No encoding, so node hands over the bytes rather than a lossy decode of them. `utf8` here
        // was the bug: it substitutes U+FFFD silently, and the next save writes the substitution.
        bytes = await fs.readFile(resolved.path);
      } catch (error) {
        return mapError(error);
      }

      const decoded = decodeTextFile(bytes);
      if (!decoded.ok) return failure(decoded.reason);

      // The revision from the stat taken BEFORE the read, deliberately. If the file changed in
      // between, this one is stale - and a stale revision makes the next save report a conflict,
      // where a fresh one would accept the save and overwrite whatever arrived.
      return { ok: true, content: decoded.content, revision: revisionOf(stats) };
    },

    /// Reads a file as BYTES, without deciding what they mean.
    ///
    /// Separate from `read` because `read` decodes: it refuses anything binary, which is exactly
    /// right for a document and exactly wrong for a picture. This one has no opinion about the
    /// contents at all, so its caller has to be the one that knows what it is asking for - which is
    /// why the only caller is the image handler, which decides from the file's NAME.
    ///
    /// The boundary is unchanged. Same `resolve`, same lexical guard, same realpath check.
    async readBytes(relativePath, limitBytes) {
      const resolved = await resolve(relativePath, { mustExist: true });
      if (!resolved.ok) return resolved;

      let stats;
      try {
        stats = await fs.stat(resolved.path);
      } catch (error) {
        return mapError(error);
      }

      // BEFORE the read, as with text: a file this large must never become a string and cross IPC.
      if (stats.size > limitBytes) {
        return { ok: false, reason: "too-large", sizeBytes: stats.size, limitBytes };
      }

      try {
        return { ok: true, bytes: await fs.readFile(resolved.path) };
      } catch (error) {
        return mapError(error);
      }
    },

    /// Writes a file, refusing anything that would overwrite a change the caller has not seen.
    ///
    /// `overwrite` is the one way past that, and it means "the user has already been asked". A
    /// native save dialog that offered to replace a file and was told yes IS the answer the conflict
    /// check exists to obtain, so demanding it again would be asking the same question twice and
    /// refusing the second answer. Nothing the renderer sends can set it: `WriteRequest` has no such
    /// field, and the only caller that passes it is the Save As handler, on this side of the
    /// boundary, holding a path that came from the dialog rather than from a page.
    ///
    /// The boundary check is NOT waived by it. Where a file may be written is not the user's to
    /// answer in a dialog.
    async write(relativePath, content, expectedRevision, { overwrite = false } = {}) {
      const resolved = await resolve(relativePath, { mustExist: false });
      if (!resolved.ok) return resolved;

      let current = null;
      try {
        current = revisionOf(await fs.stat(resolved.path));
      } catch (error) {
        if (error.code !== "ENOENT") return mapError(error);
      }

      // Both directions are conflicts, and both are reported rather than resolved. The editor must
      // never report a save that did not happen, and which version wins is the user's decision.
      if (!overwrite) {
        if (current === null && expectedRevision !== null) {
          return failure("not-found");
        }
        if (current !== null && expectedRevision === null) {
          return { ok: false, reason: "conflict", theirs: current };
        }
        if (current !== null && expectedRevision !== null && current.id !== expectedRevision.id) {
          return { ok: false, reason: "conflict", theirs: current };
        }
      }

      // A mark the editor never showed must not be lost by saving. Read from the file on disk at
      // the moment of writing, never carried by the renderer: the renderer is untrusted, and it has
      // no business asserting a file's encoding. A file being created has no mark.
      const bom = current === null ? false : await existingBom(resolved.path);

      try {
        await fs.writeFile(resolved.path, encodeTextFile(content, { bom }));
        return { ok: true, revision: revisionOf(await fs.stat(resolved.path)) };
      } catch (error) {
        return mapError(error);
      }
    },
  };
}

module.exports = { createLocalWorkspace, revisionOf };
