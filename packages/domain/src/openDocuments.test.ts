import { describe, expect, it } from "vitest";
import {
  activateDocument,
  activeDocument,
  anyDirty,
  closeDocument,
  dirtyPaths,
  emptyDocumentSet,
  isOpen,
  markSaved,
  openDocument,
  openPaths,
  tabLabels,
  updateContent,
  type DocumentSet,
} from "./openDocuments";

const rev = (id: string) => ({ id });

/// A set with the named files open, each holding its own text, the last one active.
function withFiles(...paths: string[]): DocumentSet {
  return paths.reduce(
    (set, path) =>
      openDocument(set, { path, content: `# ${path}\n`, revision: rev(`r-${path}`) }),
    emptyDocumentSet(),
  );
}

describe("openDocument", () => {
  it("appends a document and makes it active", () => {
    const set = withFiles("a.md", "b.md");

    expect(openPaths(set)).toEqual(["a.md", "b.md"]);
    expect(set.activePath).toBe("b.md");
  });

  it("names a document by the last segment of its path", () => {
    const set = withFiles("docs/notes/today.md");

    expect(activeDocument(set)?.name).toBe("today.md");
  });

  it("opens clean", () => {
    expect(activeDocument(withFiles("a.md"))?.dirty).toBe(false);
  });

  it("activates a document that is already open rather than opening it twice", () => {
    const two = withFiles("a.md", "b.md");
    const again = openDocument(two, { path: "a.md", content: "# fresh\n", revision: rev("r9") });

    expect(openPaths(again)).toEqual(["a.md", "b.md"]);
    expect(again.activePath).toBe("a.md");
  });

  it("leaves an already-open document's own text and revision alone", () => {
    // The reason a second click on a file in the tree must not re-read it: the buffer here is the
    // user's unsaved work, and the content offered by the caller is what is on disk.
    const edited = updateContent(withFiles("a.md", "b.md"), "a.md", "# mine\n");
    const again = openDocument(edited, { path: "a.md", content: "# disk\n", revision: rev("r9") });

    const document = activeDocument(again);
    expect(document?.content).toBe("# mine\n");
    expect(document?.dirty).toBe(true);
    expect(document?.revision.id).toBe("r-a.md");
  });
});

describe("activateDocument", () => {
  it("moves the selection without changing what is open", () => {
    const set = activateDocument(withFiles("a.md", "b.md"), "a.md");

    expect(set.activePath).toBe("a.md");
    expect(openPaths(set)).toEqual(["a.md", "b.md"]);
  });

  it("ignores a path that is not open", () => {
    const set = withFiles("a.md", "b.md");

    expect(activateDocument(set, "gone.md")).toEqual(set);
  });
});

describe("closeDocument", () => {
  it("activates the neighbour to the right", () => {
    const set = closeDocument(activateDocument(withFiles("a.md", "b.md", "c.md"), "b.md"), "b.md");

    expect(openPaths(set)).toEqual(["a.md", "c.md"]);
    expect(set.activePath).toBe("c.md");
  });

  it("falls back to the left when the last tab is closed", () => {
    const set = closeDocument(withFiles("a.md", "b.md", "c.md"), "c.md");

    expect(set.activePath).toBe("b.md");
  });

  it("leaves the selection alone when another tab is closed", () => {
    const set = closeDocument(activateDocument(withFiles("a.md", "b.md", "c.md"), "c.md"), "a.md");

    expect(set.activePath).toBe("c.md");
  });

  it("has nothing active once the last document is closed", () => {
    const set = closeDocument(withFiles("a.md"), "a.md");

    expect(openPaths(set)).toEqual([]);
    expect(set.activePath).toBeNull();
  });

  it("ignores a path that is not open", () => {
    const set = withFiles("a.md");

    expect(closeDocument(set, "gone.md")).toEqual(set);
  });
});

describe("updateContent", () => {
  it("marks only the document that was edited", () => {
    const set = updateContent(withFiles("a.md", "b.md"), "a.md", "# edited\n");

    expect(dirtyPaths(set)).toEqual(["a.md"]);
    expect(anyDirty(set)).toBe(true);
  });

  it("keeps each document's own text", () => {
    const set = updateContent(withFiles("a.md", "b.md"), "a.md", "# edited\n");

    expect(set.documents.map((document) => document.content)).toEqual(["# edited\n", "# b.md\n"]);
  });

  it("is not dirty when the text is what it already was", () => {
    // Retyping a character back is not a change, and a save indicator that says otherwise is one
    // more thing telling the user something untrue about their file.
    const set = updateContent(withFiles("a.md"), "a.md", "# a.md\n");

    expect(anyDirty(set)).toBe(false);
  });

  it("ignores a path that is not open", () => {
    const set = withFiles("a.md");

    expect(updateContent(set, "gone.md", "# nowhere\n")).toEqual(set);
  });
});

describe("markSaved", () => {
  it("clears the flag and advances the revision of that document alone", () => {
    const edited = updateContent(updateContent(withFiles("a.md", "b.md"), "a.md", "# 1\n"), "b.md", "# 2\n");
    const set = markSaved(edited, "a.md", rev("r2"));

    expect(dirtyPaths(set)).toEqual(["b.md"]);
    expect(set.documents[0]?.revision.id).toBe("r2");
    expect(set.documents[1]?.revision.id).toBe("r-b.md");
  });

  it("keeps the saved text, so a save does not reload the buffer", () => {
    const set = markSaved(updateContent(withFiles("a.md"), "a.md", "# mine\n"), "a.md", rev("r2"));

    expect(activeDocument(set)?.content).toBe("# mine\n");
  });
});

describe("isOpen", () => {
  it("answers for a path whether it has a tab", () => {
    const set = withFiles("a.md");

    expect(isOpen(set, "a.md")).toBe(true);
    expect(isOpen(set, "b.md")).toBe(false);
  });
});

describe("tabLabels", () => {
  it("uses the file's own name when nothing else shares it", () => {
    expect(tabLabels(["docs/notes.md", "specs/plan.md"])).toEqual(["notes.md", "plan.md"]);
  });

  it("qualifies both tabs when two files share a name", () => {
    // Two tabs reading "index.md" are two tabs the user cannot tell apart, which is the one thing a
    // tab strip exists to do.
    expect(tabLabels(["docs/index.md", "specs/index.md"])).toEqual([
      "docs/index.md",
      "specs/index.md",
    ]);
  });

  it("qualifies every tab sharing the name, and no others", () => {
    expect(tabLabels(["a/index.md", "b/index.md", "c/other.md"])).toEqual([
      "a/index.md",
      "b/index.md",
      "other.md",
    ]);
  });

  it("uses the whole path when a clash reaches the root", () => {
    expect(tabLabels(["index.md", "docs/index.md"])).toEqual(["index.md", "docs/index.md"]);
  });

  it("goes further up when the parent folder is not enough to tell them apart", () => {
    expect(tabLabels(["one/docs/index.md", "two/docs/index.md"])).toEqual([
      "one/docs/index.md",
      "two/docs/index.md",
    ]);
  });
});
