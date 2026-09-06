import { type FileTypeId, enabledFileTypes } from "./fileTypes";

/// Making a file that does not exist yet.
///
/// **A new document has a name and no place.** Where it goes is answered by the save dialog the
/// first time it is saved, not by the dialog that names it - two dialogs asking the same question
/// would be two answers that could disagree, and the one that decided first would be the one with
/// the least information.
///
/// So a new document lives as a DRAFT: a real tab you can type into, with an identity that is not a
/// path. It becomes a file the moment it is saved, and the tab follows it there.

/// The identity of a document with nowhere to live yet.
///
/// Not a workspace path, and it cannot be mistaken for one: every path in a workspace is relative
/// and forward-slashed, so nothing on disk collides with this and this shadows nothing on disk. The
/// built-in guide uses the same trick, for the same reason.
export const DRAFT_PREFIX = "trypthos:draft/";

/// A draft's identity. The number is what tells two drafts apart, since the name is the only thing
/// the user gave and there is nothing to stop them making two called "notes.md".
export function draftPath(serial: number, name: string): string {
  return `${DRAFT_PREFIX}${serial}/${name}`;
}

export function isDraftPath(path: string): boolean {
  return path.startsWith(DRAFT_PREFIX);
}

/// A file type as the New dialog offers it: what it is called, and the extension a new file gets.
export interface NewFileType {
  readonly id: FileTypeId;
  readonly labelKey: string;
  /// The first extension the type lists, which is the one it is known by.
  readonly extension: string;
}

/// The types a new file can be, in the catalogue's own order - markdown first, because that is what
/// the app is.
///
/// A type with no extension of its own would have nothing to put on a new file, so it is left out.
/// None currently, which is why this is a guard rather than a filter anybody sees working.
export function newFileTypes(enabled: readonly string[]): NewFileType[] {
  return enabledFileTypes(enabled)
    .filter((type) => type.extensions.length > 0)
    .map((type) => ({ id: type.id, labelKey: type.labelKey, extension: type.extensions[0]! }));
}

/// Characters no filesystem this app runs on will take in a name, plus both separators - a name is a
/// NAME, and one carrying a path would be answering the save dialog's question early and worse.
///
/// A space and a hyphen are deliberately NOT here. "Meeting notes.md" is an ordinary file name, and
/// a dialog that refused one would be wrong about most of the files people actually make.
const UNUSABLE = /[\\/:*?"<>|]/;

/// The file name a dialog's two answers make, or null when they make none.
///
/// Null rather than a thrown error or a corrected guess: the dialog has a button to disable and a
/// user who can see what they typed, and quietly rewriting a name is how somebody ends up with a
/// file they did not ask for.
export function newFileName(typed: string, extension: string): string | null {
  const name = typed.trim();
  if (name === "" || name === "." || name === "..") return null;
  if (UNUSABLE.test(name)) return null;

  // An extension the name already carries is one the user typed on purpose, whether or not it is the
  // one the dropdown says. The name is the more specific answer of the two.
  const dot = name.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < name.length - 1;
  return hasExtension ? name : `${name}.${extension}`;
}
