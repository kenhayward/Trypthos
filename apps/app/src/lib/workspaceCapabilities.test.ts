import { describe, expect, it } from "vitest";
import { canEditTree, opensInBrowser } from "./workspaceCapabilities";

describe("what the tree offers for each kind of workspace", () => {
  it("edits the tree of a folder on disk, a Drive folder and a OneDrive folder, and not a repository", () => {
    expect(canEditTree({ kind: "local" })).toBe(true);
    expect(canEditTree({ kind: "google-drive" })).toBe(true);
    expect(canEditTree({ kind: "onedrive" })).toBe(true);
    expect(canEditTree({ kind: "github" })).toBe(false);
  });

  it("shows a Drive or OneDrive entry in the browser, and nothing else there", () => {
    expect(opensInBrowser({ kind: "google-drive" })).toBe(true);
    expect(opensInBrowser({ kind: "onedrive" })).toBe(true);
    expect(opensInBrowser({ kind: "local" })).toBe(false);
    expect(opensInBrowser({ kind: "github" })).toBe(false);
  });
});
