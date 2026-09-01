"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

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

    async read(relativePath) {
      const resolved = await resolve(relativePath, { mustExist: true });
      if (!resolved.ok) return resolved;

      try {
        const [content, stats] = await Promise.all([
          fs.readFile(resolved.path, "utf8"),
          fs.stat(resolved.path),
        ]);
        return { ok: true, content, revision: revisionOf(stats) };
      } catch (error) {
        return mapError(error);
      }
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

      try {
        await fs.writeFile(resolved.path, content, "utf8");
        return { ok: true, revision: revisionOf(await fs.stat(resolved.path)) };
      } catch (error) {
        return mapError(error);
      }
    },
  };
}

module.exports = { createLocalWorkspace, revisionOf };
