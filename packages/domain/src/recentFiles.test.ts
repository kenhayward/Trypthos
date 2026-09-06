import { describe, expect, it } from "vitest";
import {
  RECENT_FILES_LIMIT,
  RecentFileSchema,
  noteRecentFile,
  recentFileLabel,
} from "./recentFiles";

const file = (root: string, path: string) => ({ root, path });

describe("noteRecentFile", () => {
  it("puts the newest at the front", () => {
    const list = noteRecentFile(noteRecentFile([], file("/ws", "a.md")), file("/ws", "b.md"));
    expect(list).toEqual([file("/ws", "b.md"), file("/ws", "a.md")]);
  });

  // Reopening a file moves it up rather than adding it twice. A list with the same file three times
  // is a list that remembers less than it looks like it does.
  it("moves a file already in the list rather than repeating it", () => {
    const list = [file("/ws", "a.md"), file("/ws", "b.md"), file("/ws", "c.md")].reduce(
      (acc, entry) => noteRecentFile(acc, entry),
      [] as ReturnType<typeof noteRecentFile>,
    );

    expect(noteRecentFile(list, file("/ws", "c.md"))).toEqual([
      file("/ws", "c.md"),
      file("/ws", "b.md"),
      file("/ws", "a.md"),
    ]);
  });

  // The same relative path in two different folders is two different files, and a list that
  // conflated them would take you to the wrong one.
  it("tells apart the same path in two workspaces", () => {
    const list = noteRecentFile(noteRecentFile([], file("/one", "notes.md")), file("/two", "notes.md"));
    expect(list).toHaveLength(2);
  });

  it("keeps the list to its limit, dropping the oldest", () => {
    let list = noteRecentFile([], file("/ws", "old.md"));
    for (let n = 0; n < RECENT_FILES_LIMIT; n += 1) {
      list = noteRecentFile(list, file("/ws", `${n}.md`));
    }

    expect(list).toHaveLength(RECENT_FILES_LIMIT);
    expect(list.some((entry) => entry.path === "old.md")).toBe(false);
  });

  it("never mutates the list it was given", () => {
    const list = [file("/ws", "a.md")];
    noteRecentFile(list, file("/ws", "b.md"));
    expect(list).toEqual([file("/ws", "a.md")]);
  });
});

/// What a recent entry is called on the menu.
///
/// The path alone is not enough: the same relative path in two folders would give two entries that
/// read identically, and the point of the menu is choosing between them.
describe("recentFileLabel", () => {
  it("names the file and the folder it is in", () => {
    expect(recentFileLabel(file("D:/Notes", "docs/plan.md"))).toBe("docs/plan.md - Notes");
  });

  it("reads a Windows root as well as a posix one", () => {
    expect(recentFileLabel(file("D:\\Notes\\Work", "plan.md"))).toBe("plan.md - Work");
  });

  // A drive root has no last segment to name. The whole thing is the name.
  it("falls back to the root itself when it has no last segment", () => {
    expect(recentFileLabel(file("D:/", "plan.md"))).toBe("plan.md - D:");
  });

  // Electron reads `&` in a menu label as a mnemonic marker and swallows it, so a file called
  // "Q&A.md" would appear on the menu as "QA.md" with an underlined A. Doubling it is how a literal
  // ampersand is written, and nothing about the failure looks like an escaping problem.
  it("doubles an ampersand, which a menu would otherwise eat", () => {
    expect(recentFileLabel(file("/ws", "Q&A.md"))).toBe("Q&&A.md - ws");
  });
});

describe("RecentFileSchema", () => {
  it("takes a workspace root and a path within it", () => {
    expect(RecentFileSchema.safeParse(file("/ws", "a.md")).success).toBe(true);
  });

  it("refuses an entry that names neither", () => {
    expect(RecentFileSchema.safeParse({ root: "", path: "a.md" }).success).toBe(false);
    expect(RecentFileSchema.safeParse({ root: "/ws", path: "" }).success).toBe(false);
  });

  it("refuses an entry carrying anything else", () => {
    expect(RecentFileSchema.safeParse({ ...file("/ws", "a.md"), content: "x" }).success).toBe(false);
  });
});
