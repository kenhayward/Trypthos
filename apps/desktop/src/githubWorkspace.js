"use strict";

const {
  MAX_TEXT_FILE_BYTES,
  blobEntryFor,
  createPathGuard,
  decodeTextFile,
  encodeTextFile,
  hasUtf8Bom,
  treeNodesAt,
} = require("@trypthos/domain");

/// The GitHub backend: a repository at one commit.
///
/// **It answers in exactly the shapes the local backend does.** The tree, the filter box, Find in
/// Files and the editor's read path were all written against `localWorkspace.js` and are untouched
/// by this feature - which only works because a listing here is `{ ok, nodes }` with the same node
/// shape, a read is `{ ok, content, revision }`, and a refusal is one of the same reasons. Any new
/// provider has this as its contract.
///
/// **The whole tree is fetched once, at open** - and again only when a refresh finds the branch has
/// moved on. GitHub will describe every path in a repository in
/// one request, so every listing after that is a read of memory. The alternative - a request per
/// folder - would make expanding the browser slow, and would make the filter box, which walks every
/// folder, spend an hourly budget on a single keystroke.
///
/// **It is pinned to a commit, not a branch.** Somebody pushing while the user reads would otherwise
/// change the tree under them, and the file they clicked would not be the file they were shown. The
/// pin moves only when the user asks - Refresh, after a confirmation that says what it changes - or
/// when a commit of their own lands.
///
/// **A save here is a commit on a branch**, with history and merge conflicts rather than overwrite.
/// There is no separate push - GitHub's Contents endpoint commits on the server - so the awkward
/// part is not the request but everything the workspace has to put right afterwards: the pin has
/// moved and the tree in memory is stale for the path just written. Leave those and the next read
/// fetches the blob from BEFORE the save, which is the editor reporting a save it did not make by
/// another route.
///
/// **Nothing is committed until the user has said where.** `writeBranch` starts null and a write
/// refuses until it is not, because committing to the default branch by default is how somebody
/// pushes to main without meaning to.

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

function createGitHubProvider({ ref, api, entries, branch, sha, truncated = false }) {
  const guard = createPathGuard({ root: GUARD_ROOT, caseInsensitive: false });
  const cache = new Map();

  /// Everything about this repository that a commit changes.
  ///
  /// **The tree and the pin are held, not fetched**, which is what makes every listing a read of
  /// memory - and what makes a commit something this object has to put right afterwards rather than
  /// something it can forget about. `tree` is replaced when a branch is switched to or the workspace
  /// is refreshed; `head` moves with every commit; `writeBranch` is null until the user has said
  /// where their saves go. `truncated` belongs to the tree, so it moves when the tree does.
  let state = { tree: entries, head: sha, readingBranch: branch, writeBranch: null, truncated };

  /// Where a save goes, and where the tree came from.
  ///
  /// Two branches rather than one because they are only the same once somebody has chosen. A
  /// repository opens on its default branch and commits nowhere; the dialog is what settles it, and
  /// the dialog needs to know both to ask a sensible question.
  function writeTarget() {
    return { branch: state.writeBranch, readingBranch: state.readingBranch };
  }

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

    const blob = blobEntryFor(state.tree, path);
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

      return { ok: true, nodes: treeNodesAt(state.tree, path) };
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

    writeTarget,

    /// The branch being read and the commit the workspace is pinned to. What the repository page
    /// describes, and asks GitHub how far behind it is.
    pin() {
      return { branch: state.readingBranch, sha: state.head };
    },

    /// Moves the pin to the newest commit on the branch being read, and takes the tree with it.
    ///
    /// The one deliberate exception to being pinned: the user asked for what has been pushed since.
    /// **The branch being read, not the default one** - after a branch has been chosen for saves that
    /// is where the workspace stands, and a refresh that went back to main would move the tree away
    /// from the commits it is about to make.
    ///
    /// Where saves go is untouched. A document already open keeps the revision it was read at; if
    /// that file has changed on the branch, its next save conflicts, which is the right answer and the
    /// one the user has to be given rather than a silent overwrite.
    ///
    /// **All or nothing.** The tree and the commit it describes move together: a pin advanced over a
    /// tree that never arrived would list one commit's files while reading another's.
    async refresh() {
      const head = await api.branchHead(ref.owner, ref.repo, state.readingBranch);
      if (!head.ok) return head;

      // Nobody has pushed since. The tree in hand is the right one, and it is the largest thing
      // asked of GitHub - so it is not asked for again.
      if (head.sha === state.head) return { ok: true, truncated: state.truncated };

      const fetched = await api.tree(ref.owner, ref.repo, head.sha);
      if (!fetched.ok) return fetched;

      state = { ...state, tree: fetched.entries, head: head.sha, truncated: fetched.truncated };
      return { ok: true, truncated: fetched.truncated };
    },

    /// Cuts a branch at the commit this workspace stands on, and commits there from now on.
    ///
    /// **From the pinned commit, not from the branch's head.** The tree in memory describes that
    /// commit, so a branch cut anywhere else would be a branch whose files are not the files on
    /// screen - and the first save would conflict against a change nobody made here.
    ///
    /// Nothing is refetched: the new branch points at the same commit, so the tree already in hand
    /// is the right one.
    async startBranch(name) {
      const created = await api.createBranch(ref.owner, ref.repo, name, state.head);
      if (!created.ok) return created;

      state = { ...state, writeBranch: created.branch, readingBranch: created.branch };
      return { ok: true, branch: created.branch };
    },

    /// Moves to a branch that already exists, and takes the workspace with it.
    ///
    /// Not the same act as cutting one. That branch is at a different commit, so its tree is a
    /// different tree and has to be fetched - and the workspace FOLLOWS, because commits going
    /// somewhere the browser cannot see is how Find in Files ends up searching one branch while the
    /// edits live on another.
    ///
    /// A document open from the old branch keeps its text and its revision. If that file differs on
    /// this branch the next save conflicts, which is the correct answer and the one the user has to
    /// be given rather than a silent overwrite.
    async useBranch(name) {
      const listed = await api.branches(ref.owner, ref.repo);
      if (!listed.ok) return listed;

      const found = listed.branches.find((branch) => branch.name === name);
      // Refused rather than moved-to-nowhere. A workspace that reported a branch it is not on would
      // commit somewhere the user was not told about.
      if (found === undefined) return failure("not-found");

      const fetched = await api.tree(ref.owner, ref.repo, found.sha);
      if (!fetched.ok) return fetched;

      state = {
        tree: fetched.entries,
        head: found.sha,
        readingBranch: found.name,
        writeBranch: found.name,
        truncated: fetched.truncated,
      };
      return { ok: true, branch: found.name };
    },

    /// Commits one file, which is the whole of a save to GitHub.
    ///
    /// **There is no separate push.** The Contents endpoint commits on the server, so when this
    /// answers the change is on GitHub - which is also why nothing here may report success on
    /// anything less than that answer.
    ///
    /// What makes this more than one call is what has to be put right afterwards. The workspace is
    /// pinned to a commit and holds the whole tree in memory, and a commit makes both stale: leave
    /// them and the next read of this path fetches the blob that was there BEFORE the save. The
    /// user saves, reopens, and reads their old text back.
    async write(relativePath, content, expected, { message } = {}) {
      const path = repoPath(relativePath);
      if (path === null || path === "") return failure("permission-denied");

      // Nowhere to commit to. Refused rather than guessed at: committing to the default branch by
      // default is how somebody pushes to main without meaning to.
      if (state.writeBranch === null) return failure("no-branch");

      // The mark is read from what is STORED - the bytes being replaced - exactly as the local
      // backend reads it off the file on disk. Never from the renderer, which is untrusted and has
      // no business asserting a file's encoding. A file being created has no mark.
      const previous = expected === null ? null : cache.get(expected.id);
      const bytes = Buffer.from(encodeTextFile(content, { bom: previous ? hasUtf8Bom(previous) : false }));

      const committed = await api.putFile({
        owner: ref.owner,
        repo: ref.repo,
        path,
        message: message ?? `Update ${path}`,
        bytes,
        branch: state.writeBranch,
        sha: expected?.id ?? null,
      });

      if (!committed.ok) {
        // Passed straight through, and nothing here changes. A pin advanced on a commit that never
        // happened would make the next save conflict against a commit nobody made.
        return committed.reason === "conflict"
          ? { ok: false, reason: "conflict", theirs: committed.theirs === null ? null : { id: committed.theirs } }
          : committed;
      }

      // The tree, the pin and the cache, all moved to the commit that was just made. This is the
      // whole reason a write here is more than a request.
      state = {
        ...state,
        head: committed.commitSha,
        tree: state.tree.map((entry) =>
          entry.path === path && entry.type === "blob"
            ? { ...entry, sha: committed.blobSha, size: bytes.length }
            : entry,
        ),
      };
      // Held under its new sha so reading the file back is memory rather than a request for bytes
      // this process just sent.
      cache.set(committed.blobSha, bytes);

      return { ok: true, revision: { id: committed.blobSha } };
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
    provider: createGitHubProvider({
      ref,
      api,
      entries: tree.entries,
      branch: head.branch,
      sha: head.sha,
      truncated: tree.truncated,
    }),
  };
}

module.exports = { openGitHubWorkspace, GUARD_ROOT };
