import { z } from "zod";

/// The files the File menu offers to reopen.
///
/// **An entry names a workspace as well as a file**, because every path in this app is relative to
/// one open folder: "notes.md" means nothing until you know which folder it is in, and the same
/// relative path in two folders is two different files. That also makes reopening one exactly the
/// act the app already has - the folder, and a document within it, which is what File Explorer hands
/// over on launch. Nothing here is a second way to open a file.
///
/// Stored in settings rather than a file of its own: it is a convenience, none of it is the user's
/// work, and a failure to read it should cost them a menu rather than stop the app.

/// How many the menu remembers. Long enough to reach last week's file, short enough that the menu
/// stays a menu rather than a history.
export const RECENT_FILES_LIMIT = 10;

export const RecentFileSchema = z
  .object({
    /// Absolute path to the workspace the file was open in.
    root: z.string().min(1),
    /// Workspace-relative, as it was when the file was opened. May name a file that has since been
    /// renamed, moved or deleted - reopening one goes through the ordinary open, which reports that
    /// the way it reports any other missing file.
    path: z.string().min(1),
  })
  .strict();

export type RecentFile = z.infer<typeof RecentFileSchema>;

/// Records that a file was opened: newest first, no repeats, capped.
///
/// A file already in the list MOVES rather than being added again. A list holding the same file
/// three times remembers less than it looks like it does.
export function noteRecentFile(
  recent: readonly RecentFile[],
  file: RecentFile,
  limit = RECENT_FILES_LIMIT,
): RecentFile[] {
  const rest = recent.filter((entry) => !(entry.root === file.root && entry.path === file.path));
  return [file, ...rest].slice(0, limit);
}

/// The last segment of a path, whichever separator it was written with.
function lastSegment(value: string): string {
  const segments = value.replace(/\\/g, "/").split("/").filter((segment) => segment !== "");
  return segments.at(-1) ?? value;
}

/// What an entry is called on the menu.
///
/// The path alone is not enough: the same relative path in two folders would give two entries that
/// read identically, and choosing between them is the whole point of the menu.
///
/// **The ampersand is not decoration.** Electron reads `&` in a menu label as a mnemonic marker and
/// swallows it, so a file called "Q&A.md" would appear as "QA.md" with an underlined A. Doubling it
/// is how a literal one is written, and nothing about that failure looks like an escaping problem.
export function recentFileLabel(file: RecentFile): string {
  const label = `${file.path} - ${lastSegment(file.root)}`;
  return label.replace(/&/g, "&&");
}
