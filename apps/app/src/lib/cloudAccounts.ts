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
/// The generic keys for scope-denied, timed-out and not-configured name Google, so those are answered here too.
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
    case "not-configured":
      return "errors.oneDriveNotConfigured";
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

/// Every catalogue key the account kinds name. They are looked up as `t(kind.xKey)`, which the i18n
/// guard cannot see as a call, so it reads this set instead: exactly these keys, not a prefix.
export function cloudAccountKeys(): string[] {
  return [GOOGLE_ACCOUNT, ONEDRIVE_ACCOUNT].flatMap((kind) =>
    [kind.titleKey, kind.checkingKey, kind.connectKey, kind.connectBlurbKey, kind.notConfiguredKey, kind.browserOnlyKey, kind.connectedNoteKey].filter(
      (key): key is string => key !== null,
    ),
  );
}
