import { providerFailureKey } from "../hooks/useWorkspace";

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

export const ONEDRIVE_ACCOUNT: CloudAccountKind = {
  titleKey: "settings.accounts.oneDrive",
  checkingKey: "onedrive.checking",
  connectKey: "onedrive.connect",
  connectBlurbKey: "onedrive.connectBlurb",
  notConfiguredKey: "onedrive.notConfigured",
  browserOnlyKey: "onedrive.browserOnly",
  connectedNoteKey: "onedrive.removeAccess",
  failureKey: (reason) => providerFailureKey("onedrive", reason),
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
