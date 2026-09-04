import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EDITOR_MODES,
  effectiveSystemPrompt,
  type ChatProfile,
  type Settings,
} from "@trypthos/domain";
import { blankDraft, draftFrom, removeProfile, upsertProfile } from "../lib/chatProfiles";
import { MODE_HINT_KEYS, MODE_LABEL_KEYS } from "../lib/editorMode";
import { SECTION_LABEL_KEYS, type SettingsSection } from "../lib/settingsSections";
import { THEME_PREFERENCES, type ThemePreference } from "../lib/theme";
import type { SaveKeyResult } from "./ChatProfileForm";
import SettingsAbout from "./SettingsAbout";
import SettingsChatModels from "./SettingsChatModels";
import SettingsNav from "./SettingsNav";

interface Props {
  /// The page to open on. Read once: the dialog is mounted when it opens and unmounted when it
  /// closes, so a fresh open starts where the caller asked and a half-typed model does not survive
  /// being closed.
  openOn: SettingsSection;
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

/// A segmented control: one row of choices where exactly one is on.
///
/// `aria-pressed` rather than a radio group, matching the editor's own view switcher - these are
/// buttons that take effect, not a form waiting to be submitted.
function Segmented<T extends string>({
  options,
  current,
  label,
  onChoose,
}: {
  options: readonly T[];
  current: T;
  label: (option: T) => string;
  onChoose: (option: T) => void;
}) {
  return (
    <div className="flex max-w-lg gap-0.5 rounded-[7px] bg-sunken p-[3px]">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={current === option}
          onClick={() => onChoose(option)}
          className={
            current === option
              ? "flex-1 rounded-md bg-app px-2 py-1.5 text-base font-semibold text-ink shadow-tab"
              : "flex-1 rounded-md px-2 py-1.5 text-base text-ink-4 hover:text-ink"
          }
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}

/// Settings.
///
/// Changes apply as they are made rather than on a Save button: each setting is a single value that
/// takes effect as soon as it is chosen, so a confirm step would only add a way to lose the change
/// you just made - and the theme, which you are looking at while you choose it, would either
/// preview and make Cancel a lie or not preview and make the choice blind. Chat profiles are the
/// exception, and `ChatProfileForm` says why.
export default function SettingsDialog({
  openOn,
  settings,
  isDesktop,
  keyedEndpoints,
  onClose,
  onChange,
  onSaveKey,
  onDeleteKey,
}: Props) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SettingsSection>(openOn);
  /// The model being edited, or null when the list is just a list. Held here rather than in the
  /// page so the rail can start an edit, and so leaving the page discards it entirely.
  const [editing, setEditing] = useState<ReturnType<typeof blankDraft> | null>(null);

  // The dialog covers the app, so the way out has to be where a hand already is.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const profiles = settings.chat.profiles;

  /// Every write to the chat section carries the rest of it forward.
  ///
  /// `onChange` takes a partial of the whole settings object, so a change to `chat` replaces `chat`
  /// entirely - saving a profile with `{ chat: { profiles } }` would silently drop the system
  /// prompt, and saving a prompt would drop every configured model.
  const updateChat = (change: Partial<Settings["chat"]>) =>
    onChange({ chat: { ...settings.chat, ...change } });

  const openSection = (next: SettingsSection) => {
    // Leaving the page abandons a half-typed model, which is what the form's own Cancel does.
    setEditing(null);
    setSection(next);
  };

  const saveProfile = (profile: ChatProfile) => {
    // The first model configured becomes the default without being asked. Otherwise every chat would
    // have to be pointed at a model by hand before it could say anything.
    const isFirst = profiles.length === 0;
    updateChat({
      profiles: upsertProfile(profiles, { ...profile, isDefault: profile.isDefault || isFirst }),
    });
    setEditing(null);
  };

  const removeProfileById = (id: string) => {
    updateChat({ profiles: removeProfile(profiles, id) });
    setEditing(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      className="fixed inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.55)] p-4"
    >
      <div className="flex h-[88vh] max-h-[800px] w-[94vw] max-w-[1220px] overflow-hidden rounded-[10px] border border-rule bg-app shadow-menu">
        <SettingsNav
          current={section}
          isDesktop={isDesktop}
          models={profiles}
          onSection={openSection}
          onEditModel={(id) => {
            const profile = profiles.find((candidate) => candidate.id === id);
            if (profile) setEditing(draftFrom(profile));
          }}
          onAddModel={() => setEditing(blankDraft())}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-rule px-6 py-4">
            <h1 className="text-lg font-semibold text-ink">{t(SECTION_LABEL_KEYS[section])}</h1>
            <button
              type="button"
              aria-label={t("settings.close")}
              title={t("settings.close")}
              onClick={onClose}
              className="flex size-[30px] items-center justify-center rounded text-ink-4 hover:bg-hover hover:text-ink"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
            {section === "appearance" && (
              <div className="max-w-2xl">
                <Segmented<ThemePreference>
                  options={THEME_PREFERENCES}
                  current={settings.appearance.theme}
                  label={(theme) => t(`settings.theme.${theme}`)}
                  onChoose={(theme) => onChange({ appearance: { theme } })}
                />
                <p className="mt-2 text-xs text-ink-4">
                  {t(`settings.themeHint.${settings.appearance.theme}` as const)}
                </p>
              </div>
            )}

            {section === "window" && isDesktop && (
              <label className="flex max-w-2xl items-start gap-2 text-base text-ink">
                <input
                  type="checkbox"
                  checked={settings.window.closeToTray}
                  onChange={(event) => onChange({ window: { closeToTray: event.target.checked } })}
                  className="mt-0.5"
                />
                <span>
                  {t("settings.closeToTray")}
                  <span className="mt-0.5 block text-xs text-ink-4">
                    {t("settings.closeToTrayHint")}
                  </span>
                </span>
              </label>
            )}

            {section === "chatModels" && (
              <SettingsChatModels
                chat={settings.chat}
                keyedEndpoints={keyedEndpoints}
                editing={editing}
                onEditing={setEditing}
                onChangeChat={updateChat}
                onSaveProfile={saveProfile}
                onRemoveProfile={removeProfileById}
                onSaveKey={onSaveKey}
                onDeleteKey={onDeleteKey}
              />
            )}

            {section === "ai" && (
              <div className="max-w-2xl">
                <label className="block text-xs text-ink-4">
                  {t("settings.chat.folderFiles")}
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={settings.chat.folderFileLimit}
                    onChange={(event) => {
                      // A nonsense box is ignored rather than stored: the schema refuses a number
                      // outside the range, and a rejected write would lose the rest of the change it
                      // travelled with.
                      const value = Number.parseInt(event.target.value, 10);
                      if (Number.isInteger(value) && value >= 1 && value <= 200) {
                        updateChat({ folderFileLimit: value });
                      }
                    }}
                    className="mt-1 block w-[90px] rounded border border-rule bg-app px-2 py-1 text-ui text-ink"
                  />
                </label>
                <p className="mt-1 text-xs text-ink-4">{t("settings.chat.folderFilesHint")}</p>

                <label className="mt-6 block text-xs text-ink-4">
                  {t("settings.chat.systemPrompt")}
                  <textarea
                    // The effective prompt, so an unset one is READ AND EDITED as the default text
                    // rather than shown as an empty box. Typing into it stores what is typed, which
                    // is the moment it stops tracking the default.
                    value={effectiveSystemPrompt(settings.chat.systemPrompt)}
                    onChange={(event) => updateChat({ systemPrompt: event.target.value })}
                    rows={10}
                    className="mt-1 w-full resize-y rounded border border-rule bg-app px-2 py-1 font-mono text-xs text-ink"
                  />
                </label>
                <p className="mt-1 text-xs text-ink-4">{t("settings.chat.systemPromptHint")}</p>

                {/* Offered only when it would do something. A reset button beside an unchanged
                    default is a control that cannot be told apart from a broken one. */}
                {settings.chat.systemPrompt !== null && (
                  <button
                    type="button"
                    // Back to null, not to a copy of the current text: a copy would stop tracking
                    // the default the moment the default next changed.
                    onClick={() => updateChat({ systemPrompt: null })}
                    className="mt-2 rounded-md border border-rule px-3 py-1.5 text-ui text-ink hover:bg-hover"
                  >
                    {t("settings.chat.resetPrompt")}
                  </button>
                )}
              </div>
            )}

            {section === "editor" && (
              <div className="max-w-2xl">
                <p className="mb-2 text-xs text-ink-4">{t("settings.editor.defaultView")}</p>
                <Segmented
                  options={EDITOR_MODES}
                  current={settings.editor.defaultViewMode}
                  label={(mode) => t(MODE_LABEL_KEYS[mode])}
                  onChoose={(defaultViewMode) => onChange({ editor: { defaultViewMode } })}
                />
                {/* The editor's own wording for the mode, rather than a second description of the
                    same thing that can drift from it. */}
                <p className="mt-2 text-xs text-ink-4">
                  {t(MODE_HINT_KEYS[settings.editor.defaultViewMode])}
                </p>
                <p className="mt-4 text-xs text-ink-4">{t("settings.editor.defaultViewHint")}</p>
              </div>
            )}

            {section === "about" && <SettingsAbout />}
          </div>
        </div>
      </div>
    </div>
  );
}

export type { ThemePreference };
