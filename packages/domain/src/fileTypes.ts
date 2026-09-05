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

export type FileTypeId =
  | "markdown"
  | "text"
  | "json"
  | "yaml"
  | "xml"
  | "html"
  | "css"
  | "javascript"
  | "toml"
  | "ini"
  | "python"
  | "shell"
  | "powershell"
  | "sql"
  | "rust"
  | "go"
  | "cpp"
  | "csharp"
  | "java"
  | "php"
  | "ruby"
  | "diff"
  | "dockerfile"
  | "makefile"
  | "latex"
  | "r"
  | "lua"
  | "perl"
  | "swift"
  | "scala"
  | "dart";

/// How the settings page arranges its rows. Groups are added as types arrive rather than declared
/// ahead of them: a heading with nothing under it is a page that looks broken.
export type FileTypeGroup = "documents" | "data" | "languages" | "utility";

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

export const FILE_TYPE_GROUPS: readonly FileTypeGroup[] = [
  "documents",
  "data",
  "languages",
  "utility",
];

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
  {
    id: "json",
    labelKey: "fileTypes.json",
    group: "data",
    // `.map` is a source map, which is JSON and is what a person finds beside a built file.
    extensions: ["json", "jsonc", "map", "webmanifest"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "yaml",
    labelKey: "fileTypes.yaml",
    group: "data",
    extensions: ["yaml", "yml"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "xml",
    labelKey: "fileTypes.xml",
    group: "data",
    extensions: ["xml", "svg", "xsd", "xsl"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "html",
    labelKey: "fileTypes.html",
    group: "data",
    extensions: ["html", "htm"],
    filenames: [],
    // Source alone, deliberately. Rendering a workspace file's HTML would execute its scripts inside
    // the renderer, which is a security surface rather than a feature - see docs/specs/file-types.md.
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "css",
    labelKey: "fileTypes.css",
    group: "data",
    // SCSS, Sass and LESS are here rather than in rows of their own: to somebody choosing what to
    // see, they are all "stylesheets". They are NOT the same grammar, so the loader picks the right
    // one from the extension - the same dialect selection JavaScript does.
    extensions: ["css", "scss", "sass", "less"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "javascript",
    labelKey: "fileTypes.javascript",
    group: "languages",
    // One type, not four. TypeScript and JSX are dialects of the same grammar and the same npm
    // package, and a settings page that made somebody tick four boxes to open a project would be
    // describing the packaging rather than the choice. The loader picks the dialect from the name.
    extensions: ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "toml",
    labelKey: "fileTypes.toml",
    group: "data",
    extensions: ["toml"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "ini",
    labelKey: "fileTypes.ini",
    group: "data",
    extensions: ["ini", "properties", "cfg", "conf"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "python",
    labelKey: "fileTypes.python",
    group: "languages",
    extensions: ["py", "pyw", "pyi"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "shell",
    labelKey: "fileTypes.shell",
    group: "languages",
    extensions: ["sh", "bash", "zsh", "ksh"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "powershell",
    labelKey: "fileTypes.powershell",
    group: "languages",
    // Windows writes these, and Trypthos is a Windows-first app - a general-purpose
    // ranking of languages would put PowerShell far lower than it belongs here.
    extensions: ["ps1", "psm1", "psd1"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "sql",
    labelKey: "fileTypes.sql",
    group: "languages",
    extensions: ["sql"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "rust",
    labelKey: "fileTypes.rust",
    group: "languages",
    extensions: ["rs"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "go",
    labelKey: "fileTypes.go",
    group: "languages",
    extensions: ["go"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "cpp",
    labelKey: "fileTypes.cpp",
    group: "languages",
    // One type, because `.h` belongs to both and a catalogue cannot let two rows claim it.
    extensions: ["c", "h", "cpp", "hpp", "cc", "cxx", "hh", "hxx"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "csharp",
    labelKey: "fileTypes.csharp",
    group: "languages",
    extensions: ["cs"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "java",
    labelKey: "fileTypes.java",
    group: "languages",
    // Two grammars, one row: the loader picks Kotlin off the extension.
    extensions: ["java", "kt", "kts"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "php",
    labelKey: "fileTypes.php",
    group: "languages",
    extensions: ["php", "phtml"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "ruby",
    labelKey: "fileTypes.ruby",
    group: "languages",
    extensions: ["rb"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "diff",
    labelKey: "fileTypes.diff",
    group: "utility",
    extensions: ["diff", "patch"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "dockerfile",
    labelKey: "fileTypes.dockerfile",
    group: "utility",
    extensions: ["dockerfile"],
    filenames: ["Dockerfile"],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "makefile",
    labelKey: "fileTypes.makefile",
    group: "utility",
    // No grammar exists for this in @codemirror/legacy-modes, so it opens uncoloured.
    // It earns its row anyway: the point of a file type is that the file APPEARS and can
    // be opened at all, which is the same reason Plain text is a row.
    extensions: ["mk"],
    filenames: ["Makefile", "GNUmakefile"],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "latex",
    labelKey: "fileTypes.latex",
    group: "utility",
    extensions: ["tex", "ltx", "sty"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "r",
    labelKey: "fileTypes.r",
    group: "utility",
    extensions: ["r"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "lua",
    labelKey: "fileTypes.lua",
    group: "utility",
    extensions: ["lua"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "perl",
    labelKey: "fileTypes.perl",
    group: "utility",
    // `.pl` is Perl here rather than Prolog. One owner per extension, and Perl is the one
    // somebody is more likely to have beside their notes.
    extensions: ["pl", "pm"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "swift",
    labelKey: "fileTypes.swift",
    group: "utility",
    extensions: ["swift"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "scala",
    labelKey: "fileTypes.scala",
    group: "utility",
    extensions: ["scala", "sc"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
  {
    id: "dart",
    labelKey: "fileTypes.dart",
    group: "utility",
    extensions: ["dart"],
    filenames: [],
    modes: ["source"],
    kind: "code",
    pinned: false,
  },
];

/// What a document with no file behind it is treated as.
///
/// The scratch buffer and the built-in guide are both markdown, and neither has a name an extension
/// could be read from. The catalogue's own entry rather than a copy of it, so there is one answer to
/// "what is markdown" and it cannot drift.
export const MARKDOWN_FILE_TYPE: FileType = FILE_TYPES.find((type) => type.id === "markdown")!;

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
