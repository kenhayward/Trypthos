import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_TYPES,
  FILE_TYPES,
  FILE_TYPE_GROUPS,
  MARKDOWN_FILE_TYPE,
  enabledFileTypes,
  fileTypeFor,
  isOpenable,
  matchesFileType,
  type FileType,
} from "./fileTypes";

/// Hand-made types, so the matching rules are tested as RULES rather than against whichever entries
/// the catalogue happens to carry today. The catalogue's own invariants are asserted separately.
const fake = (over: Partial<FileType> = {}): FileType => ({
  id: "markdown",
  labelKey: "fileTypes.markdown",
  group: "documents",
  extensions: [],
  filenames: [],
  modes: ["source"],
  kind: "code",
  pinned: false,
  ...over,
});

describe("matchesFileType", () => {
  const byExtension = fake({ extensions: ["md", "markdown"] });

  it("matches on the extension", () => {
    expect(matchesFileType(byExtension, "notes.md")).toBe(true);
    expect(matchesFileType(byExtension, "notes.markdown")).toBe(true);
  });

  it("ignores the case of the extension", () => {
    expect(matchesFileType(byExtension, "NOTES.MD")).toBe(true);
  });

  // The extension, not a substring. Offering to open `archive.md.bak` as markdown is the kind of
  // thing that looks like it works until somebody saves over it.
  it("reads only the last extension", () => {
    expect(matchesFileType(byExtension, "archive.md.bak")).toBe(false);
    expect(matchesFileType(fake({ extensions: ["bak"] }), "archive.md.bak")).toBe(true);
  });

  it("matches nothing without an extension to read", () => {
    expect(matchesFileType(byExtension, "README")).toBe(false);
    expect(matchesFileType(byExtension, "notes.")).toBe(false);
  });

  // A dot-prefixed name is a hidden entry, not a file whose whole name is an extension. `.md` is a
  // file called ".md", and treating it as markdown is how a config file gets opened as a document.
  it("does not read a leading dot as an extension", () => {
    expect(matchesFileType(byExtension, ".md")).toBe(false);
    expect(matchesFileType(fake({ extensions: ["gitignore"] }), ".gitignore")).toBe(false);
  });

  // Dockerfile and Makefile have no extension at all. The rule exists from the start because
  // retrofitting a second way of matching through every call site later is the expensive version.
  it("matches a whole filename, whatever its case", () => {
    const byName = fake({ filenames: ["Dockerfile"] });
    expect(matchesFileType(byName, "Dockerfile")).toBe(true);
    expect(matchesFileType(byName, "dockerfile")).toBe(true);
    expect(matchesFileType(byName, "Dockerfile.dev")).toBe(false);
  });
});

describe("enabledFileTypes", () => {
  it("answers in catalogue order, not the order they were stored", () => {
    const ids = enabledFileTypes(["text", "markdown"]).map((type) => type.id);
    expect(ids).toEqual(FILE_TYPES.filter((type) => ids.includes(type.id)).map((type) => type.id));
  });

  // A settings file written by a NEWER build names types this one has never heard of. Dropping them
  // quietly is the whole reason the stored list is strings rather than an enum: a strict schema
  // would refuse the file and take every other choice in it down too.
  it("ignores an id it does not recognise", () => {
    expect(enabledFileTypes(["markdown", "klingon"]).map((t) => t.id)).toEqual(["markdown"]);
  });

  // Pinned means pinned. A hand-edited settings file that drops markdown must not leave the user
  // with a markdown editor that cannot open markdown.
  it("keeps a pinned type whether or not it was stored", () => {
    expect(enabledFileTypes([]).map((type) => type.id)).toEqual(["markdown"]);
  });

  it("has markdown pinned and nothing else", () => {
    expect(FILE_TYPES.filter((type) => type.pinned).map((type) => type.id)).toEqual(["markdown"]);
  });
});

describe("fileTypeFor", () => {
  it("finds the type of an enabled file", () => {
    expect(fileTypeFor("notes.md", ["markdown"])?.id).toBe("markdown");
    expect(fileTypeFor("notes.txt", ["markdown", "text"])?.id).toBe("text");
  });

  // The point of the setting: a type that is off is a file the app does not list and will not open.
  it("does not find a file whose type is turned off", () => {
    expect(fileTypeFor("notes.txt", ["markdown"])).toBeNull();
    expect(isOpenable("notes.txt", ["markdown"])).toBe(false);
    expect(isOpenable("notes.txt", ["markdown", "text"])).toBe(true);
  });

  it("finds nothing for a file no type claims", () => {
    expect(fileTypeFor("picture.png", ["markdown", "text"])).toBeNull();
    expect(fileTypeFor("Makefile", ["markdown", "text"])).toBeNull();
  });
});

describe("the catalogue", () => {
  // ONE equality over the whole catalogue, not a check per type. Every type can be well-formed while
  // the set still has two of them claiming `.m`, and a per-type check cannot see that.
  it("has no extension or filename claimed twice", () => {
    const claims = FILE_TYPES.flatMap((type) => [
      ...type.extensions,
      ...type.filenames.map((name) => name.toLowerCase()),
    ]);
    expect([...new Set(claims)].sort()).toEqual([...claims].sort());
  });

  it("has no id used twice", () => {
    const ids = FILE_TYPES.map((type) => type.id);
    expect([...new Set(ids)].sort()).toEqual([...ids].sort());
  });

  // Written as the matcher reads them. An extension stored as ".md" or "MD" matches nothing and
  // fails silently - the file simply never appears in the tree.
  it("stores extensions lowercase and without a dot", () => {
    const wrong = FILE_TYPES.flatMap((type) => type.extensions).filter(
      (extension) => extension !== extension.toLowerCase() || extension.startsWith("."),
    );
    expect(wrong).toEqual([]);
  });

  it("gives every type something to match on", () => {
    const unmatchable = FILE_TYPES.filter(
      (type) => type.extensions.length === 0 && type.filenames.length === 0,
    ).map((type) => type.id);
    expect(unmatchable).toEqual([]);
  });

  // A type with no modes is a file that opens into a panel with no view to draw it in.
  it("gives every type at least one view, and only markdown all three", () => {
    expect(FILE_TYPES.filter((type) => type.modes.length === 0)).toEqual([]);
    expect(FILE_TYPES.filter((type) => type.modes.length === 3).map((type) => type.id)).toEqual([
      "markdown",
    ]);
  });

  it("puts every type in a group the settings page draws", () => {
    const strays = FILE_TYPES.filter((type) => !FILE_TYPE_GROUPS.includes(type.group));
    expect(strays).toEqual([]);
  });

  // The default must not change what an existing installation does, and a fresh install must not
  // disagree with an upgraded one. Both are markdown and nothing else.
  it("defaults to markdown alone", () => {
    expect(DEFAULT_FILE_TYPES).toEqual(["markdown"]);
  });

  it("names only types that exist", () => {
    const known = new Set(FILE_TYPES.map((type) => type.id));
    expect(DEFAULT_FILE_TYPES.filter((id) => !known.has(id))).toEqual([]);
  });

  // The editor reads `kind` to decide whether to wrap lines, spellcheck, and close brackets. A type
  // whose kind was wrong would spellcheck a source file or refuse to wrap a note, so the assignment
  // is asserted rather than left to whoever adds the next row.
  it("calls prose only what somebody writes prose in", () => {
    expect(FILE_TYPES.filter((type) => type.kind === "prose").map((type) => type.id)).toEqual([
      "markdown",
      "text",
    ]);
  });

  it("gives every group at least one type", () => {
    const empty = FILE_TYPE_GROUPS.filter(
      (group) => !FILE_TYPES.some((type) => type.group === group),
    );
    expect(empty).toEqual([]);
  });
});

describe("MARKDOWN_FILE_TYPE", () => {
  // What a document with no file behind it is treated as: the scratch buffer, and the built-in
  // guide. Both are markdown, and neither has a name an extension could be read from.
  it("is the catalogue's own markdown entry, not a copy of it", () => {
    expect(MARKDOWN_FILE_TYPE).toBe(FILE_TYPES.find((type) => type.id === "markdown"));
  });

  it("offers all three views", () => {
    expect(MARKDOWN_FILE_TYPE.modes).toEqual(["live", "source", "preview"]);
  });
});
