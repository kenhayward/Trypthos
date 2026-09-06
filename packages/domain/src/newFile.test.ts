import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_TYPES } from "./fileTypes";
import { DRAFT_PREFIX, draftPath, isDraftPath, newFileName, newFileTypes } from "./newFile";

/// Naming a file that does not exist yet.
///
/// The dialog has a name and a type, and the file's name is what falls out of the two. Pure, because
/// every awkward case here is about text rather than about files.
describe("newFileName", () => {
  it("puts the chosen extension on the name", () => {
    expect(newFileName("notes", "md")).toBe("notes.md");
  });

  // Somebody who types the extension meant it. Adding it again gives "notes.md.md", which is the
  // kind of thing that makes a dialog feel like it is not listening.
  it("does not repeat an extension the name already has", () => {
    expect(newFileName("notes.md", "md")).toBe("notes.md");
    expect(newFileName("NOTES.MD", "md")).toBe("NOTES.MD");
  });

  // A different extension typed by hand is still what they typed. The dropdown says .md and the name
  // says .txt: the name is the more specific answer, and overriding it would discard a decision.
  it("leaves a name that already has a different extension alone", () => {
    expect(newFileName("notes.txt", "md")).toBe("notes.txt");
  });

  it("trims the space around a name", () => {
    expect(newFileName("  notes  ", "md")).toBe("notes.md");
  });

  it("has no name for nothing typed", () => {
    expect(newFileName("", "md")).toBeNull();
    expect(newFileName("   ", "md")).toBeNull();
  });

  // A name is a NAME, not a place. Where the file goes is answered by the save dialog, and a name
  // that carried a path would be answering it twice and disagreeing.
  it("refuses a name that is really a path", () => {
    expect(newFileName("notes/plan", "md")).toBeNull();
    expect(newFileName("..", "md")).toBeNull();
    expect(newFileName("a\\b", "md")).toBeNull();
  });

  it("refuses a name with characters no filesystem takes", () => {
    for (const name of ["a:b", "a*b", "a?b", 'a"b', "a<b", "a|b"]) {
      expect(newFileName(name, "md")).toBeNull();
    }
  });

  // A space inside a file name is ordinary, and a dialog that refused one would be wrong about
  // every "Meeting notes.md" anybody has ever written.
  it("takes a name with a space in it", () => {
    expect(newFileName("Meeting notes", "md")).toBe("Meeting notes.md");
  });
});

/// What the dialog offers, and the order it offers it in.
describe("newFileTypes", () => {
  it("offers one entry per enabled type, with the extension it would use", () => {
    const offered = newFileTypes(["markdown", "python"]);

    expect(offered.map((type) => type.id)).toEqual(["markdown", "python"]);
    expect(offered.map((type) => type.extension)).toEqual(["md", "py"]);
  });

  it("puts markdown first, because that is what the app is", () => {
    expect(newFileTypes(DEFAULT_FILE_TYPES)[0]?.id).toBe("markdown");
  });

  // A type with no extension of its own would have nothing to put on a new file. There are none
  // today - even Makefile, which is matched by name, lists `.mk` - so this asserts the property
  // rather than an example of it.
  it("offers nothing it cannot name a file with", () => {
    for (const type of newFileTypes(DEFAULT_FILE_TYPES)) {
      expect(type.extension).not.toBe("");
    }
  });

  // Markdown is pinned - it is what the app is and cannot be turned off - so it is offered even
  // when nothing else is.
  it("still offers markdown when nothing else is turned on", () => {
    expect(newFileTypes([]).map((type) => type.id)).toEqual(["markdown"]);
  });
});

/// A document that has never been anywhere still needs an identity: it is a tab, and the tab strip
/// tells documents apart by path.
describe("draft paths", () => {
  it("cannot be mistaken for a file in a workspace", () => {
    // Every workspace path is relative and forward-slashed, so nothing on disk collides with this
    // and this shadows nothing on disk - the same trick the built-in guide uses.
    expect(draftPath(1, "notes.md").startsWith(DRAFT_PREFIX)).toBe(true);
    expect(isDraftPath(draftPath(1, "notes.md"))).toBe(true);
  });

  it("tells two drafts of the same name apart", () => {
    expect(draftPath(1, "notes.md")).not.toBe(draftPath(2, "notes.md"));
  });

  it("says an ordinary path is not one", () => {
    expect(isDraftPath("notes/plan.md")).toBe(false);
    expect(isDraftPath("")).toBe(false);
  });
});
