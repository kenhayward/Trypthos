import { useTranslation } from "react-i18next";
import { useCloudAccount } from "../hooks/useCloudAccount";
import type { CloudAccountKind } from "../lib/cloudAccounts";
import type { CloudAccountBridge } from "../lib/workspaceClient";

interface Props {
  /// Which provider this is: its words and how its failures read.
  kind: CloudAccountKind;
  /// That provider's half of the shell, or null in the browser preview.
  bridge: CloudAccountBridge | null;
  /// Told when a Connect succeeds, so a picker that showed this because nothing was connected can
  /// carry on. Not told about a cancelled or refused sign-in.
  onConnected?: () => void;
}

/// Connecting a cloud account (Google, OneDrive): status, Connect (and Cancel while the browser is open), Disconnect.
///
/// A component of its own rather than inline in Settings, because the Drive open-folder dialog shows
/// the same control when no account is connected yet. Nothing here displays a credential: the
/// connected account is named by the email the shell got from the provider.
export default function CloudAccountSection({ kind, bridge, onConnected }: Props) {
  const { t } = useTranslation();
  const account = useCloudAccount(bridge, kind.failureKey);

  const statusLine = account.checking
    ? t(kind.checkingKey)
    : account.connected && account.email !== null
      ? t("cloud.connectedAs", { email: account.email })
      : t("cloud.notConnected");

  // `configured` stays false when the status check itself failed, so "this build has no support for this
  // provider" is only claimed when the check answered and no error is showing.
  const missingInBuild = !account.configured && account.errorKey === null;

  return (
    <section className="mt-4 max-w-lg rounded-lg border border-rule p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-ui font-medium text-ink">{t(kind.titleKey)}</h4>
        <span className="ml-auto text-xs text-ink-4">{statusLine}</span>
      </div>

      {account.errorKey !== null && (
        <p role="alert" className="mt-2 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
          {t(account.errorKey)}
        </p>
      )}

      {!account.supported ? (
        <p className="mt-3 text-xs text-ink-3">{t(kind.browserOnlyKey)}</p>
      ) : account.checking ? null : missingInBuild ? (
        <p className="mt-3 text-xs text-ink-3">{t(kind.notConfiguredKey)}</p>
      ) : account.connected ? (
        <>
          <button
            type="button"
            onClick={() => void account.disconnect()}
            className="mt-3 rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover"
          >
            {t("cloud.disconnect")}
          </button>
          {kind.connectedNoteKey !== null && <p className="mt-2 text-xs text-ink-4">{t(kind.connectedNoteKey)}</p>}
        </>
      ) : account.connecting ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-xs text-ink-3">{t("cloud.connecting")}</span>
          <button
            type="button"
            onClick={() => void account.cancel()}
            className="rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover"
          >
            {t("cloud.cancel")}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-xs text-ink-3">{t(kind.connectBlurbKey)}</p>
          <button
            type="button"
            onClick={() =>
              void account.connect().then((connected) => {
                if (connected) onConnected?.();
              })
            }
            className="mt-3 rounded bg-accent px-3 py-1 text-ui text-on-accent"
          >
            {t(kind.connectKey)}
          </button>
        </>
      )}
    </section>
  );
}
