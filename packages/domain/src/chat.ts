import { z } from "zod";

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
    /// Whether this model can be sent images. Gates attachment sending.
    supportsImages: z.boolean().default(false),
    isDefault: z.boolean().default(false),
  })
  .strict();

export type ChatProfile = z.infer<typeof ChatProfileSchema>;

/// Parses the configured profile list, enforcing the two invariants a per-item schema cannot see.
export function parseChatProfiles(input: unknown): ChatProfile[] {
  const profiles = z.array(ChatProfileSchema).parse(input);

  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new Error(`Duplicate chat profile id: ${profile.id}`);
    ids.add(profile.id);
  }

  const defaults = profiles.filter((profile) => profile.isDefault);
  if (defaults.length > 1) {
    throw new Error(`More than one default chat profile: ${defaults.map((p) => p.id).join(", ")}`);
  }

  return profiles;
}
