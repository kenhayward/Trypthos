import { ChatProfileSchema, type ChatProfile } from "@trypthos/domain";

/// The levels the schema allows, named here so the form and the draft agree with it.
export type ReasoningEffort = ChatProfile["reasoningEffort"];

/// Editing the configured chat models.
///
/// Separate from the dialog because none of it is presentation: it is the rules about what a valid
/// profile is and what the list may look like, and those are worth testing without rendering
/// anything. The component below it does nothing but show what these functions return.
///
/// **Why profiles are edited in a form rather than applied as you type**, unlike every other
/// preference: a profile is several fields that are only meaningful together. An endpoint typed one
/// character at a time is invalid for most of its life, and applying each keystroke would write a
/// stream of broken profiles to disk - and, because saving settings sweeps unreferenced keys, would
/// delete the user's API key somewhere around the third character.

/// A profile being edited. Every field is a string, because that is what an input holds.
///
/// The numbers are the reason this type exists rather than a `Partial<ChatProfile>`: an empty number
/// input is `""`, which is neither a number nor absent, and coercing it early turns "I have not set
/// a temperature" into "send temperature 0".
export interface ProfileDraft {
  id: string;
  label: string;
  endpoint: string;
  model: string;
  temperature: string;
  maxTokens: string;
  /// The model's context window, or "" for "I do not know" - which is a real answer, and the one
  /// most people have. See `contextWindow` on the schema.
  contextWindow: string;
  supportsImages: boolean;
  supportsTools: boolean;
  /// Whether to ask this model to reason before answering, and how much.
  ///
  /// Two fields, not one four-valued one, so turning thinking off and on again does not lose the
  /// level. Both are booleans and enums rather than text, so unlike the numbers above they need no
  /// parsing and can never be invalid.
  thinking: boolean;
  reasoningEffort: ReasoningEffort;
  isDefault: boolean;
}

export type DraftField = keyof ProfileDraft;

export type DraftResult =
  | { ok: true; profile: ChatProfile }
  | { ok: false; issues: DraftField[] };

function newId(): string {
  // Stable for the life of the profile, because saved chats reference it. Random rather than derived
  // from the label, which the user can rename freely.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function blankDraft(): ProfileDraft {
  return {
    id: newId(),
    label: "",
    endpoint: "",
    model: "",
    temperature: "",
    maxTokens: "",
    contextWindow: "",
    supportsImages: false,
    supportsTools: false,
    thinking: false,
    reasoningEffort: "medium",
    isDefault: false,
  };
}

export function draftFrom(profile: ChatProfile): ProfileDraft {
  return {
    id: profile.id,
    label: profile.label,
    endpoint: profile.endpoint,
    model: profile.model,
    // An unset parameter is an empty box. `String(undefined)` would put the word "undefined" in it.
    temperature: profile.temperature === undefined ? "" : String(profile.temperature),
    maxTokens: profile.maxTokens === undefined ? "" : String(profile.maxTokens),
    // Null is unset here rather than undefined, so it is the same empty box.
    contextWindow: profile.contextWindow === null ? "" : String(profile.contextWindow),
    supportsImages: profile.supportsImages,
    supportsTools: profile.supportsTools,
    thinking: profile.thinking,
    reasoningEffort: profile.reasoningEffort,
    isDefault: profile.isDefault,
  };
}

/// Blank means "not set", anything else must be a number. `Number("")` is 0, which is why this
/// cannot simply coerce.
function optionalNumber(text: string): number | undefined | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : "invalid";
}

/// Validates a draft against the real schema, and reports which FIELDS are wrong.
///
/// Against `ChatProfileSchema` itself rather than a second set of rules written for the form: two
/// definitions of a valid profile would agree today and drift by the next change, and the one the
/// user sees would be the one that was not enforced.
export function toProfile(draft: ProfileDraft): DraftResult {
  const issues: DraftField[] = [];

  const temperature = optionalNumber(draft.temperature);
  if (temperature === "invalid") issues.push("temperature");

  const maxTokens = optionalNumber(draft.maxTokens);
  if (maxTokens === "invalid") issues.push("maxTokens");

  const contextWindow = optionalNumber(draft.contextWindow);
  if (contextWindow === "invalid") issues.push("contextWindow");

  const parsed = ChatProfileSchema.safeParse({
    id: draft.id,
    label: draft.label.trim(),
    endpoint: draft.endpoint.trim(),
    model: draft.model.trim(),
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    // Explicitly null when unset, not absent: absent takes the schema default, which is null too -
    // but saying it here keeps "the user cleared the box" and "the field did not exist" the same
    // answer rather than two paths that happen to agree.
    contextWindow: typeof contextWindow === "number" ? contextWindow : null,
    supportsImages: draft.supportsImages,
    supportsTools: draft.supportsTools,
    thinking: draft.thinking,
    reasoningEffort: draft.reasoningEffort,
    isDefault: draft.isDefault,
  });

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !issues.includes(field as DraftField)) {
        issues.push(field as DraftField);
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  // Unreachable unless a field was added to the schema and not to the draft, which the issue loop
  // above would have reported.
  return parsed.success
    ? { ok: true, profile: parsed.data }
    : { ok: false, issues: ["label"] };
}

/// Adds or replaces a profile, keeping the list's order.
///
/// Order matters: it is the order the picker shows, so a saved edit must not send a model to the
/// bottom of the list.
export function upsertProfile(
  profiles: readonly ChatProfile[],
  profile: ChatProfile,
): ChatProfile[] {
  // Exactly one default, enforced here because the settings schema rejects a list with two - so a UI
  // that could produce one would fail on save with an error the user could not act on.
  const cleared = profile.isDefault
    ? profiles.map((existing) => ({ ...existing, isDefault: false }))
    : [...profiles];

  const at = cleared.findIndex((existing) => existing.id === profile.id);
  if (at === -1) return [...cleared, profile];

  cleared[at] = profile;
  return cleared;
}

export function removeProfile(profiles: readonly ChatProfile[], id: string): ChatProfile[] {
  return profiles.filter((profile) => profile.id !== id);
}
