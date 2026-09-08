import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGitHub } from "../hooks/useGitHub";
import type { GitHubBridge } from "../lib/workspaceClient";

interface Props {
  /// The GitHub half of the shell, or null in the browser preview.
  bridge: GitHubBridge | null;
}

/// The cloud accounts Trypthos can open folders from.
///
/// One page for every provider, because they are the same question asked repeatedly: which accounts
/// is this app connected to, and how do I disconnect one. A page per provider would be a rail that
/// grows a row every time a backend is added.
///
/// **Nothing here ever displays a credential.** The connected account is shown by its LOGIN, which
/// the shell reports after asking GitHub - so a revoked token reads as disconnected rather than as an
/// account that is still there. There is no channel that returns a token, and there must never be
/// one.
export default function SettingsAccounts({ bridge }: Props) {
  const { t } = useTranslation();
  const github = useGitHub(bridge);
  const [token, setToken] = useState("");

  const connect = async () => {
    if (await github.connect(token)) setToken("");
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{t("settings.accounts.title")}</h3>
      <p className="mt-1 max-w-lg text-xs text-ink-3">{t("settings.accounts.blurb")}</p>

      <section className="mt-4 max-w-lg rounded-lg border border-rule p-3">
        <div className="flex items-center gap-2">
          <h4 className="text-ui font-medium text-ink">{t("settings.accounts.github")}</h4>
          <span className="ml-auto text-xs text-ink-4">
            {github.checking
              ? t("github.checking")
              : github.connected && github.login !== null
                ? t("github.connectedAs", { login: github.login })
                : t("github.notConnected")}
          </span>
        </div>

        {github.errorKey !== null && (
          <p role="alert" className="mt-2 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
            {t(github.errorKey)}
          </p>
        )}

        {!github.supported ? (
          <p className="mt-3 text-xs text-ink-3">{t("github.browserOnly")}</p>
        ) : github.connected ? (
          <button
            type="button"
            onClick={() => void github.disconnect()}
            className="mt-3 rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover"
          >
            {t("github.disconnect")}
          </button>
        ) : (
          <>
            <p className="mt-2 text-xs text-ink-3">{t("github.connectBlurb")}</p>

            <label className="mt-3 block text-xs text-ink-3" htmlFor="settings-github-token">
              {t("github.tokenLabel")}
            </label>
            <input
              id="settings-github-token"
              // A password field, so a token pasted in front of somebody is not left on screen.
              type="password"
              value={token}
              placeholder={t("github.tokenPlaceholder")}
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void connect();
              }}
              className="mt-1 w-full rounded border border-rule bg-app px-2 py-1 text-ui text-ink"
            />

            <button
              type="button"
              onClick={() => void connect()}
              disabled={github.loading || token.trim() === ""}
              className="mt-3 rounded bg-accent px-3 py-1 text-ui text-on-accent disabled:opacity-50"
            >
              {github.loading ? t("github.connecting") : t("github.connect")}
            </button>
          </>
        )}

        <p className="mt-3 text-xs text-ink-4">{t("github.readOnlyNote")}</p>
      </section>
    </div>
  );
}
