import { useMemo } from "react";
import type { WorkspaceRef } from "@trypthos/domain";
import OpenCloudFolderDialog from "./OpenCloudFolderDialog";
import { googleDriveFolderSource } from "./cloudFolderSources";
import type { GoogleBridge } from "../lib/workspaceClient";

interface Props {
  /// The Google half of the shell, or null in the browser preview.
  bridge: GoogleBridge | null;
  onCancel: () => void;
  /// The folder the user chose. Opening it is the workspace's business, not this dialog's.
  onOpen: (ref: WorkspaceRef) => void;
}

/// Choosing a Google Drive folder: the shared cloud-folder picker over Drive's places - My Drive,
/// Shared with me and a row per shared drive. See `OpenCloudFolderDialog`.
export default function OpenDriveDialog({ bridge, onCancel, onOpen }: Props) {
  // Memoised: the source is an effect dependency of the picker and of its account section.
  const source = useMemo(() => googleDriveFolderSource(bridge), [bridge]);
  return <OpenCloudFolderDialog source={source} onCancel={onCancel} onOpen={onOpen} />;
}
