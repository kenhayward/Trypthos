import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import { cloudFolderKeys, googleDriveFolderSource, oneDriveFolderSource } from "./cloudFolderSources";

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
}

describe("the folder sources and the catalogue", () => {
  // They are looked up as t(source.titleKey) and the like, which the i18n guard cannot see as calls.
  it("name only keys that exist", () => {
    for (const key of cloudFolderKeys()) expect(typeof lookup(key), key).toBe("string");
  });

  it("name each source's title, root crumb, places, heading and note", () => {
    expect(cloudFolderKeys()).toEqual(
      expect.arrayContaining(["drive.title", "drive.root", "drive.sharedDrives", "oneDrivePicker.title", "oneDrivePicker.myFiles", "oneDrivePicker.readOnlyNote"]),
    );
  });
});

describe("what a chosen place opens as", () => {
  it("opens nothing for Shared with me, and a OneDrive place only once its drive is known", () => {
    const source = oneDriveFolderSource(null);
    expect(source.refFor({ kind: "shared-with-me", id: null, name: "Shared with me", driveId: null, shared: true })).toBeNull();
    expect(source.refFor({ kind: "my-files", id: "root", name: "My files", driveId: null, shared: false })).toBeNull();
    expect(source.refFor({ kind: "my-files", id: "root", name: "My files", driveId: "d0c0ffee", shared: false })).toEqual({
      kind: "onedrive",
      driveId: "d0c0ffee",
      itemId: "root",
      name: "My files",
    });
  });

  it("makes Google's references exactly as the Drive picker always has", () => {
    const source = googleDriveFolderSource(null);
    expect(source.refFor({ kind: "my-drive", id: "root", name: "My Drive", driveId: null, shared: false })).toEqual({
      kind: "google-drive",
      folderId: "root",
      name: "My Drive",
    });
    expect(source.refFor({ kind: "folder", id: "dirEEE", name: "2026", driveId: "sharedDDD", shared: false })).toEqual({
      kind: "google-drive",
      folderId: "dirEEE",
      driveId: "sharedDDD",
      name: "2026",
    });
    expect(source.refFor({ kind: "shared-with-me", id: null, name: "Shared with me", driveId: null, shared: true })).toBeNull();
  });
});
