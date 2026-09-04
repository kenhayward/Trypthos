import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatProfile } from "@trypthos/domain";
import {
  toProfile,
  type DraftField,
  type ProfileDraft,
} from "../lib/chatProfiles";

export type SaveKeyResult = { ok: true } | { ok: false; reason: string };

interface Props {
  draft: ProfileDraft;
  /// Whether the shell holds a key for the endpoint currently in the form.
  ///
  /// A boolean, never the key. The renderer is told which endpoints have one and nothing else - a
  /// key here would be a key in devtools, in the network panel, and in a renderer crash dump.
  hasKey: boolean;
  /// False for a profile being added, which has nothing to remove yet.
  canRemove: boolean;
  onSave: (profile: ChatProfile) => void;
  onCancel: () => void;
  onRemove: () => void;
  onSaveKey: (endpoint: string, key: string) => Promise<SaveKeyResult>;
  onDeleteKey: (endpoint: string) => Promise<void>;
}

const FIELD =
  "mt-1 w-full rounded border border-rule bg-app px-2 py-1 text-ui text-ink " +
  "aria-[invalid=true]:border-danger";

/// Editing one chat model.
///
/// A form with a Save, unlike the rest of Settings, which applies each choice immediately. Two
/// reasons, and both are about the fields being meaningful only together: an endpoint typed one
/// character at a time is invalid for most of its life, and saving settings sweeps stored keys for
/// endpoints no profile references - so applying keystrokes would delete the user's key somewhere
/// around the third character of a URL they were part-way through typing.
export default function ChatProfileForm({
  draft: initial,
  hasKey,
  canRemove,
  onSave,
  onCancel,
  onRemove,
  onSaveKey,
  onDeleteKey,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [issues, setIssues] = useState<DraftField[]>([]);
  /// Held only until it is sent, then dropped. Never read back from the shell.
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);

  const set = <K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    // Clearing the flag as soon as the field is touched: leaving it red while the user fixes it
    // reads as though the correction was rejected too.
    setIssues((current) => current.filter((issue) => issue !== field));
  };

  const invalid = (field: DraftField) => (issues.includes(field) ? "true" : "false");

  const save = () => {
    const result = toProfile(draft);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    onSave(result.profile);
  };

  const saveKey = async () => {
    const trimmed = key.trim();
    if (trimmed === "") return;

    const result = await onSaveKey(draft.endpoint.trim(), trimmed);
    // Cleared either way. A key left in the box after a failure is a key sitting on screen, and the
    // user can paste it again.
    setKey("");
    setKeyError(result.ok ? null : t("settings.chat.keyFailed"));
  };

  return (
    <div className="mt-2 rounded-md border border-rule bg-sunken p-3">
      <label className="block text-xs text-ink-4">
        {t("settings.chat.name")}
        <input
          value={draft.label}
          aria-invalid={invalid("label")}
          onChange={(event) => set("label", event.target.value)}
          className={FIELD}
        />
      </label>

      <label className="mt-2 block text-xs text-ink-4">
        {t("settings.chat.endpoint")}
        <input
          value={draft.endpoint}
          aria-invalid={invalid("endpoint")}
          placeholder="https://api.example.com/v1"
          onChange={(event) => set("endpoint", event.target.value)}
          className={FIELD}
        />
      </label>

      <label className="mt-2 block text-xs text-ink-4">
        {t("settings.chat.model")}
        <input
          value={draft.model}
          aria-invalid={invalid("model")}
          onChange={(event) => set("model", event.target.value)}
          className={FIELD}
        />
      </label>
      {/* Outside the label on purpose: text inside one joins the field's accessible name, so a
          screen reader would announce the whole sentence every time the box took focus. */}
      <p className="mt-1 text-xs text-ink-4">{t("settings.chat.modelHint")}</p>

      <div className="mt-2 flex gap-2">
        <label className="flex-1 text-xs text-ink-4">
          {t("settings.chat.temperature")}
          <input
            value={draft.temperature}
            aria-invalid={invalid("temperature")}
            inputMode="decimal"
            onChange={(event) => set("temperature", event.target.value)}
            className={FIELD}
          />
        </label>
        <label className="flex-1 text-xs text-ink-4">
          {t("settings.chat.maxTokens")}
          <input
            value={draft.maxTokens}
            aria-invalid={invalid("maxTokens")}
            inputMode="numeric"
            onChange={(event) => set("maxTokens", event.target.value)}
            className={FIELD}
          />
        </label>
        <label className="flex-1 text-xs text-ink-4">
          {t("settings.chat.contextWindow")}
          <input
            value={draft.contextWindow}
            aria-invalid={invalid("contextWindow")}
            inputMode="numeric"
            onChange={(event) => set("contextWindow", event.target.value)}
            className={FIELD}
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-ink-4">{t("settings.chat.contextWindowHint")}</p>

      <label className="mt-2 flex items-center gap-2 text-ui text-ink">
        <input
          type="checkbox"
          checked={draft.supportsImages}
          onChange={(event) => set("supportsImages", event.target.checked)}
        />
        {t("settings.chat.supportsImages")}
      </label>

      <label className="mt-1 flex items-center gap-2 text-ui text-ink">
        <input
          type="checkbox"
          checked={draft.supportsTools}
          onChange={(event) => set("supportsTools", event.target.checked)}
        />
        {t("settings.chat.supportsTools")}
      </label>
      {/* Outside the label so the sentence does not join the checkbox's accessible name. */}
      <p className="mt-1 text-xs text-ink-4">{t("settings.chat.supportsToolsHint")}</p>

      <label className="mt-1 flex items-center gap-2 text-ui text-ink">
        <input
          type="checkbox"
          checked={draft.isDefault}
          onChange={(event) => set("isDefault", event.target.checked)}
        />
        {t("settings.chat.makeDefault")}
      </label>

      <div className="mt-3 border-t border-rule pt-3">
        <label className="block text-xs text-ink-4">
          {t("settings.chat.apiKey")}
          <input
            // A password field keeps the key out of a screen share and out of a screenshot, which is
            // how most people would first show someone else their settings.
            type="password"
            value={key}
            autoComplete="off"
            placeholder={hasKey ? t("settings.chat.replaceKey") : t("settings.chat.pasteKey")}
            onChange={(event) => setKey(event.target.value)}
            className={FIELD}
          />
        </label>

        <div className="mt-2 flex items-center gap-2">
          <span className={hasKey ? "text-xs text-leaf" : "text-xs text-ink-4"}>
            {hasKey ? t("settings.chat.keyStored") : t("settings.chat.noKey")}
          </span>
          <span className="flex-1" />
          {hasKey && (
            <button
              type="button"
              onClick={() => void onDeleteKey(draft.endpoint.trim())}
              className="rounded px-2 py-1 text-ui text-ink-4 hover:text-ink"
            >
              {t("settings.chat.removeKey")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveKey()}
            className="rounded border border-rule px-2 py-1 text-ui text-ink"
          >
            {t("settings.chat.saveKey")}
          </button>
        </div>

        {keyError !== null && <p className="mt-1 text-xs text-danger">{keyError}</p>}
        <p className="mt-1 text-xs text-ink-4">{t("settings.chat.keyHint")}</p>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          className="rounded bg-accent-strong px-3 py-1.5 text-ui text-white"
        >
          {t("settings.chat.saveModel")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-ui text-ink-4 hover:text-ink"
        >
          {t("settings.chat.cancel")}
        </button>
        <span className="flex-1" />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-3 py-1.5 text-ui text-danger"
          >
            {t("settings.chat.remove")}
          </button>
        )}
      </div>
    </div>
  );
}
