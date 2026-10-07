import { describe, expect, it } from "vitest";
import {
  GRAPH_API,
  MAX_RETRY_AFTER_MS,
  ONEDRIVE_MY_DRIVE_URL,
  OneDriveDriveSchema,
  OneDriveIdSchema,
  OneDriveItemSchema,
  OneDrivePageSchema,
  contentRangeMatches,
  graphErrorCode,
  isGraphUrl,
  isHttpsUrl,
  isOneDriveId,
  oneDriveChildrenUrl,
  oneDriveContentUrl,
  oneDriveEntriesOf,
  oneDriveFailure,
  oneDriveFoldersOf,
  oneDriveItemUrl,
  oneDriveMetaUrl,
  oneDrivePathUrl,
  oneDriveSharedWithMeUrl,
  retryAfterMs,
  sameOneDriveId,
} from "./oneDrive";

const DRIVE = "d0c0ffee";
const SELECT = "$select=id,name,size,folder,file,eTag,cTag,webUrl,parentReference,remoteItem";

describe("OneDrive ids", () => {
  it("accepts a personal drive id, an item id and the root alias", () => {
    for (const id of [DRIVE, "D0C0FFEE!101", "root", "ITEM!1"]) {
      expect(isOneDriveId(id)).toBe(true);
      expect(OneDriveIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("refuses anything that could change an address", () => {
    for (const id of ["", "../x", "a/b", "a?b", "a#b", "a b", "a%2Fb", "x".repeat(257)]) {
      expect(isOneDriveId(id)).toBe(false);
      expect(OneDriveIdSchema.safeParse(id).success).toBe(false);
    }
  });

  // A parser collapses `/drives/../` and `/items/..`, so an id made only of dots could leave its slot.
  it("refuses an id that starts with a dot, and keeps the real shapes", () => {
    for (const id of [".", "..", "...", ".hidden", "_x", "-x", "!x"]) {
      expect(isOneDriveId(id)).toBe(false);
      expect(OneDriveIdSchema.safeParse(id).success).toBe(false);
    }
    for (const id of ["ABC123DEF!123", "root", "a.b-c_d"]) expect(isOneDriveId(id)).toBe(true);
  });

  it("compares drive ids without regard to case", () => {
    expect(sameOneDriveId("d0c0ffee", "D0C0FFEE")).toBe(true);
    expect(sameOneDriveId("d0c0ffee", "beefcafe")).toBe(false);
  });
});

describe("Graph addresses", () => {
  it("names an item by id, and by a path below it, one encoded segment at a time", () => {
    expect(oneDriveItemUrl(DRIVE, "root")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root`);
    expect(oneDrivePathUrl(DRIVE, "root", "")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root`);
    // A `#`, `?` or `%` in a name must not end the path or start a query; a space and a non-ASCII
    // letter are encoded too. The `/` between segments is the one character left as it is.
    expect(oneDrivePathUrl(DRIVE, "ITEM!3", "Notes #1/50% done?/naïve plan.md")).toBe(
      `${GRAPH_API}/drives/d0c0ffee/items/ITEM!3:/Notes%20%231/50%25%20done%3F/na%C3%AFve%20plan.md:`,
    );
  });

  // A `..` would be collapsed by the URL parser and leave the anchor item; an empty segment makes `//`.
  it("refuses a path with an empty, dot or dot-dot segment", () => {
    for (const path of ["..", ".", "a/../b", "/a", "a/", "a//b", "../x"]) {
      expect(() => oneDrivePathUrl(DRIVE, "root", path)).toThrow("unsafe OneDrive path");
      expect(() => oneDriveMetaUrl(DRIVE, "root", path)).toThrow("unsafe OneDrive path");
      expect(() => oneDriveChildrenUrl(DRIVE, "root", path)).toThrow("unsafe OneDrive path");
    }
    // The empty path is the item itself, and never throws.
    expect(oneDrivePathUrl(DRIVE, "root", "")).toBe(oneDriveItemUrl(DRIVE, "root"));
    expect(oneDrivePathUrl(DRIVE, "root", "a..b/.c")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root:/a..b/.c:`);
  });

  it("asks for an item's fields, a folder's children a page at a time, and a file's content", () => {
    expect(oneDriveMetaUrl(DRIVE, "root", "a.md")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root:/a.md:?${SELECT}`);
    expect(oneDriveMetaUrl(DRIVE, "root", "")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root?${SELECT}`);
    expect(oneDriveChildrenUrl(DRIVE, "root", "")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root/children?$top=200&${SELECT}`);
    expect(oneDriveChildrenUrl(DRIVE, "root", "Notes")).toBe(
      `${GRAPH_API}/drives/d0c0ffee/items/root:/Notes:/children?$top=200&${SELECT}`,
    );
    expect(oneDriveContentUrl(DRIVE, "ITEM!1")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/ITEM!1/content`);
  });

  it("asks for the connected drive and for what is shared with the user", () => {
    expect(ONEDRIVE_MY_DRIVE_URL).toBe("https://graph.microsoft.com/v1.0/me/drive?$select=id,driveType");
    expect(oneDriveSharedWithMeUrl()).toBe("https://graph.microsoft.com/v1.0/me/drive/sharedWithMe");
  });

  // A next page's address comes from Graph's answer, and the token goes with it.
  it("knows a Graph address from anywhere else", () => {
    expect(isGraphUrl(`${GRAPH_API}/drives/d0c0ffee/items/root/children?$skiptoken=p2`)).toBe(true);
    expect(isGraphUrl("http://graph.microsoft.com/v1.0/me")).toBe(false);
    expect(isGraphUrl("https://graph.microsoft.com.example/v1.0/me")).toBe(false);
    expect(isGraphUrl("https://graph.microsoft.com/beta/me")).toBe(false);
    expect(isGraphUrl("not a url")).toBe(false);
  });

  it("opens only https addresses", () => {
    expect(isHttpsUrl("https://onedrive.live.com/?id=ITEM!1")).toBe(true);
    expect(isHttpsUrl("http://onedrive.live.com/")).toBe(false);
    expect(isHttpsUrl("file:///C:/x")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("")).toBe(false);
  });
});

describe("what Graph answers", () => {
  // The spike's shapes: a file with both tags, a folder with no cTag, and a shared folder in the
  // user's own drive, which is a remote item pointing into somebody else's.
  const FILE = {
    id: "ITEM!1",
    name: "Plan.md",
    size: 5,
    eTag: "e1",
    cTag: "c1",
    webUrl: "https://onedrive.live.com/?id=ITEM!1",
    file: { mimeType: "text/markdown" },
    parentReference: { driveId: DRIVE },
    "@microsoft.graph.downloadUrl": "https://download.invented.example/x",
  };
  const FOLDER = { id: "ITEM!2", name: "Archive", eTag: "e2", folder: { childCount: 3 } };
  const REMOTE = {
    id: "LINK!9",
    name: "Joint",
    remoteItem: { id: "SHARED!7", folder: { childCount: 1 }, parentReference: { driveId: "beefcafe" } },
  };

  it("accepts a file, a folder and a remote item, dropping what it did not ask for", () => {
    const file = OneDriveItemSchema.parse(FILE);
    expect(file.cTag).toBe("c1");
    expect("@microsoft.graph.downloadUrl" in file).toBe(false);
    expect(OneDriveItemSchema.parse(FOLDER).cTag).toBeUndefined();
    expect(OneDriveItemSchema.parse(REMOTE).remoteItem?.parentReference?.driveId).toBe("beefcafe");
  });

  it("refuses an item without an id or a name, or with a size that is not a number", () => {
    expect(OneDriveItemSchema.safeParse({ name: "a" }).success).toBe(false);
    expect(OneDriveItemSchema.safeParse({ id: "a" }).success).toBe(false);
    expect(OneDriveItemSchema.safeParse({ ...FILE, size: "5" }).success).toBe(false);
  });

  it("reads a page and its next link, and refuses a page without a value", () => {
    const page = OneDrivePageSchema.parse({ value: [FILE], "@odata.nextLink": `${GRAPH_API}/x?$skiptoken=2` });
    expect(page.value).toHaveLength(1);
    expect(page["@odata.nextLink"]).toBe(`${GRAPH_API}/x?$skiptoken=2`);
    expect(OneDrivePageSchema.safeParse({}).success).toBe(false);
  });

  it("refuses a next link that is not Graph's own", () => {
    for (const link of ["https://evil.example/v1.0/x", "http://graph.microsoft.com/v1.0/x", "nope"]) {
      expect(OneDrivePageSchema.safeParse({ value: [], "@odata.nextLink": link }).success).toBe(false);
    }
  });

  it("reads the connected drive", () => {
    expect(OneDriveDriveSchema.parse({ id: DRIVE, driveType: "personal", owner: {} })).toEqual({ id: DRIVE, driveType: "personal" });
    expect(OneDriveDriveSchema.safeParse({ driveType: "personal" }).success).toBe(false);
  });

  it("reads Graph's error code, or nothing", () => {
    expect(graphErrorCode({ error: { code: "itemNotFound", message: "x" } })).toBe("itemNotFound");
    expect(graphErrorCode({ error: "invalid_grant" })).toBeNull();
    expect(graphErrorCode(null)).toBeNull();
  });
});

// The spec's error table, row by row.
describe("oneDriveFailure", () => {
  it.each([
    [401, "InvalidAuthenticationToken", "not-connected"],
    [403, "accessDenied", "permission-denied"],
    [404, "itemNotFound", "not-found"],
    [409, "nameAlreadyExists", "exists"],
    [409, null, "conflict"],
    [412, null, "conflict"],
    [413, null, "too-large"],
    [429, "activityLimitReached", "rate-limited"],
    [503, null, "rate-limited"],
    [400, "invalidRequest", "unknown"],
    [500, null, "offline"],
    [502, null, "offline"],
  ])("%i %s is %s", (status, code, reason) => {
    expect(oneDriveFailure(status, code)).toBe(reason);
  });
});

describe("retryAfterMs", () => {
  it.each([
    ["5", 5_000],
    ["60", 10_000],
    [null, 1_000],
    ["Wed, 21 Oct 2026 07:28:00 GMT", 1_000],
    ["-1", 1_000],
  ])("Retry-After %s waits %i ms", (header, ms) => {
    expect(retryAfterMs(header)).toBe(ms);
  });

  it("never waits more than ten seconds", () => {
    expect(MAX_RETRY_AFTER_MS).toBe(10_000);
  });
});

describe("contentRangeMatches", () => {
  it("accepts exactly the range that was asked for", () => {
    expect(contentRangeMatches("bytes 5-9/20", 5, 9)).toBe(true);
    expect(contentRangeMatches("bytes 5-9/*", 5, 9)).toBe(true);
  });

  it("refuses another range, a missing header and nonsense", () => {
    expect(contentRangeMatches("bytes 0-4/20", 5, 9)).toBe(false);
    expect(contentRangeMatches("bytes 5-10/20", 5, 9)).toBe(false);
    expect(contentRangeMatches(null, 5, 9)).toBe(false);
    expect(contentRangeMatches("5-9", 5, 9)).toBe(false);
  });
});

describe("oneDriveEntriesOf", () => {
  const items = OneDrivePageSchema.parse({
    value: [
      { id: "ITEM!1", name: "plan.md", size: 5, cTag: "c1", file: {} },
      { id: "ITEM!2", name: "Archive", folder: {} },
      { id: "ITEM!3", name: "Zeta.md", file: {} },
      { id: "ITEM!4", name: "alpha", folder: {} },
      { id: "LINK!9", name: "Joint", remoteItem: { id: "SHARED!7", folder: {}, parentReference: { driveId: "beefcafe" } } },
      { id: "NB!1", name: "Notebook" },
      { id: "BAD!1", name: "a\\b", file: {} },
      { id: "..", name: "dots.md", file: {} },
    ],
  }).value;

  it("leaves out an entry whose id could not be sent back", () => {
    expect(oneDriveEntriesOf(items).map((entry) => entry.name)).not.toContain("dots.md");
  });

  it("lists folders first, then files, by name whatever the case", () => {
    expect(oneDriveEntriesOf(items).map((entry) => entry.name)).toEqual(["alpha", "Archive", "plan.md", "Zeta.md"]);
  });

  // A remote item lives in another drive, and a path cannot cross into one; a notebook is neither a
  // file nor a folder; a name holding a separator would read as two path segments.
  it("leaves out remote items, notebooks and names a path cannot carry", () => {
    const names = oneDriveEntriesOf(items).map((entry) => entry.name);
    expect(names).not.toContain("Joint");
    expect(names).not.toContain("Notebook");
    expect(names).not.toContain("a\\b");
  });

  it("carries the id, the content tag and the size, or null where Graph sent none", () => {
    expect(oneDriveEntriesOf(items).find((entry) => entry.name === "plan.md")).toEqual({
      name: "plan.md",
      kind: "file",
      itemId: "ITEM!1",
      cTag: "c1",
      sizeBytes: 5,
    });
    expect(oneDriveEntriesOf(items).find((entry) => entry.name === "Zeta.md")).toEqual({
      name: "Zeta.md",
      kind: "file",
      itemId: "ITEM!3",
      cTag: null,
      sizeBytes: null,
    });
  });
});

describe("oneDriveFoldersOf", () => {
  const items = OneDrivePageSchema.parse({
    value: [
      { id: "ITEM!2", name: "Projects", folder: {} },
      { id: "ITEM!1", name: "Plan.md", file: {} },
      { id: "LINK!9", name: "Joint", remoteItem: { id: "SHARED!7", folder: {}, parentReference: { driveId: "beefcafe" } } },
      { id: "LINK!8", name: "notes.md", remoteItem: { id: "SHARED!6", parentReference: { driveId: "beefcafe" } } },
      { id: "LINK!7", name: "Nowhere", remoteItem: { id: "SHARED!5", folder: {} } },
    ],
  }).value;

  it("answers a drive's folders and the shared folders in it, by name", () => {
    expect(oneDriveFoldersOf(items, DRIVE)).toEqual([
      { driveId: "beefcafe", itemId: "SHARED!7", name: "Joint", shared: true },
      { driveId: DRIVE, itemId: "ITEM!2", name: "Projects", shared: false },
    ]);
  });

  it("drops a folder whose name a path cannot carry", () => {
    const bad = OneDrivePageSchema.parse({
      value: [
        { id: "ITEM!5", name: "a/b", folder: {} },
        { id: "ITEM!6", name: "..", folder: {} },
        { id: "LINK!6", name: "x\\y", remoteItem: { id: "SHARED!4", folder: {}, parentReference: { driveId: "beefcafe" } } },
        { id: "ITEM!7", name: "Fine", folder: {} },
      ],
    }).value;
    expect(oneDriveFoldersOf(bad, DRIVE).map((folder) => folder.name)).toEqual(["Fine"]);
  });

  // Shared with me has no drive of its own: only remote folders, each in the drive it lives in.
  it("answers only shared folders when there is no drive", () => {
    expect(oneDriveFoldersOf(items, null)).toEqual([{ driveId: "beefcafe", itemId: "SHARED!7", name: "Joint", shared: true }]);
  });
});
