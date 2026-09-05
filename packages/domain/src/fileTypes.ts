import type { EditorMode } from "./editorMode";

/// Which files Trypthos takes an interest in.
///
/// The setting behind this is called **File types**, not plugins, and the difference is the whole
/// design. A language's colouring is loaded on demand and costs nothing until a file needs it, so a
/// checkbox here cannot buy back startup time. What it decides is **scope**: which files appear in
/// the folder tree, which files the app will open, and which files chat can see. Point Trypthos at a
/// source repository with a language turned on and the left panel gains several hundred rows - that
/// is the choice the user is making.
///
/// The catalogue is DATA, and lives in the domain because a stored setting names its ids: the schema
/// that reads settings, the tree that filters on it and the page that draws the checkboxes have to
/// agree about which types exist, and three lists agreeing by hand are three lists that will not.
/// Nothing here imports CodeMirror - the loaders that turn an id into a language belong to the
/// renderer, and a module-graph test keeps them there.

export type FileTypeId = "markdown" | "text";

/// How the settings page arranges its rows. Groups are added as types arrive rather than declared
/// ahead of them: a heading with nothing under it is a page that looks broken.
export type FileTypeGroup = "documents";

/// What editing a file of this type is like, and therefore how the surface behaves.
///
/// One flag rather than three, because wrapping, spellchecking and bracket-closing all follow from
/// the same question. `prose` wraps and spellchecks; `plain` does neither, which is why a log is not
/// prose - wrapping a log is wrong; `code` adds the editing affordances a source file wants.
export type FileTypeKind = "prose" | "plain" | "code";

export interface FileType {
  /// Also the key of the renderer's language loader, and what a settings file stores.
  readonly id: FileTypeId;
  /// A translation key, never wording. This module stays pure and testable without rendering.
  readonly labelKey: string;
  readonly group: FileTypeGroup;
  /// Lowercase, no leading dot, matched against the LAST extension of a name.
  readonly extensions: readonly string[];
  /// Whole names, matched case-insensitively: `Dockerfile` and `Makefile` have no extension at all.
  readonly filenames: readonly string[];
  /// Which views the header offers. Live and Preview are markdown constructs - Live hides markdown
  /// punctuation and Preview renders markdown - so every other type is Source and nothing else.
  readonly modes: readonly EditorMode[];
  readonly kind: FileTypeKind;
  /// Always on, and drawn as a checked box the user cannot clear. Markdown is what the app is.
  readonly pinned: boolean;
}

export const FILE_TYPE_GROUPS: readonly FileTypeGroup[] = ["documents"];

/// In the order the settings page lists them within their group.
export const FILE_TYPES: readonly FileType[] = [
  {
    id: "markdown",
    labelKey: "fileTypes.markdown",
    group: "documents",
    extensions: ["md", "markdown", "mkd", "mdown"],
    filenames: [],
    modes: ["live", "source", "preview"],
    kind: "prose",
    pinned: true,
  },
  {
    id: "text",
    labelKey: "fileTypes.text",
    group: "documents",
    extensions: ["txt", "text", "nfo"],
    filenames: [],
    // Source alone: there is no markdown syntax to hide in Live, and nothing to render in Preview.
    modes: ["source"],
    kind: "prose",
    pinned: false,
  },
];

/// What a new installation, and an upgraded one, both start with.
///
/// Markdown and nothing else. Adding a setting must not change what an existing installation does,
/// and a fresh install that disagreed with a migrated one would be a second kind of wrong - so every
/// type beyond markdown, plain text included, is something the user turns on deliberately.
export const DEFAULT_FILE_TYPES: readonly FileTypeId[] = ["markdown"];

/// Whether a file of this name is of this type.
///
/// Exported separately from the resolver below so the RULE can be tested as a rule, against types
/// made up for the purpose, rather than against whichever entries the catalogue happens to carry.
export function matchesFileType(type: FileType, name: string): boolean {
  if (type.filenames.some((filename) => filename.toLowerCase() === name.toLowerCase())) return true;

  // `dot <= 0` rather than `dot === -1`: a leading dot is a hidden entry, not a name that is all
  // extension. `.gitignore` is a file called that, and reading `gitignore` as its extension is how a
  // config file gets opened as a document.
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return type.extensions.includes(name.slice(dot + 1).toLowerCase());
}

/// The types that are on, in catalogue order.
///
/// Unknown ids are dropped rather than refused. A settings file written by a newer build names types
/// this one has never heard of, and that is why the stored list is strings and not an enum - a
/// strict schema would reject the file and take every other choice in it down with it.
export function enabledFileTypes(ids: readonly string[]): readonly FileType[] {
  return FILE_TYPES.filter((type) => type.pinned || ids.includes(type.id));
}

/// The type of a file, or null when nothing enabled claims it.
///
/// Null is the answer for two different situations that behave identically: a file no type describes
/// at all, and a file whose type the user has turned off. Both mean the same thing here - the tree
/// does not list it and the editor will not open it.
export function fileTypeFor(name: string, ids: readonly string[]): FileType | null {
  return enabledFileTypes(ids).find((type) => matchesFileType(type, name)) ?? null;
}

export function isOpenable(name: string, ids: readonly string[]): boolean {
  return fileTypeFor(name, ids) !== null;
}
