import { describe, expect, it } from "vitest";
import { canEditTree, opensInBrowser } from "./workspaceCapabilities";

describe("what the tree offers for each kind of workspace", () => {
  // OneDrive gains New File, New Folder and rename with its writes, in PR 3.
  it("edits the tree of a folder on disk and a Drive folder, and not yet a OneDrive folder", () => {
    expect(canEditTree({ kind: "local" })).toBe(true);
    expect(canEditTree({ kind: "google-drive" })).toBe(true);
    expect(canEditTree({ kind: "onedrive" })).toBe(false);
    expect(canEditTree({ kind: "github" })).toBe(false);
  });

  it("shows a Drive or OneDrive entry in the browser, and nothing else there", () => {
    expect(opensInBrowser({ kind: "google-drive" })).toBe(true);
    expect(opensInBrowser({ kind: "onedrive" })).toBe(true);
    expect(opensInBrowser({ kind: "local" })).toBe(false);
    expect(opensInBrowser({ kind: "github" })).toBe(false);
  });
});
