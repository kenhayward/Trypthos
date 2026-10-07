import { useMemo } from "react";
import type { WorkspaceRef } from "@trypthos/domain";
import OpenCloudFolderDialog from "./OpenCloudFolderDialog";
import { oneDriveFolderSource } from "./cloudFolderSources";
import type { OneDriveBridge } from "../lib/workspaceClient";

interface Props {
  /// The OneDrive half of the shell, or null in the browser preview.
  bridge: OneDriveBridge | null;
  onCancel: () => void;
  /// The folder the user chose. Opening it is the workspace's business, not this dialog's.
  onOpen: (ref: WorkspaceRef) => void;
}

/// Choosing a OneDrive folder: the shared cloud-folder picker over My files and Shared with me. See
/// `OpenCloudFolderDialog`.
export default function OpenOneDriveDialog({ bridge, onCancel, onOpen }: Props) {
  // Memoised: the source is an effect dependency of the picker and of its account section.
  const source = useMemo(() => oneDriveFolderSource(bridge), [bridge]);
  return <OpenCloudFolderDialog source={source} onCancel={onCancel} onOpen={onOpen} />;
}
