import type { WorkspaceRef } from "@trypthos/domain";

/// Whether the tree can be edited from the browser: a new file, a new folder, a rename.
///
/// A folder on disk and a Drive folder both have a mutable place a name can be given; a GitHub
/// repository has none, because a save there is a commit. A OneDrive folder will, once its writes
/// land (PR 3) - until then it is read-only. The shell is still the one that refuses - this only
/// decides what the menu offers.
export function canEditTree(ref: Pick<WorkspaceRef, "kind">): boolean {
  return ref.kind === "local" || ref.kind === "google-drive";
}

/// Whether "show this entry where it lives" means opening it in a web page rather than in the file
/// manager: a Drive or OneDrive entry. The shell chooses between the two; the menu only has to word it.
export function opensInBrowser(ref: Pick<WorkspaceRef, "kind">): boolean {
  return ref.kind === "google-drive" || ref.kind === "onedrive";
}
