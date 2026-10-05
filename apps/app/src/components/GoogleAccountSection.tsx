import { useTranslation } from "react-i18next";
import { useGoogle } from "../hooks/useGoogle";
import type { GoogleBridge } from "../lib/workspaceClient";

interface Props {
  /// The Google half of the shell, or null in the browser preview.
  bridge: GoogleBridge | null;
  /// Told when a Connect succeeds, so a picker that showed this because nothing was connected can
  /// carry on. Not told about a cancelled or refused sign-in.
  onConnected?: () => void;
}

/// Connecting a Google account: status, Connect (and Cancel while the browser is open), Disconnect.
///
/// A component of its own rather than inline in Settings, because the Drive open-folder dialog shows
/// the same control when no account is connected yet. Nothing here displays a credential: the
/// connected account is named by the email the shell got from Google.
export default function GoogleAccountSection({ bridge, onConnected }: Props) {
  const { t } = useTranslation();
  const google = useGoogle(bridge);

  const statusLine = google.checking
    ? t("google.checking")
    : google.connected && google.email !== null
      ? t("google.connectedAs", { email: google.email })
      : t("google.notConnected");

  // `configured` stays false when the status check itself failed, so "this build has no Drive
  // support" is only claimed when the check answered and no error is showing.
  const missingInBuild = !google.configured && google.errorKey === null;

  return (
    <section className="mt-4 max-w-lg rounded-lg border border-rule p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-ui font-medium text-ink">{t("settings.accounts.googleDrive")}</h4>
        <span className="ml-auto text-xs text-ink-4">{statusLine}</span>
      </div>

      {google.errorKey !== null && (
        <p role="alert" className="mt-2 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
          {t(google.errorKey)}
        </p>
      )}

      {!google.supported ? (
        <p className="mt-3 text-xs text-ink-3">{t("google.browserOnly")}</p>
      ) : google.checking ? null : missingInBuild ? (
        <p className="mt-3 text-xs text-ink-3">{t("google.notConfigured")}</p>
      ) : google.connected ? (
        <button
          type="button"
          onClick={() => void google.disconnect()}
          className="mt-3 rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover"
        >
          {t("google.disconnect")}
        </button>
      ) : google.connecting ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-xs text-ink-3">{t("google.connecting")}</span>
          <button
            type="button"
            onClick={() => void google.cancel()}
            className="rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover"
          >
            {t("google.cancel")}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-xs text-ink-3">{t("google.connectBlurb")}</p>
          <button
            type="button"
            onClick={() =>
              void google.connect().then((connected) => {
                if (connected) onConnected?.();
              })
            }
            className="mt-3 rounded bg-accent px-3 py-1 text-ui text-on-accent"
          >
            {t("google.connect")}
          </button>
        </>
      )}
    </section>
  );
}
