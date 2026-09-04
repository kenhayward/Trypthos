import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  chatPanelVisible,
  effectiveSystemPrompt,
  normaliseEndpoint,
  type ChatProfile,
  type Settings,
} from "@trypthos/domain";
import { blankDraft, draftFrom, removeProfile, upsertProfile } from "../lib/chatProfiles";
import { THEME_PREFERENCES, type ThemePreference } from "../lib/theme";
import ChatProfileForm, { type SaveKeyResult } from "./ChatProfileForm";

interface Props {
  open: boolean;
  settings: Settings;
  /// True in the desktop shell. In the browser preview there is nothing to close to, and nothing
  /// that would remember a preference anyway.
  isDesktop: boolean;
  /// Endpoints the shell holds an API key for. Endpoints, never keys.
  keyedEndpoints: string[];
  onClose: () => void;
  onChange: (change: Partial<Settings>) => void;
  onSaveKey: (endpoint: string, key: string) => Promise<SaveKeyResult>;
  onDeleteKey: (endpoint: string) => Promise<void>;
}

/// Preferences.
///
/// Most changes apply immediately rather than on an OK button: each setting is a single value that
/// takes effect as soon as it is chosen, so a confirm step would only add a way to lose the change
/// you just made. Chat profiles are the exception, and `ChatProfileForm` says why.
export default function PreferencesDialog({
  open,
  settings,
  isDesktop,
  keyedEndpoints,
  onClose,
  onChange,
  onSaveKey,
  onDeleteKey,
}: Props) {
  const { t } = useTranslation();
  /// The profile being edited, or null when the list is just a list. Held here rather than in the
  /// form so cancelling discards it entirely.
  const [editing, setEditing] = useState<ReturnType<typeof blankDraft> | null>(null);

  if (!open) return null;

  const profiles = settings.chat.profiles;
  const keyed = new Set(keyedEndpoints.map(normaliseEndpoint));

  /// Every write to the chat section carries the rest of it forward.
  ///
  /// `onChange` takes a partial of the whole settings object, so a change to `chat` replaces `chat`
  /// entirely - saving a profile with `{ chat: { profiles } }` would silently drop the system
  /// prompt, and saving a prompt would drop every configured model.
  const updateChat = (change: Partial<Settings["chat"]>) =>
    onChange({ chat: { ...settings.chat, ...change } });

  const saveProfile = (profile: ChatProfile) => {
    // The first model configured becomes the default without being asked. Otherwise every chat would
    // have to be pointed at a model by hand before it could say anything.
    const isFirst = profiles.length === 0;
    updateChat({
      profiles: upsertProfile(profiles, { ...profile, isDefault: profile.isDefault || isFirst }),
    });
    setEditing(null);
  };

  const remove = (id: string) => {
    updateChat({ profiles: removeProfile(profiles, id) });
    setEditing(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("preferences.title")}
      className="fixed inset-0 flex items-center justify-center bg-[rgba(15,23,42,0.45)] p-4"
    >
      <div className="max-h-full w-full max-w-lg overflow-auto rounded-lg border border-rule bg-app p-5 shadow-menu">
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

        <fieldset className="mt-5">
          <legend className="text-xs font-semibold tracking-[0.06em] text-ink-4 uppercase">
            {t("preferences.chat.section")}
          </legend>

          {/* Shown as the panel currently is, whether that was chosen or derived. Clicking it stores
              a choice, which is the point: from then on it is the user's answer rather than one
              taken from whether a model happens to be configured. */}
          <label className="mt-2 flex items-start gap-2 text-base text-ink">
            <input
              type="checkbox"
              checked={chatPanelVisible(settings.chat)}
              onChange={(event) => updateChat({ showPanel: event.target.checked })}
              className="mt-0.5"
            />
            <span>
              {t("preferences.chat.showPanel")}
              <span className="mt-0.5 block text-xs text-ink-4">
                {t("preferences.chat.showPanelHint")}
              </span>
            </span>
          </label>

          {profiles.length === 0 && editing === null && (
            <p className="mt-2 text-ui text-ink-4">{t("preferences.chat.empty")}</p>
          )}

          <ul className="mt-2">
            {profiles.map((profile) => (
              <li key={profile.id}>
                {editing?.id === profile.id ? (
                  <ChatProfileForm
                    draft={editing}
                    hasKey={keyed.has(normaliseEndpoint(editing.endpoint))}
                    canRemove
                    onSave={saveProfile}
                    onCancel={() => setEditing(null)}
                    onRemove={() => remove(profile.id)}
                    onSaveKey={onSaveKey}
                    onDeleteKey={onDeleteKey}
                  />
                ) : (
                  <button
                    type="button"
                    // Named with the label, so a screen reader hears which model is being edited -
                    // a row of buttons all called "Edit" is unusable.
                    aria-label={t("preferences.chat.edit", { label: profile.label })}
                    onClick={() => setEditing(draftFrom(profile))}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-sunken"
                  >
                    <span className="text-ui text-ink">{profile.label}</span>
                    <span className="text-xs text-ink-4">{profile.model}</span>
                    <span className="flex-1" />
                    {profile.isDefault && (
                      <span className="rounded bg-sunken px-1.5 py-0.5 text-xs text-ink-4">
                        {t("preferences.chat.default")}
                      </span>
                    )}
                  </button>
                )}
              </li>
            ))}
          </ul>

          {editing !== null && !profiles.some((profile) => profile.id === editing.id) && (
            <ChatProfileForm
              draft={editing}
              hasKey={keyed.has(normaliseEndpoint(editing.endpoint))}
              canRemove={false}
              onSave={saveProfile}
              onCancel={() => setEditing(null)}
              onRemove={() => setEditing(null)}
              onSaveKey={onSaveKey}
              onDeleteKey={onDeleteKey}
            />
          )}

          {editing === null && (
            <button
              type="button"
              onClick={() => setEditing(blankDraft())}
              className="mt-2 rounded border border-rule px-2 py-1 text-ui text-ink"
            >
              {t("preferences.chat.add")}
            </button>
          )}

          <label className="mt-4 block text-xs text-ink-4">
            {t("preferences.chat.folderFiles")}
            <input
              type="number"
              min={1}
              max={200}
              value={settings.chat.folderFileLimit}
              onChange={(event) => {
                // A nonsense box is ignored rather than stored: the schema refuses a number outside
                // the range, and a rejected write would lose the rest of the change it travelled
                // with.
                const value = Number.parseInt(event.target.value, 10);
                if (Number.isInteger(value) && value >= 1 && value <= 200) {
                  updateChat({ folderFileLimit: value });
                }
              }}
              className="mt-1 w-24 rounded border border-rule bg-app px-2 py-1 text-ui text-ink"
            />
          </label>
          <p className="mt-1 text-xs text-ink-4">{t("preferences.chat.folderFilesHint")}</p>

          <label className="mt-4 block text-xs text-ink-4">
            {t("preferences.chat.systemPrompt")}
            <textarea
              // The effective prompt, so an unset one is READ AND EDITED as the default text rather
              // than shown as an empty box. Typing into it stores what is typed, which is the moment
              // it stops tracking the default.
              value={effectiveSystemPrompt(settings.chat.systemPrompt)}
              onChange={(event) => updateChat({ systemPrompt: event.target.value })}
              rows={10}
              className="mt-1 w-full resize-y rounded border border-rule bg-app px-2 py-1 font-mono text-xs text-ink"
            />
          </label>
          <p className="mt-1 text-xs text-ink-4">{t("preferences.chat.systemPromptHint")}</p>

          {/* Offered only when it would do something. A reset button beside an unchanged default is
              a control that cannot be told apart from a broken one. */}
          {settings.chat.systemPrompt !== null && (
            <button
              type="button"
              // Back to null, not to a copy of the current text: a copy would stop tracking the
              // default the moment the default next changed, which is the bug this whole change is
              // about.
              onClick={() => updateChat({ systemPrompt: null })}
              className="mt-2 rounded border border-rule px-2 py-1 text-ui text-ink"
            >
              {t("preferences.chat.resetPrompt")}
            </button>
          )}
        </fieldset>

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
