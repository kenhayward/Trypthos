import type { ReactElement } from "react";
import type { WorkspaceMark, WorkspaceRef } from "@trypthos/domain";
import type { CloudAccountKind } from "./cloudAccounts";
import type { CloudAccountBridge } from "./workspaceClient";

/// What the shared cloud-folder picker is driven by: one descriptor per provider, so Google Drive and
/// OneDrive look and behave alike by construction rather than by two copies that drift. Keys, not
/// wording, as `cloudAccounts.ts`; the dialog translates.

/// One step of the breadcrumb: where the user went.
export interface CloudPlace {
  /// What kind of place. A source's fixed places name their own kinds ("my-drive", "my-files",
  /// "shared-with-me", "shared-drive"); "folder" is a folder anywhere below them.
  kind: string;
  /// The id to list and to open, or null for a place that is not a folder (Shared with me).
  id: string | null;
  name: string;
  /// The drive the place is in, when the provider needs one. Null until it is known.
  driveId: string | null;
  /// Whether the provider calls it shared, or the trail reached it through something that is.
  shared: boolean;
}

/// One folder in a listing.
export interface CloudFolder {
  id: string;
  name: string;
  shared: boolean;
  /// The drive this folder is in, when the provider names one per folder (OneDrive).
  driveId?: string;
}

/// What a place's listing came back with. `driveId` is the drive the listed place itself is in, for a
/// place that did not know it - OneDrive's My files learns its drive this way.
export type CloudFoldersResult = { ok: true; folders: CloudFolder[]; driveId?: string | null } | { ok: false; reason: string };

/// A fixed row at the top level: a place of the provider's own.
export interface CloudRoot {
  kind: string;
  id: string | null;
  nameKey: string;
  shared: boolean;
}

export interface CloudFolderSource {
  mark: WorkspaceMark;
  /// The colour class of the provider's mark, e.g. "text-drive".
  markClass: string;
  titleKey: string;
  /// The first crumb, and the breadcrumb's label.
  rootKey: string;
  roots: readonly CloudRoot[];
  /// The heading over the folders the top level lists (Drive's shared drives), or null for none.
  topHeadingKey: string | null;
  readOnlyNoteKey: string;
  account: CloudAccountKind;
  /// The account's calls, or null in the browser preview - where the dialog shows the account section,
  /// which says so.
  accountCalls: CloudAccountBridge | null;
  /// The folders in a place; null is the top level.
  list(place: CloudPlace | null): Promise<CloudFoldersResult>;
  failureKey(reason: string): string;
  /// The place a listed folder becomes when it is entered from `here`.
  enter(here: CloudPlace | null, folder: CloudFolder): CloudPlace;
  /// What a place opens as, or null where there is nothing to open.
  refFor(place: CloudPlace): WorkspaceRef | null;
  /// The mark for a place, on a row and on the first crumb.
  glyph(place: CloudPlace, className: string): ReactElement;
}
