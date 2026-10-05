import { describe, expect, it } from "vitest";
import {
  DRIVE_API,
  DriveFileListSchema,
  DriveIdSchema,
  FOLDER_MIME,
  GOOGLE_DOC_MIME,
  childrenToEntries,
  childrenUrl,
  displayNameFor,
  driveErrorFor,
  driveMediaUrl,
  exportUrl,
  fileUrl,
  foldersOf,
  isDriveId,
  sharedDrivesUrl,
  type DriveFile,
} from "./googleDrive";

/// The pure half of reading Google Drive: every URL the shell asks, every shape it accepts, and the
/// one function that decides what a folder's listing shows in the tree.

const file = (overrides: Partial<DriveFile> & { id: string; name: string }): DriveFile => ({
  mimeType: "text/markdown",
  ...overrides,
});

describe("Drive ids", () => {
  it("accepts the alphabet Drive ids are made of", () => {
    expect(isDriveId("1H60_yEnI5d4GT-qNk")).toBe(true);
    expect(isDriveId("root")).toBe(true);
    expect(DriveIdSchema.safeParse("0AbcDEF").success).toBe(true);
  });

  // An id is spliced into a query string. Anything outside the alphabet - a quote above all - is
  // refused before it can be read as query syntax.
  it("refuses anything that could be read as query syntax", () => {
    for (const bad of ["", "a'b", "a b", "a/b", "a\\b", "x".repeat(257), "id' or name contains 'x"]) {
      expect(isDriveId(bad)).toBe(false);
    }
  });
});

describe("URLs", () => {
  it("lists a folder's children, newest page first, across Shared Drives", () => {
    const url = new URL(childrenUrl("folder1", null));
    expect(`${url.origin}${url.pathname}`).toBe(`${DRIVE_API}/files`);
    expect(url.searchParams.get("q")).toBe("'folder1' in parents and trashed = false");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(url.searchParams.get("pageSize")).toBe("1000");
    expect(url.searchParams.get("fields")).toContain("nextPageToken");
    expect(url.searchParams.get("fields")).toContain("headRevisionId");
    expect(url.searchParams.has("pageToken")).toBe(false);
  });

  it("carries the page token and can ask for folders only", () => {
    const url = new URL(childrenUrl("folder1", "page-2", true));
    expect(url.searchParams.get("pageToken")).toBe("page-2");
    expect(url.searchParams.get("q")).toBe(`'folder1' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`);
  });

  it("builds the per-file addresses", () => {
    expect(fileUrl("f1")).toMatch(new RegExp(`^${DRIVE_API}/files/f1\\?`));
    expect(new URL(fileUrl("f1")).searchParams.get("supportsAllDrives")).toBe("true");
    expect(new URL(driveMediaUrl("f1")).searchParams.get("alt")).toBe("media");
    expect(new URL(exportUrl("f1")).searchParams.get("mimeType")).toBe("text/markdown");
    expect(new URL(exportUrl("f1")).pathname).toBe("/drive/v3/files/f1/export");
    expect(new URL(sharedDrivesUrl(null)).pathname).toBe("/drive/v3/drives");
    expect(new URL(sharedDrivesUrl("p2")).searchParams.get("pageToken")).toBe("p2");
  });
});

describe("response schemas", () => {
  it("reads a listing, with and without a next page", () => {
    const parsed = DriveFileListSchema.parse({
      nextPageToken: "p2",
      files: [{ id: "a", name: "A.md", mimeType: "text/markdown", size: "12", headRevisionId: "r1" }],
    });
    expect(parsed.files[0]!.size).toBe("12");
    expect(DriveFileListSchema.parse({}).files).toEqual([]);
  });
});

describe("driveErrorFor", () => {
  it("maps statuses to the reasons the interface words", () => {
    expect(driveErrorFor(401, null)).toBe("not-connected");
    expect(driveErrorFor(404, null)).toBe("not-found");
    expect(driveErrorFor(429, null)).toBe("rate-limited");
    expect(driveErrorFor(500, null)).toBe("offline");
  });

  // Drive answers both "you may not" and "slow down" with 403, telling them apart in the body.
  it("reads a 403's reason to tell a rate limit from a refusal", () => {
    const limited = { error: { errors: [{ reason: "userRateLimitExceeded" }] } };
    expect(driveErrorFor(403, limited)).toBe("rate-limited");
    expect(driveErrorFor(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } })).toBe("rate-limited");
    expect(driveErrorFor(403, { error: { errors: [{ reason: "insufficientFilePermissions" }] } })).toBe("permission-denied");
    expect(driveErrorFor(403, "not json")).toBe("permission-denied");
  });
});

describe("displayNameFor", () => {
  it("gives a Google Doc a markdown name, since that is what it opens as", () => {
    expect(displayNameFor({ name: "Plans", mimeType: GOOGLE_DOC_MIME })).toBe("Plans.md");
    expect(displayNameFor({ name: "Plans.md", mimeType: GOOGLE_DOC_MIME })).toBe("Plans.md");
    expect(displayNameFor({ name: "Plans", mimeType: "text/plain" })).toBe("Plans");
  });

  // Drive allows these in a name; a path cannot hold them.
  it("replaces what a path cannot hold", () => {
    expect(displayNameFor({ name: "a/b\\c:d.md", mimeType: "text/markdown" })).toBe("a_b_c_d.md");
    expect(displayNameFor({ name: "tab\there.md", mimeType: "text/markdown" })).toBe("tab_here.md");
    for (const name of ["", "   ", ".", ".."]) {
      expect(displayNameFor({ name, mimeType: "text/markdown" })).toBe("_");
    }
  });
});

describe("childrenToEntries", () => {
  it("turns a listing into tree entries under their parent's path, folders first", () => {
    const entries = childrenToEntries("Notes", [
      file({ id: "f1", name: "b.md", size: "5", headRevisionId: "r1" }),
      file({ id: "d1", name: "Archive", mimeType: FOLDER_MIME }),
      file({ id: "f2", name: "A.md" }),
    ]);

    expect(entries.map((entry) => entry.path)).toEqual(["Notes/Archive", "Notes/A.md", "Notes/b.md"]);
    expect(entries[0]).toMatchObject({ kind: "directory", fileId: "d1" });
    expect(entries[2]).toMatchObject({ kind: "file", fileId: "f1", sizeBytes: 5, revision: "r1", googleDoc: false });
    expect(entries[1]!.sizeBytes).toBeNull();
  });

  it("puts root children at the top level", () => {
    expect(childrenToEntries("", [file({ id: "f1", name: "a.md" })])[0]!.path).toBe("a.md");
  });

  // Trash, shortcuts (whose target can be outside the workspace) and Google types other than Docs
  // and folders have no text to show.
  it("hides trash, shortcuts, and Google types it cannot open", () => {
    const entries = childrenToEntries("", [
      file({ id: "t", name: "gone.md", trashed: true }),
      file({ id: "s", name: "link", mimeType: "application/vnd.google-apps.shortcut" }),
      file({ id: "x", name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet" }),
      file({ id: "p", name: "photo.png", mimeType: "image/png" }),
      file({ id: "g", name: "Plans", mimeType: GOOGLE_DOC_MIME, modifiedTime: "2026-10-01T10:00:00Z" }),
    ]);

    expect(entries.map((entry) => entry.name)).toEqual(["photo.png", "Plans.md"]);
    // A Google Doc has no headRevisionId; its revision is its modified time.
    expect(entries[1]).toMatchObject({ googleDoc: true, revision: "modified:2026-10-01T10:00:00Z" });
  });

  // Drive allows siblings with one name. A path must name one file, so the second and later get a
  // suffix from their id - decided by creation time, then id, so the same listing always gives the
  // same names.
  it("suffixes the second of two same-named siblings, deterministically, keeping the extension", () => {
    const listing = [
      file({ id: "zzzzzz9", name: "Notes.md", createdTime: "2026-02-01T00:00:00Z" }),
      file({ id: "aaaaaa1", name: "Notes.md", createdTime: "2026-01-01T00:00:00Z" }),
    ];
    const once = childrenToEntries("", listing);
    const again = childrenToEntries("", [...listing].reverse());

    expect(once.map((entry) => [entry.name, entry.fileId])).toEqual([
      ["Notes.md", "aaaaaa1"],
      ["Notes~zzzzzz.md", "zzzzzz9"],
    ]);
    expect(again).toEqual(once);
  });

  it("suffixes after the display name is decided, so a Doc and a file named alike do not collide", () => {
    const entries = childrenToEntries("", [
      file({ id: "doc0001", name: "Plans", mimeType: GOOGLE_DOC_MIME, createdTime: "2026-01-01T00:00:00Z" }),
      file({ id: "md00002", name: "Plans.md", createdTime: "2026-01-02T00:00:00Z" }),
    ]);
    expect(entries.map((entry) => entry.name).sort()).toEqual(["Plans.md", "Plans~md0000.md"]);
  });

  it("suffixes a name with no extension at its end", () => {
    const entries = childrenToEntries("", [
      file({ id: "aaaaaa1", name: "README", mimeType: "text/plain", createdTime: "1" }),
      file({ id: "bbbbbb2", name: "README", mimeType: "text/plain", createdTime: "2" }),
    ]);
    expect(entries.map((entry) => entry.name)).toEqual(["README", "README~bbbbbb"]);
  });
});

describe("foldersOf", () => {
  it("keeps only live folders, with their real names", () => {
    expect(
      foldersOf([
        file({ id: "d1", name: "Work/2026", mimeType: FOLDER_MIME }),
        file({ id: "d2", name: "Old", mimeType: FOLDER_MIME, trashed: true }),
        file({ id: "f1", name: "a.md" }),
      ]),
    ).toEqual([{ id: "d1", name: "Work/2026" }]);
  });
});
