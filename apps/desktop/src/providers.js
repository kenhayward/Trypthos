"use strict";

const fs = require("node:fs/promises");
const { createPathGuard, workspaceRefName } = require("@trypthos/domain");
const { createLocalWorkspace } = require("./localWorkspace");
const { openGitHubWorkspace } = require("./githubWorkspace");

/// The provider registry: a reference in, an open workspace out.
///
/// **This is the one place a new provider is added.** A kind in `workspaceRef.ts`, a branch here, and
/// a row in the interface's source picker - and the registry test walks `PROVIDER_KINDS` so the
/// second and third being forgotten is a failing test rather than a row that can be chosen and never
/// opened.
///
/// What every provider must hand back is the same record, because everything above it reads that
/// record and nothing else:
///
/// | Field      | For                                                                       |
/// |------------|---------------------------------------------------------------------------|
/// | `ref`      | What was opened. Deduplication and the settings file both compare on this. |
/// | `name`     | What the workspace is called, which becomes the front of every path in it. |
/// | `root`     | The absolute folder, or **null** for a provider that has none.             |
/// | `provider` | `list` / `read` / `readBytes` / `write`, in the local backend's shapes.    |
/// | `guard`    | The boundary check, or null when the provider applies its own internally.  |
///
/// `root` being nullable is the field that carries the whole difference. Save As opens a native
/// dialog at a folder on disk, and a repository has none - so the handler refuses rather than
/// inventing one, and every other caller of `root` is about recording where a local file was.

/// Opens a local folder, having first checked it is still one.
///
/// The check is what a stored path needs: it can have been deleted, renamed, or written on another
/// machine entirely. The same check runs whether the folder came from the native dialog or from the
/// settings file - a path that arrived through the renderer is not a place until this has answered.
async function openLocal(ref) {
  try {
    const stats = await fs.stat(ref.root);
    if (!stats.isDirectory()) return { ok: false, reason: "not-found" };
  } catch {
    return { ok: false, reason: "not-found" };
  }

  const guard = createPathGuard({
    root: ref.root,
    // Windows and default macOS volumes compare names case-insensitively; Linux does not. Getting
    // this wrong in the permissive direction would let "/WS/../etc" read as inside "/ws".
    caseInsensitive: process.platform !== "linux",
  });

  return {
    ok: true,
    // The guard is kept beside the provider rather than only inside it, because Save As has a path
    // to check BEFORE it has anything to write: the dialog answers with an absolute path, and
    // whether that is a place in this workspace is the question asked first.
    workspace: { ref, root: ref.root, guard, provider: createLocalWorkspace({ root: ref.root, guard }) },
  };
}

/// Opens a GitHub repository at the head of its default branch.
///
/// No root, because there is no folder: the browser shows a tree, and Save As has nowhere to open a
/// dialog. No guard beside the provider either - the repository provider holds its own, since
/// nothing outside it has an absolute path to check.
async function openGitHub(ref, { github }) {
  if (!github) return { ok: false, reason: "unsupported" };

  const opened = await openGitHubWorkspace({ ref, api: github });
  if (!opened.ok) return opened;

  return {
    ok: true,
    workspace: {
      ref,
      root: null,
      guard: null,
      provider: opened.provider,
      /// What the browser needs to be honest about a repository too large to describe in one answer.
      truncated: opened.truncated,
      branch: opened.branch,
    },
  };
}

const OPENERS = {
  local: openLocal,
  github: openGitHub,
};

/// Opens whatever a reference names, or explains why it could not be opened.
///
/// A result rather than an exception: every failure here is one the user has to be told about at the
/// moment they asked - a folder that has gone, a repository they cannot see, a token that has been
/// revoked - and none of them is exceptional.
async function openWorkspaceFor(ref, dependencies = {}) {
  const opener = OPENERS[ref.kind];
  // A settings file written by a newer build can name a provider this one has never heard of.
  // Refusing it is a folder that does not open; guessing would be worse.
  if (opener === undefined) return { ok: false, reason: "unsupported" };

  const opened = await opener(ref, dependencies);
  if (!opened.ok) return opened;

  return { ok: true, workspace: { name: workspaceRefName(ref), ...opened.workspace } };
}

module.exports = { openWorkspaceFor, PROVIDER_OPENERS: OPENERS };
