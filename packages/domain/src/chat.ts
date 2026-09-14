import { z } from "zod";

/// How long a model may go without sending anything before the app stops waiting, in minutes.
///
/// Ten by default: long enough for a large reasoning model to think before its first token, short
/// enough that an endpoint which has silently gone away does not hold the stop button up for an
/// afternoon. An hour at most - past that a request is not slow, it is stuck.
export const DEFAULT_TIMEOUT_MINUTES = 10;
export const MAX_TIMEOUT_MINUTES = 60;

/// A chat profile: one endpoint, one model, and the parameters to call it with.
///
/// Note what is NOT here: the API key. Keys live in the OS credential store, keyed by endpoint, and
/// never cross into the renderer or into any file the app writes. The schema is `.strict()` so a key
/// that somehow reaches a settings file is a loud parse failure rather than a silently stripped
/// field that would then be written back out on the next save.
export const ChatProfileSchema = z
  .object({
    /// Stable id, referenced by saved chats. Never reuse one for a different endpoint.
    id: z.string().min(1),
    /// What the user reads in the picker. Never the model slug - see `model`.
    label: z.string().min(1),
    /// An OpenAI-compatible base URL, e.g. https://api.example.com/v1
    endpoint: z.url(),
    /// The slug the endpoint expects. Distinct from `label` on purpose: the two are never conflated
    /// in the UI, because a slug is not a name.
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().min(0).max(1).optional(),
    /// How many tokens this model can take in one conversation, or null when nobody has said.
    ///
    /// Null rather than a default, and never detected: there is no way to ask an OpenAI-compatible
    /// endpoint how big its window is, and a number invented here would draw a context dial that is
    /// confidently wrong - worse than one that admits it does not know the total.
    contextWindow: z.number().int().positive().nullable().default(null),
    /// Whether this model can be sent images. Gates attachment sending.
    supportsImages: z.boolean().default(false),
    /// Whether this endpoint supports provider tool calling.
    ///
    /// Off by default, and deliberately not detected. There is no reliable way to ask an
    /// OpenAI-compatible endpoint whether it supports tools: several accept a `tools` array, ignore
    /// it, and answer in prose - which looks exactly like a model that chose not to call one. The
    /// fenced transport works everywhere, so the safe default is the one that always works and this
    /// is opt-in.
    supportsTools: z.boolean().default(false),
    /// Whether replies arrive as server-sent events rather than one completed response.
    ///
    /// On by default: showing a reply as it is written is the normal chat experience. Some local
    /// OpenAI-compatible servers, however, lose structured tool-call fields while serialising
    /// streamed deltas. This is per profile because it is a property of the model and harness pair,
    /// not of every model pointed at the same endpoint.
    stream: z.boolean().default(true),
    /// How many minutes this model may send NOTHING before the app gives up on the reply.
    ///
    /// Silence, not duration: the clock restarts with every piece of a reply, so a long answer that
    /// keeps arriving is never cut off. With streaming off the whole reply arrives at once, so this
    /// bounds the wait for all of it. Per profile, because a small local model and a large reasoning
    /// model on the same endpoint need very different patience.
    timeoutMinutes: z.number().int().min(1).max(MAX_TIMEOUT_MINUTES).default(DEFAULT_TIMEOUT_MINUTES),
    /// Whether to ask the model to reason before answering.
    ///
    /// Off by default, for the same reason `supportsTools` is: `reasoning_effort` is a field a
    /// server that has never heard of it will at best ignore and at worst reject, and a model with
    /// no reasoning mode gains nothing from being asked for one. Opt in per model.
    thinking: z.boolean().default(false),
    /// How much, when thinking is on. The three levels gpt-oss names.
    ///
    /// A SEPARATE field from `thinking` rather than a fourth value of it, so turning thinking off
    /// and on again does not lose the level somebody chose. Medium is the middle of the three and
    /// what these models default to themselves.
    reasoningEffort: z.enum(["low", "medium", "high"]).default("medium"),
    isDefault: z.boolean().default(false),
  })
  .strict();

export type ChatProfile = z.infer<typeof ChatProfileSchema>;

/// The configured list, with the two invariants no per-item schema can see.
///
/// A schema rather than only a function, because the list is a field of the settings file and has to
/// be checked wherever settings are parsed. Left as a bare array there, a hand-edited file with two
/// defaults would load without complaint and the picker would start on whichever one the UI reached
/// first - a difference nobody could explain from the file.
export const ChatProfileListSchema = z
  .array(ChatProfileSchema)
  .superRefine((profiles, ctx) => {
    const seen = new Set<string>();
    profiles.forEach((profile, index) => {
      if (seen.has(profile.id)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Duplicate chat profile id: ${profile.id}`,
        });
      }
      seen.add(profile.id);
    });

    const defaults = profiles.filter((profile) => profile.isDefault);
    if (defaults.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: [profiles.indexOf(defaults[1]!), "isDefault"],
        message: `More than one default chat profile: ${defaults.map((p) => p.id).join(", ")}`,
      });
    }
  });

/// Parses the configured profile list. Throws, for call sites that want the failure.
export function parseChatProfiles(input: unknown): ChatProfile[] {
  return ChatProfileListSchema.parse(input);
}

/// The profile a new chat starts on: the one marked default, else the first configured, else none.
///
/// Total on purpose. An empty list is the state every user is in before they configure anything, and
/// a list whose default was deleted is one edit away at all times.
export function defaultChatProfile(profiles: readonly ChatProfile[]): ChatProfile | null {
  return profiles.find((profile) => profile.isDefault) ?? profiles[0] ?? null;
}
