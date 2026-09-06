import { describe, expect, it } from "vitest";
import {
  GUIDE_PATH,
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
  renameDocument,
  tabLabels,
  tabsToClose,
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

  // This one asserted only the SELECTION, and so said nothing about whether the tab went. It did
  // not: the branch for closing a tab other than the one on screen built the list without it and
  // then returned the original set, so every close of a background tab was silently a no-op.
  it("leaves the selection alone when another tab is closed", () => {
    const set = closeDocument(activateDocument(withFiles("a.md", "b.md", "c.md"), "c.md"), "a.md");

    expect(openPaths(set)).toEqual(["b.md", "c.md"]);
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

describe("a read-only document", () => {
  const guide = (set = emptyDocumentSet()) =>
    openDocument(set, {
      path: GUIDE_PATH,
      content: "# Guide\n",
      revision: rev("built-in"),
      readOnly: true,
    });

  it("opens in a tab like any other document", () => {
    const set = guide(withFiles("a.md"));

    expect(openPaths(set)).toEqual(["a.md", GUIDE_PATH]);
    expect(set.activePath).toBe(GUIDE_PATH);
  });

  it("is marked read-only, and an ordinary document is not", () => {
    expect(activeDocument(guide())?.readOnly).toBe(true);
    expect(activeDocument(withFiles("a.md"))?.readOnly).toBe(false);
  });

  // The one invariant behind "never saved". A read-only document has nowhere to be written to, so
  // it must never become dirty - otherwise closing it asks about saving work that has no home, and
  // the only honest answer to the prompt is one the app cannot carry out.
  it("never becomes dirty, whatever is written to it", () => {
    const set = updateContent(guide(), GUIDE_PATH, "# edited\n");

    expect(activeDocument(set)?.content).toBe("# Guide\n");
    expect(anyDirty(set)).toBe(false);
  });

  it("has a path no workspace file can collide with", () => {
    // A workspace path is relative and forward-slashed; this one is neither, so no file on disk can
    // shadow the guide and the guide can shadow no file.
    expect(GUIDE_PATH.startsWith("trypthos:")).toBe(true);
  });
});

/// What Save As does to the tab it was invoked from.
///
/// A rename rather than a second tab: the user asked for this document to live somewhere else, and
/// leaving the old tab open beside the new one would give them two views of text that is now in two
/// files, with no way to tell which one they are typing into.
describe("renameDocument", () => {
  it("moves the document to its new path, keeping its text and its place in the strip", () => {
    const set = renameDocument(withFiles("a.md", "b.md", "c.md"), "b.md", "notes/b.md", rev("new"));

    expect(openPaths(set)).toEqual(["a.md", "notes/b.md", "c.md"]);
    expect(set.documents[1]?.content).toBe("# b.md\n");
    expect(set.documents[1]?.name).toBe("b.md");
  });

  it("takes the revision the write returned, and is no longer dirty", () => {
    const edited = updateContent(withFiles("a.md"), "a.md", "changed");
    const set = renameDocument(edited, "a.md", "copy.md", rev("saved"));

    expect(set.documents[0]?.revision).toEqual(rev("saved"));
    expect(anyDirty(set)).toBe(false);
  });

  // The tab the user is looking at has to follow, or Save As leaves them staring at a document they
  // did not save while the one they did is somewhere behind it.
  it("follows the selection when the renamed document was on screen", () => {
    const set = renameDocument(withFiles("a.md", "b.md"), "b.md", "b2.md", rev("new"));
    expect(set.activePath).toBe("b2.md");
  });

  it("leaves the selection alone when some other document was on screen", () => {
    const set = renameDocument(withFiles("a.md", "b.md"), "a.md", "a2.md", rev("new"));
    expect(set.activePath).toBe("b.md");
  });

  // Saving over a file that is ALSO open would leave two tabs naming one file, each with its own
  // idea of what is in it. The stale one goes: what was just written is what is on disk.
  it("closes another tab that was already showing the file written over", () => {
    const set = renameDocument(withFiles("a.md", "b.md"), "b.md", "a.md", rev("new"));

    expect(openPaths(set)).toEqual(["a.md"]);
    expect(activeDocument(set)?.content).toBe("# b.md\n");
    expect(set.activePath).toBe("a.md");
  });

  // A read-only document has no file behind it, so there is nothing to move. Save As on the guide is
  // a copy - a new document at the new path - and that is the caller's business, not this one's.
  it("refuses to move a read-only document", () => {
    const set = openDocument(emptyDocumentSet(), {
      path: GUIDE_PATH,
      content: "# Guide\n",
      revision: rev("built-in"),
      readOnly: true,
    });

    expect(renameDocument(set, GUIDE_PATH, "guide.md", rev("new"))).toBe(set);
  });

  it("does nothing for a path that is not open", () => {
    const set = withFiles("a.md");
    expect(renameDocument(set, "missing.md", "x.md", rev("new"))).toBe(set);
  });
});

/// What each entry of a tab's right-click menu would close.
///
/// Expressed over the tab strip rather than over a `DocumentSet`, because that is what the strip
/// itself holds - and it makes every one of these answerable without a document set to build.
describe("tabsToClose", () => {
  const paths = ["a.md", "b.md", "c.md", "d.md"];

  it("closes the tab that was clicked", () => {
    expect(tabsToClose("close", paths, [], "b.md")).toEqual(["b.md"]);
  });

  it("closes everything after the clicked tab, in strip order", () => {
    expect(tabsToClose("close-right", paths, [], "b.md")).toEqual(["c.md", "d.md"]);
  });

  it("closes everything", () => {
    expect(tabsToClose("close-all", paths, [], "b.md")).toEqual(paths);
  });

  it("closes everything but the clicked tab", () => {
    expect(tabsToClose("close-others", paths, [], "b.md")).toEqual(["a.md", "c.md", "d.md"]);
  });

  // "Saved" is the tab strip's own word for it: a tab with no unsaved work, dot or no dot. It
  // deliberately includes the clicked one - the entry says what it closes.
  it("closes the tabs with nothing unsaved in them", () => {
    expect(tabsToClose("close-saved", paths, ["b.md", "d.md"], "b.md")).toEqual(["a.md", "c.md"]);
  });

  // What "nothing to do" looks like, and how the menu greys an entry: an entry that would close
  // nothing is an entry there is no point offering.
  it("has nothing to close to the right of the last tab", () => {
    expect(tabsToClose("close-right", paths, [], "d.md")).toEqual([]);
  });

  it("has no others to close when there is one tab", () => {
    expect(tabsToClose("close-others", ["a.md"], [], "a.md")).toEqual([]);
  });

  it("has nothing saved to close when every tab is unsaved", () => {
    expect(tabsToClose("close-saved", paths, paths, "b.md")).toEqual([]);
  });

  // The strip can change under a menu that is already open - a save lands, another window is used.
  // A path that is no longer there closes nothing rather than throwing.
  it("closes nothing for a tab that is no longer open", () => {
    expect(tabsToClose("close", paths, [], "gone.md")).toEqual([]);
    expect(tabsToClose("close-right", paths, [], "gone.md")).toEqual([]);
    expect(tabsToClose("close-others", paths, [], "gone.md")).toEqual([]);
  });
});
