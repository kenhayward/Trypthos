import { failureKey, providerFailureKey } from "../hooks/useWorkspace";

/// What tells one cloud account apart in the shared section: its words and how its failures read.
/// Keys, not wording, so this stays pure; the component translates.
export interface CloudAccountKind {
  /// Settings heading, e.g. "settings.accounts.googleDrive".
  titleKey: string;
  checkingKey: string;
  connectKey: string;
  connectBlurbKey: string;
  notConfiguredKey: string;
  browserOnlyKey: string;
  /// Shown under a connected account, or null. OneDrive's says where to remove the app's access.
  connectedNoteKey: string | null;
  failureKey(reason: string): string | null;
}

export const GOOGLE_ACCOUNT: CloudAccountKind = {
  titleKey: "settings.accounts.googleDrive",
  checkingKey: "google.checking",
  connectKey: "google.connect",
  connectBlurbKey: "google.connectBlurb",
  notConfiguredKey: "google.notConfigured",
  browserOnlyKey: "google.browserOnly",
  connectedNoteKey: null,
  failureKey: (reason) => providerFailureKey("google-drive", reason),
};

/// OneDrive's account failures until `providerFailureKey` gains a OneDrive kind.
///
/// The generic keys for scope-denied and timed-out name Google, so those are answered here too.
export function oneDriveFailureKey(reason: string): string | null {
  switch (reason) {
    case "offline":
      return "errors.oneDriveOffline";
    case "rate-limited":
      return "errors.oneDriveRateLimited";
    case "not-connected":
      return "errors.oneDriveNotConnected";
    case "scope-denied":
      return "errors.oneDriveScopeDenied";
    case "timed-out":
      return "errors.oneDriveTimedOut";
    default:
      return failureKey(reason);
  }
}

export const ONEDRIVE_ACCOUNT: CloudAccountKind = {
  titleKey: "settings.accounts.oneDrive",
  checkingKey: "onedrive.checking",
  connectKey: "onedrive.connect",
  connectBlurbKey: "onedrive.connectBlurb",
  notConfiguredKey: "onedrive.notConfigured",
  browserOnlyKey: "onedrive.browserOnly",
  connectedNoteKey: "onedrive.removeAccess",
  failureKey: oneDriveFailureKey,
};
