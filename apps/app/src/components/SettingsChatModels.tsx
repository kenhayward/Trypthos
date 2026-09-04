import { useTranslation } from "react-i18next";
import { chatPanelVisible, normaliseEndpoint, type ChatProfile, type Settings } from "@trypthos/domain";
import { blankDraft, draftFrom } from "../lib/chatProfiles";
import ChatProfileForm, { type SaveKeyResult } from "./ChatProfileForm";

type Draft = ReturnType<typeof blankDraft>;

interface Props {
  chat: Settings["chat"];
  /// Endpoints the shell holds an API key for. Endpoints, never keys.
  keyedEndpoints: string[];
  /// The model being edited, or null when the list is just a list. Held by the dialog rather than
  /// here, because the rail can start an edit too.
  editing: Draft | null;
  onEditing: (draft: Draft | null) => void;
  onChangeChat: (change: Partial<Settings["chat"]>) => void;
  onSaveProfile: (profile: ChatProfile) => void;
  onRemoveProfile: (id: string) => void;
  onSaveKey: (endpoint: string, key: string) => Promise<SaveKeyResult>;
  onDeleteKey: (endpoint: string) => Promise<void>;
}

/// The models Trypthos can chat with: a list, and one form at a time.
///
/// Master and detail rather than every form at once, because a profile carries an API key field and
/// six models would be six of them on one page.
export default function SettingsChatModels({
  chat,
  keyedEndpoints,
  editing,
  onEditing,
  onChangeChat,
  onSaveProfile,
  onRemoveProfile,
  onSaveKey,
  onDeleteKey,
}: Props) {
  const { t } = useTranslation();

  const profiles = chat.profiles;
  const keyed = new Set(keyedEndpoints.map(normaliseEndpoint));
  const editingExisting = editing !== null && profiles.some(({ id }) => id === editing.id);

  return (
    <div className="max-w-2xl">
      {editing === null ? (
        <>
          {/* Shown as the panel currently is, whether that was chosen or derived. Clicking it stores
              a choice, which is the point: from then on it is the user's answer rather than one
              taken from whether a model happens to be configured.

              Only alongside the list. While a model is being edited the form is what the page is
              about, and a switch about the panel above a half-filled endpoint field is noise. */}
          <label className="flex items-start gap-2 text-base text-ink">
            <input
              type="checkbox"
              checked={chatPanelVisible(chat)}
              onChange={(event) => onChangeChat({ showPanel: event.target.checked })}
              className="mt-0.5"
            />
            <span>
              {t("settings.chat.showPanel")}
              <span className="mt-0.5 block text-xs text-ink-4">
                {t("settings.chat.showPanelHint")}
              </span>
            </span>
          </label>

          <p className="mt-5 text-xs text-ink-4">{t("settings.chat.intro")}</p>

          {profiles.length === 0 && (
            <p className="mt-3 text-ui text-ink-4">{t("settings.chat.empty")}</p>
          )}

          <ul className="mt-3 flex flex-col gap-2">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <button
                  type="button"
                  // Named with the label, so a screen reader hears which model is being edited - a
                  // row of buttons all called "Edit" is unusable.
                  aria-label={t("settings.chat.edit", { label: profile.label })}
                  onClick={() => onEditing(draftFrom(profile))}
                  className="flex w-full items-center gap-3 rounded-[7px] border border-rule bg-sunken px-3.5 py-2.5 text-left hover:border-accent"
                >
                  <span className="text-base font-medium text-ink">{profile.label}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-4">{profile.model}</span>
                  {profile.isDefault && (
                    <span className="shrink-0 rounded bg-app px-1.5 py-0.5 text-2xs text-ink-4">
                      {t("settings.chat.default")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => onEditing(blankDraft())}
            className="mt-3 rounded-md border border-rule px-3 py-1.5 text-ui text-ink hover:bg-hover"
          >
            {t("settings.chat.add")}
          </button>
        </>
      ) : (
        <div className="rounded-[7px] border border-rule bg-sunken p-4">
          <ChatProfileForm
            draft={editing}
            hasKey={keyed.has(normaliseEndpoint(editing.endpoint))}
            canRemove={editingExisting}
            onSave={onSaveProfile}
            onCancel={() => onEditing(null)}
            onRemove={() => (editingExisting ? onRemoveProfile(editing.id) : onEditing(null))}
            onSaveKey={onSaveKey}
            onDeleteKey={onDeleteKey}
          />
        </div>
      )}
    </div>
  );
}
