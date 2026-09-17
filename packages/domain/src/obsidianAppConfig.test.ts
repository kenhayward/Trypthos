import { describe, expect, it } from "vitest";
import { newNoteDirectory, newNoteLocationFrom } from "./obsidianAppConfig";

describe("where Obsidian puts a new note", () => {
  it("reads each of Obsidian's three settings", () => {
    expect(newNoteLocationFrom({ newFileLocation: "root" })).toEqual({ mode: "root" });
    expect(newNoteLocationFrom({ newFileLocation: "current" })).toEqual({ mode: "current" });
    expect(newNoteLocationFrom({ newFileLocation: "folder", newFileFolderPath: "Inbox/New" })).toEqual({
      mode: "folder",
      folder: "Inbox/New",
    });
  });

  it("falls back to the vault root for anything missing, unknown or unsafe", () => {
    expect(newNoteLocationFrom(null)).toEqual({ mode: "root" });
    expect(newNoteLocationFrom("not an object")).toEqual({ mode: "root" });
    expect(newNoteLocationFrom({})).toEqual({ mode: "root" });
    expect(newNoteLocationFrom({ newFileLocation: "elsewhere" })).toEqual({ mode: "root" });
    expect(newNoteLocationFrom({ newFileLocation: "folder" })).toEqual({ mode: "root" });
    expect(newNoteLocationFrom({ newFileLocation: "folder", newFileFolderPath: "../outside" })).toEqual({ mode: "root" });
  });

  it("normalises a folder's slashes", () => {
    expect(newNoteLocationFrom({ newFileLocation: "folder", newFileFolderPath: "/Inbox//New/" })).toEqual({
      mode: "folder",
      folder: "Inbox/New",
    });
  });

  it("turns a location into the directory a new note is created in", () => {
    expect(newNoteDirectory({ mode: "root" }, "V", "V/a/From.md")).toBe("V");
    expect(newNoteDirectory({ mode: "folder", folder: "Inbox" }, "V", null)).toBe("V/Inbox");
    expect(newNoteDirectory({ mode: "current" }, "V", "V/a/b/From.md")).toBe("V/a/b");
    expect(newNoteDirectory({ mode: "current" }, "V", "V/From.md")).toBe("V");
    expect(newNoteDirectory({ mode: "current" }, "V", null)).toBe("V");
  });
});
