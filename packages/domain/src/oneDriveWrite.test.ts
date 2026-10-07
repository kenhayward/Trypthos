import { describe, expect, it } from "vitest";
import {
  GRAPH_API,
  ONEDRIVE_UPLOAD_LIMIT_BYTES,
  OneDriveTagSchema,
  isOneDriveTag,
  oneDriveCreateFolderUrl,
  oneDriveCreateUrl,
  oneDriveFolderBody,
  oneDrivePathKey,
  oneDriveRenameUrl,
  oneDriveUploadUrl,
  oneDriveWriteFailure,
} from "./oneDrive";

const DRIVE = "d0c0ffee";

describe("the write addresses", () => {
  it("saves a file's content by its path, one encoded segment at a time", () => {
    expect(oneDriveUploadUrl(DRIVE, "root", "Notes/Plan B.md")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root:/Notes/Plan%20B.md:/content`);
  });

  // `If-None-Match: *` was ignored in the spike and overwrote a file: this query is the only guard a
  // create has, so it is on every create address.
  it("creates a file by its path, asking Graph to fail on a name already in use", () => {
    expect(oneDriveCreateUrl(DRIVE, "ROOT!0", "Notes #1/a?.md")).toBe(
      `${GRAPH_API}/drives/d0c0ffee/items/ROOT!0:/Notes%20%231/a%3F.md:/content?@microsoft.graph.conflictBehavior=fail`,
    );
  });

  it("makes a folder among a folder's children, the workspace root's own included", () => {
    expect(oneDriveCreateFolderUrl(DRIVE, "root", "")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root/children`);
    expect(oneDriveCreateFolderUrl(DRIVE, "root", "Notes")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root:/Notes:/children`);
  });

  it("renames an item by its path", () => {
    expect(oneDriveRenameUrl(DRIVE, "root", "Notes/Plan.md")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root:/Notes/Plan.md:`);
  });

  // The workspace's own folder is never written, renamed or uploaded to; and a dot or empty segment
  // would be collapsed out of the address by the URL parser.
  it("refuses the root, and a path with an empty or dot segment, for a file or a rename", () => {
    for (const path of ["", ".", "..", "a/../b", "a//b", "a/"]) {
      expect(() => oneDriveUploadUrl(DRIVE, "root", path)).toThrow("unsafe OneDrive path");
      expect(() => oneDriveCreateUrl(DRIVE, "root", path)).toThrow("unsafe OneDrive path");
      expect(() => oneDriveRenameUrl(DRIVE, "root", path)).toThrow("unsafe OneDrive path");
    }
    expect(() => oneDriveCreateFolderUrl(DRIVE, "root", "a//b")).toThrow("unsafe OneDrive path");
  });

  // The empty path is the one the shared path builder answers with the item itself, so each of these
  // refuses it before asking: an upload or a rename of the workspace root must not become an address.
  it("refuses the empty path in each address that would otherwise be the item itself", () => {
    expect(() => oneDriveUploadUrl(DRIVE, "root", "")).toThrow("unsafe OneDrive path");
    expect(() => oneDriveCreateUrl(DRIVE, "root", "")).toThrow("unsafe OneDrive path");
    expect(() => oneDriveRenameUrl(DRIVE, "root", "")).toThrow("unsafe OneDrive path");
  });

  it("asks for a folder that fails on a name already in use", () => {
    expect(oneDriveFolderBody("Ideas")).toEqual({ name: "Ideas", folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
  });
});

describe("content tags", () => {
  it("accepts the tags Graph hands out", () => {
    for (const tag of ["ctag-1", '"c:{F2E8A0B1-1111-2222-3333-444455556666},2"', "ctag-ITEM!1", "x".repeat(256)]) {
      expect(isOneDriveTag(tag)).toBe(true);
      expect(OneDriveTagSchema.safeParse(tag).success).toBe(true);
    }
  });

  // It goes into an If-Match header. A line break would end the header and start another.
  it("refuses anything that could change the header it goes into, or is not a string", () => {
    for (const tag of ["", "a\r\nX-Injected: 1", "a\nb", "tab\tx", " ctag", "ctag ", "é", "x".repeat(257)]) {
      expect(isOneDriveTag(tag)).toBe(false);
      expect(OneDriveTagSchema.safeParse(tag).success).toBe(false);
    }
    for (const value of [null, undefined, 1, { id: "ctag-1" }]) expect(isOneDriveTag(value)).toBe(false);
  });
});

describe("the simple upload limit", () => {
  it("is four megabytes", () => {
    expect(ONEDRIVE_UPLOAD_LIMIT_BYTES).toBe(4_194_304);
  });
});

describe("oneDrivePathKey", () => {
  // OneDrive compares names without regard to case: one folder, however it is spelled, is one key.
  it("folds a path so two spellings of one folder are one key", () => {
    expect(oneDrivePathKey("Notes/Plan.md")).toBe(oneDrivePathKey("notes/PLAN.md"));
    expect(oneDrivePathKey("Ärger/X")).toBe(oneDrivePathKey("ärger/x"));
    expect(oneDrivePathKey("")).toBe("");
    expect(oneDrivePathKey("Notes")).not.toBe(oneDrivePathKey("Notes2"));
  });
});

// A write's refusals, which differ from a read's in two rows: Graph refusing the request outright
// did nothing, and a 503 may have come after the write landed.
describe("oneDriveWriteFailure", () => {
  it.each([
    [400, "invalidRequest", "bad-request"],
    [401, "InvalidAuthenticationToken", "not-connected"],
    [403, "accessDenied", "permission-denied"],
    [404, "itemNotFound", "not-found"],
    [409, "nameAlreadyExists", "exists"],
    [409, null, "conflict"],
    [412, null, "conflict"],
    [413, null, "too-large"],
    [429, "activityLimitReached", "rate-limited"],
    [503, null, "unknown"],
    [500, null, "offline"],
    [418, null, "unknown"],
  ])("%i %s is %s", (status, code, reason) => {
    expect(oneDriveWriteFailure(status, code)).toBe(reason);
  });
});
