import type { WorkspaceRef } from "@trypthos/domain";
import DriveGlyph, { type DriveGlyphKind } from "./DriveGlyph";
import SourceGlyph from "./SourceGlyph";
import { providerFailureKey } from "../hooks/useWorkspace";
import { GOOGLE_ACCOUNT, ONEDRIVE_ACCOUNT } from "../lib/cloudAccounts";
import type { CloudFolderSource, CloudPlace } from "../lib/cloudFolders";
import {
  googleAccount,
  oneDriveAccount,
  type DriveLocation,
  type GoogleBridge,
  type OneDriveBridge,
  type OneDriveLocation,
} from "../lib/workspaceClient";

/// The two clouds the shared folder picker browses. Each is a plain descriptor: its words as keys,
/// how a place is listed, what a chosen place opens as, and the mark each place is drawn with.

/// What to ask the shell to list for a Drive place. The top level, which is no place, lists the
/// shared drives - My Drive and Shared with me are fixed rows that need no listing.
function driveLocationOf(place: CloudPlace | null): DriveLocation {
  if (place === null) return { in: "drives" };
  if (place.kind === "shared-with-me" || place.id === null) return { in: "shared-with-me" };
  return { in: "folder", id: place.id };
}

function driveGlyphKind(place: CloudPlace): DriveGlyphKind {
  switch (place.kind) {
    case "my-drive":
      return "my-drive";
    case "shared-with-me":
      return "shared-with-me";
    case "shared-drive":
      return "shared-drive";
    default:
      return place.shared ? "shared-folder" : "folder";
  }
}

export function googleDriveFolderSource(bridge: GoogleBridge | null): CloudFolderSource {
  return {
    mark: "google-drive",
    markClass: "text-drive",
    titleKey: "drive.title",
    rootKey: "drive.root",
    roots: [
      { kind: "my-drive", id: "root", nameKey: "drive.myDrive", shared: false },
      { kind: "shared-with-me", id: null, nameKey: "drive.sharedWithMe", shared: true },
    ],
    topHeadingKey: "drive.sharedDrives",
    readOnlyNoteKey: "drive.readOnlyNote",
    account: GOOGLE_ACCOUNT,
    accountCalls: googleAccount(bridge),
    list: async (place) => (bridge === null ? { ok: false, reason: "not-desktop" } : bridge.listDriveFolders(driveLocationOf(place))),
    failureKey: (reason) => providerFailureKey("google-drive", reason) ?? "errors.unknown",
    // A row at the top level is a shared drive; below it, a folder, shown as shared when Drive says so
    // or when it sits under something that is.
    enter: (here, folder) =>
      here === null
        ? { kind: "shared-drive", id: folder.id, name: folder.name, driveId: folder.id, shared: false }
        : { kind: "folder", id: folder.id, name: folder.name, driveId: here.driveId, shared: folder.shared || here.shared },
    refFor: (place) => {
      if (place.kind === "shared-with-me" || place.id === null) return null;
      const ref: WorkspaceRef = {
        kind: "google-drive",
        folderId: place.id,
        ...(place.driveId === null ? {} : { driveId: place.driveId }),
        name: place.name,
      };
      return ref;
    },
    glyph: (place, className) => <DriveGlyph kind={driveGlyphKind(place)} className={className} />,
  };
}

/// What to ask the shell to list for a OneDrive place. The top level is never listed - its two places
/// are fixed - so this is only ever asked for a place.
function oneDriveLocationOf(place: CloudPlace): OneDriveLocation {
  if (place.kind === "my-files") return { in: "my-files" };
  if (place.kind === "shared-with-me" || place.id === null || place.driveId === null) return { in: "shared-with-me" };
  return { in: "folder", driveId: place.driveId, itemId: place.id };
}

export function oneDriveFolderSource(bridge: OneDriveBridge | null): CloudFolderSource {
  return {
    mark: "onedrive",
    markClass: "text-onedrive",
    titleKey: "oneDrivePicker.title",
    rootKey: "oneDrivePicker.root",
    roots: [
      { kind: "my-files", id: "root", nameKey: "oneDrivePicker.myFiles", shared: false },
      { kind: "shared-with-me", id: null, nameKey: "oneDrivePicker.sharedWithMe", shared: true },
    ],
    topHeadingKey: null,
    readOnlyNoteKey: "oneDrivePicker.readOnlyNote",
    account: ONEDRIVE_ACCOUNT,
    accountCalls: oneDriveAccount(bridge),
    // The top level lists nothing, but it still has to know whether there is an account to list with,
    // so it asks the account - which is what turns the dialog into the connect control when there is none.
    list: async (place) => {
      if (bridge === null) return { ok: false, reason: "not-desktop" };
      if (place === null) {
        const status = await bridge.oneDriveStatus();
        if (!status.configured) return { ok: false, reason: "not-configured" };
        if (!status.connected) return { ok: false, reason: "not-connected" };
        return { ok: true, folders: [] };
      }
      const answer = await bridge.listOneDriveFolders(oneDriveLocationOf(place));
      if (!answer.ok) return answer;
      return {
        ok: true,
        driveId: answer.driveId ?? null,
        folders: answer.folders.map((folder) => ({ id: folder.itemId, name: folder.name, shared: folder.shared, driveId: folder.driveId })),
      };
    },
    failureKey: (reason) => providerFailureKey("onedrive", reason) ?? "errors.unknown",
    // Every OneDrive folder names its own drive: a shared one lives in its owner's.
    enter: (here, folder) => ({
      kind: "folder",
      id: folder.id,
      name: folder.name,
      driveId: folder.driveId ?? here?.driveId ?? null,
      shared: folder.shared || (here !== null && here.shared),
    }),
    refFor: (place) => {
      if (place.kind === "shared-with-me" || place.id === null || place.driveId === null) return null;
      const ref: WorkspaceRef = {
        kind: "onedrive",
        driveId: place.driveId,
        itemId: place.id,
        ...(place.shared ? { shared: true as const } : {}),
        name: place.name,
      };
      return ref;
    },
    // My files carries OneDrive's own mark; everything else the app's generic folder outlines.
    glyph: (place, className) =>
      place.kind === "my-files" ? (
        <SourceGlyph mark="onedrive" className={className} />
      ) : (
        <DriveGlyph kind={place.kind === "shared-with-me" ? "shared-with-me" : place.shared ? "shared-folder" : "folder"} className={className} />
      ),
  };
}

/// Every catalogue key the folder sources name. They are looked up as `t(source.titleKey)` and the
/// like, which the i18n guard cannot see as calls, so it reads this list instead: exactly these keys.
export function cloudFolderKeys(): string[] {
  return [googleDriveFolderSource(null), oneDriveFolderSource(null)].flatMap((source) => [
    source.titleKey,
    source.rootKey,
    source.readOnlyNoteKey,
    ...source.roots.map((root) => root.nameKey),
    ...(source.topHeadingKey === null ? [] : [source.topHeadingKey]),
  ]);
}
