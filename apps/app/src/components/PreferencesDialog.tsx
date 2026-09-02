import { useTranslation } from "react-i18next";
import type { Settings } from "@trypthos/domain";
import { THEME_PREFERENCES, type ThemePreference } from "../lib/theme";

interface Props {
  open: boolean;
  settings: Settings;
  /// True in the desktop shell. In the browser preview there is nothing to close to, and nothing
  /// that would remember a preference anyway.
  isDesktop: boolean;
  onClose: () => void;
  onChange: (change: Partial<Settings>) => void;
}

/// Preferences.
///
/// Changes apply immediately rather than on an OK button. There is no state to abandon - each
/// setting is a single value that takes effect as soon as it is chosen - so a confirm step would only
/// add a way to lose the change you just made.
export default function PreferencesDialog({
  open,
  settings,
  isDesktop,
  onClose,
  onChange,
}: Props) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("preferences.title")}
      className="fixed inset-0 flex items-center justify-center bg-[rgba(15,23,42,0.45)] p-4"
    >
      <div className="max-h-full w-full max-w-md overflow-auto rounded-lg border border-rule bg-app p-5 shadow-menu">
        <h1 className="text-base font-semibold text-ink">{t("preferences.title")}</h1>

        <fieldset className="mt-5">
          <legend className="text-xs font-semibold tracking-[0.06em] text-ink-4 uppercase">
            {t("preferences.appearance")}
          </legend>

          <div className="mt-2 flex gap-0.5 rounded-md bg-sunken p-0.5">
            {THEME_PREFERENCES.map((theme) => (
              <button
                key={theme}
                type="button"
                aria-pressed={settings.appearance.theme === theme}
                onClick={() => onChange({ appearance: { theme } })}
                className={
                  settings.appearance.theme === theme
                    ? "flex-1 rounded bg-app px-2 py-1 text-ui font-semibold text-ink shadow-tab"
                    : "flex-1 rounded px-2 py-1 text-ui text-ink-4 hover:text-ink"
                }
              >
                {t(`preferences.theme.${theme}`)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-4">
            {t(`preferences.themeHint.${settings.appearance.theme}` as const)}
          </p>
        </fieldset>

        {isDesktop && (
          <fieldset className="mt-5">
            <legend className="text-xs font-semibold tracking-[0.06em] text-ink-4 uppercase">
              {t("preferences.window")}
            </legend>

            <label className="mt-2 flex items-start gap-2 text-base text-ink">
              <input
                type="checkbox"
                checked={settings.window.closeToTray}
                onChange={(event) => onChange({ window: { closeToTray: event.target.checked } })}
                className="mt-0.5"
              />
              <span>
                {t("preferences.closeToTray")}
                <span className="mt-0.5 block text-xs text-ink-4">
                  {t("preferences.closeToTrayHint")}
                </span>
              </span>
            </label>
          </fieldset>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-6 rounded bg-accent-strong px-3 py-1.5 text-ui text-white"
        >
          {t("preferences.done")}
        </button>
      </div>
    </div>
  );
}

export type { ThemePreference };
