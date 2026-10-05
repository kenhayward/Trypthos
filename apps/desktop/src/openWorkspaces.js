"use strict";

const { splitQualified } = require("@trypthos/domain");

/// The open workspaces, and the one way to take a qualified path apart.
///
/// This lives in its own module because TWO surfaces can now reach a file: the IPC handlers, and
/// the media protocol that streams video and audio. CLAUDE.md is explicit that the workspace
/// boundary check belongs in one shared module rather than being re-implemented per caller, and
/// this is the reason that rule exists - two copies of this lookup would be two boundary checks,
/// and the day they differ is the day one of them is wrong in a way nothing fails on.

/// The open workspaces, by the id the main process minted for each.
///
/// Not settable except by the user choosing a folder. A renderer can name an id - which is a thing
/// this side made up - and can never name a root, which would be a way to reach any directory on
/// the machine.
const openWorkspaces = new Map();

/// The ONE place a qualified path is taken apart.
///
/// What comes out is an ordinary workspace-relative path, and it goes to the provider's guard
/// unchanged: naming a workspace adds a folder to a path, never permission to leave it.
function locateQualifiedPath(qualifiedPath) {
  const split = splitQualified(qualifiedPath ?? "");
  if (split === null) return null;

  const workspace = openWorkspaces.get(split.workspaceId);
  return workspace === undefined ? null : { workspace, path: split.path };
}

module.exports = { openWorkspaces, locateQualifiedPath };
