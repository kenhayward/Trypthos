import { describe, expect, it } from "vitest";
import { googleDocIds, googleDocTitle } from "./googleDocs";
import type { FolderState } from "./treeRows";

const FOLDERS: Record<string, FolderState> = {
  Notes: {
    status: "loaded",
    children: [
      { id: "Notes/Plan.md", name: "Plan.md", kind: "file" },
      { id: "Notes/Meeting.md", name: "Meeting.md", kind: "file", googleDoc: true },
    ],
  },
  "Notes/Archive": { status: "loading" },
};

describe("googleDocIds", () => {
  it("collects every Google Doc in a listed folder, and nothing else", () => {
    expect([...googleDocIds(FOLDERS)]).toEqual(["Notes/Meeting.md"]);
  });
});

describe("googleDocTitle", () => {
  it("is the Doc's own title, without the .md it opens as", () => {
    expect(googleDocTitle("Notes/Meeting.md", googleDocIds(FOLDERS))).toBe("Meeting");
  });

  it("is null for anything that is not a Doc", () => {
    expect(googleDocTitle("Notes/Plan.md", googleDocIds(FOLDERS))).toBeNull();
  });
});
