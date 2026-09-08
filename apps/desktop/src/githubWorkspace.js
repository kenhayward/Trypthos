"use strict";

const {
  MAX_TEXT_FILE_BYTES,
  blobEntryFor,
  createPathGuard,
  decodeTextFile,
  treeNodesAt,
} = require("@trypthos/domain");

/// The GitHub backend: a repository at one commit, read-only.
///
/// **It answers in exactly the shapes the local backend does.** The tree, the filter box, Find in
/// Files and the editor's read path were all written against `localWorkspace.js` and are untouched
/// by this feature - which only works because a listing here is `{ ok, nodes }` with the same node
/// shape, a read is `{ ok, content, revision }`, and a refusal is one of the same reasons. Any new
/// provider has this as its contract.
///
/// **The whole tree is fetched once, at open.** GitHub will describe every path in a repository in
/// one request, so every listing after that is a read of memory. The alternative - a request per
/// folder - would make expanding the browser slow, and would make the filter box, which walks every
/// folder, spend an hourly budget on a single keystroke.
///
/// **It is pinned to a commit, not a branch.** Somebody pushing while the user reads would otherwise
/// change the tree under them, and the file they clicked would not be the file they were shown.
///
/// **Nothing here writes.** A save to GitHub is a commit on a branch, with history and merge
/// conflicts rather than overwrite, and that is a feature rather than a line of code. Until it
/// exists, `write` refuses - an editor that reported a save it never made is precisely the failure
/// the revision mechanism exists to prevent.

/// The root the path guard measures against.
///
/// A repository has no root on disk, so this is a name rather than a place - but the guard's job
/// here is the same as everywhere else: reject `..`, absolute, drive-relative and UNC paths before
/// anything is addressed. **The check is the domain's shared guard and never a copy**, which is the
/// rule that stops one provider's boundary being subtly weaker than another's.
///
/// Case-sensitive, because git is: `README.md` and `readme.md` really are two files in a repository.
const GUARD_ROOT = "/repo";

/// How many file bodies to keep. Find in Files reads every document under a folder, and doing that
/// over the network twice is the difference between a search and a wait. Bounded because a
/// repository can be larger than memory - oldest out first, which is insertion order in a Map.
const BLOB_CACHE_LIMIT = 128;

function failure(reason) {
  return { ok: false, reason };
}

function createGitHubProvider({ ref, api, entries }) {
  const guard = createPathGuard({ root: GUARD_ROOT, caseInsensitive: false });
  const cache = new Map();

  /// A path from the renderer, as a path inside the repository - or null when it is not one.
  ///
  /// The guard answers with an absolute path under `GUARD_ROOT`, and what is wanted is the part
  /// after it. "" is the repository root, which is a real answer rather than a refusal: it is what
  /// the browser lists when a workspace is opened.
  function repoPath(candidate) {
    const resolved = guard.resolve(candidate === "" ? "." : candidate);
    if (!resolved.ok) return null;
    if (resolved.path === GUARD_ROOT) return "";
    return resolved.path.slice(GUARD_ROOT.length + 1);
  }

  /// One file's bytes, fetched once.
  async function bytesFor(sha) {
    const held = cache.get(sha);
    if (held !== undefined) return { ok: true, bytes: held };

    const fetched = await api.blob(ref.owner, ref.repo, sha);
    if (!fetched.ok) return fetched;

    if (cache.size >= BLOB_CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(sha, fetched.bytes);
    return fetched;
  }

  /// The blob a path names, with its size, or the refusal that says why not.
  ///
  /// One place, because `read` and `readBytes` must agree about what exists: a picture the browser
  /// lists and the editor refuses would be a file that is there until you click it.
  function locate(relativePath) {
    const path = repoPath(relativePath);
    if (path === null || path === "") return failure("permission-denied");

    const blob = blobEntryFor(entries, path);
    // Not in the tree, a directory, or a symlink - the same three things `list` declines to offer,
    // so what can be clicked and what can be read are the same set.
    return blob === null ? failure("not-found") : { ok: true, blob };
  }

  return {
    id: `${ref.owner}/${ref.repo}`,
    kind: "github",

    async list(relativePath) {
      const path = repoPath(relativePath ?? "");
      if (path === null) return failure("permission-denied");

      return { ok: true, nodes: treeNodesAt(entries, path) };
    },

    /// Reads a document, or refuses it.
    ///
    /// The same three refusals the local backend makes, in the same order and for the same reasons -
    /// and the size check happens BEFORE the fetch, which it can because the tree already carries
    /// every file's size. A file too large to open never has to be downloaded to establish that.
    async read(relativePath) {
      const found = locate(relativePath);
      if (!found.ok) return found;

      const { sha, size } = found.blob;
      if (size !== null && size > MAX_TEXT_FILE_BYTES) {
        return { ok: false, reason: "too-large", sizeBytes: size, limitBytes: MAX_TEXT_FILE_BYTES };
      }

      const fetched = await bytesFor(sha);
      if (!fetched.ok) return fetched;

      const decoded = decodeTextFile(fetched.bytes);
      if (!decoded.ok) return failure(decoded.reason);

      // The blob's sha IS the revision, and it is a better one than the local backend can manage: it
      // identifies the CONTENT, so it is the same for two identical files and changes for no other
      // reason. When writing arrives, this is what a conditional commit presents.
      return { ok: true, content: decoded.content, revision: { id: sha } };
    },

    /// Bytes, with no opinion about what they mean. The image handler's read - see the local
    /// backend's note on why this is a separate call rather than a flag on `read`.
    async readBytes(relativePath, limitBytes) {
      const found = locate(relativePath);
      if (!found.ok) return found;

      const { sha, size } = found.blob;
      if (size !== null && size > limitBytes) {
        return { ok: false, reason: "too-large", sizeBytes: size, limitBytes };
      }

      return await bytesFor(sha);
    },

    /// Refused, and refused honestly. See the note at the top of this file.
    async write() {
      return failure("unsupported");
    },
  };
}

/// Opens a repository, or explains why it could not be.
///
/// A result rather than a provider that fails on its first listing: a repository that is not there,
/// or a token that has been revoked, is something the user has to be told at the moment they asked -
/// not something they discover as an empty tree.
async function openGitHubWorkspace({ ref, api }) {
  const head = await api.defaultBranchHead(ref.owner, ref.repo);
  if (!head.ok) return head;

  const tree = await api.tree(ref.owner, ref.repo, head.sha);
  if (!tree.ok) return tree;

  return {
    ok: true,
    branch: head.branch,
    sha: head.sha,
    /// True when GitHub could not describe the whole repository in one answer. Carried rather than
    /// hidden: a tree cut short has folders missing from it, and a browser that showed less than the
    /// repository holds without saying so would be wrong rather than incomplete.
    truncated: tree.truncated,
    provider: createGitHubProvider({ ref, api, entries: tree.entries }),
  };
}

module.exports = { openGitHubWorkspace, GUARD_ROOT };
