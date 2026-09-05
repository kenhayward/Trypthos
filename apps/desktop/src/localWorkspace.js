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

    async write(relativePath, content, expectedRevision) {
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
      if (current === null && expectedRevision !== null) {
        return failure("not-found");
      }
      if (current !== null && expectedRevision === null) {
        return { ok: false, reason: "conflict", theirs: current };
      }
      if (current !== null && expectedRevision !== null && current.id !== expectedRevision.id) {
        return { ok: false, reason: "conflict", theirs: current };
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
