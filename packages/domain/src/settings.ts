import { z } from "zod";
import { ChatProfileListSchema } from "./chat";
import { loadPersisted, type Migration } from "./persisted";
import { DEFAULT_SYSTEM_PROMPT, PREVIOUS_SYSTEM_PROMPTS } from "./systemPrompt";

/// Everything Trypthos remembers between launches, in one file.
///
/// One file rather than several: one shape to migrate, one place to look, and no chance of two files
/// disagreeing about which workspace was last open. It lives in the app-data directory, never in the
/// user's workspace - see the chat storage rule, which this follows for the same reasons.
///
/// None of this is the user's work. It is a convenience, so every failure to read it falls back to
/// defaults rather than stopping the app.

export const SETTINGS_VERSION = 6;

export const SettingsSchema = z
  .object({
    schemaVersion: z.number(),
    panels: z
      .object({
        workspaceWidth: z.number(),
        chatWidth: z.number(),
        workspaceCollapsed: z.boolean(),
        chatCollapsed: z.boolean(),
      })
      .strict(),
    /// Absolute path to the folder open when the app last closed, reopened on launch.
    lastWorkspace: z.string().nullable(),
    appearance: z
      .object({
        /// "system" follows the OS and keeps following it while the app is open. The other two are
        /// explicit choices that win in both directions - a media query alone cannot express
        /// "light, on a dark OS".
        theme: z.enum(["system", "light", "dark"]),
      })
      .strict(),
    window: z
      .object({
        /// Whether closing the window hides it to the notification area instead of quitting.
        closeToTray: z.boolean(),
      })
      .strict(),
    chat: z
      .object({
        /// The configured models, in the order the user arranged them - which is the order the
        /// picker shows. No API keys: see `ChatProfileSchema`.
        profiles: ChatProfileListSchema,
        /// Sent ahead of every conversation. One prompt for the app rather than one per model: it
        /// describes what Trypthos is and how answers should read, and none of that changes with
        /// the endpoint answering.
        ///
        /// **Null means "use the built-in default", and is not the same as a copy of it.** Storing
        /// the text made every later improvement invisible to anyone who already had settings: the
        /// release that taught the model to propose document edits reached nobody with an existing
        /// installation, because their file still held the previous version's prompt. Null is
        /// resolved at send time, so a change to the default reaches everyone who has not written
        /// their own - no migration, and no stored copy to go stale.
        ///
        /// An empty string is a third state and deliberate: send no system message at all, for an
        /// endpoint that carries its own prompt. Somebody who clears it means it.
        systemPrompt: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_VERSION,
  panels: {
    workspaceWidth: 268,
    chatWidth: 348,
    workspaceCollapsed: false,
    chatCollapsed: false,
  },
  lastWorkspace: null,
  appearance: { theme: "system" },
  window: { closeToTray: false },
  chat: { profiles: [], systemPrompt: null },
};

/// Written in the PR that changes the shape, never afterwards.
///
/// Each migration adds only what its version introduced, and touches nothing else. A settings file
/// from 0.9.0 must arrive intact - somebody's panel widths and open folder are not worth losing over
/// two fields that did not exist yet.
export const SETTINGS_MIGRATIONS: Migration[] = [
  {
    to: 2,
    // Version 2 added appearance and window behaviour.
    migrate: (input) => ({
      ...input,
      appearance: { theme: "system" },
      window: { closeToTray: false },
    }),
  },
  {
    to: 3,
    // Version 3 added chat profiles. Empty, not seeded: see the test.
    migrate: (input) => ({ ...input, chat: { profiles: [] } }),
  },
  {
    to: 4,
    // Version 4 added the system prompt, seeded with the default text. Storing that text was the
    // mistake version 5 undoes; the migration is left as written, because a migration is a record
    // of what a version did and rewriting one changes what old files become.
    migrate: (input) => {
      const chat = (input as { chat?: Record<string, unknown> }).chat ?? {};
      return { ...input, chat: { ...chat, systemPrompt: DEFAULT_SYSTEM_PROMPT } };
    },
  },
  {
    to: 6,
    // Version 6 added `supportsTools` to each profile. The schema defaults it, so an old file would
    // load either way - the version bump is for the OTHER direction: `ChatProfileSchema` is strict,
    // so a file written by this version and read by the previous one would fail to parse and take
    // every configured model with it. A version it does not recognise is refused cleanly instead.
    migrate: (input) => {
      const chat = (input as { chat?: { profiles?: unknown[] } }).chat ?? {};
      const profiles = Array.isArray(chat.profiles) ? chat.profiles : [];
      return {
        ...input,
        chat: {
          ...chat,
          profiles: profiles.map((profile) => ({ supportsTools: false, ...(profile as object) })),
        },
      };
    },
  },
  {
    to: 5,
    // Version 5 makes the prompt nullable, where null means "the current default".
    //
    // A stored prompt byte-identical to a default this app has shipped was never written by anyone -
    // it was seeded - so it becomes null and starts tracking the default again. Anything else is
    // somebody's own work and is left exactly as it is, including an empty string.
    migrate: (input) => {
      const chat = (input as { chat?: Record<string, unknown> }).chat ?? {};
      const stored = chat.systemPrompt;
      const seeded =
        typeof stored === "string" &&
        (stored === DEFAULT_SYSTEM_PROMPT || PREVIOUS_SYSTEM_PROMPTS.includes(stored));

      return { ...input, chat: { ...chat, systemPrompt: seeded ? null : (stored ?? null) } };
    },
  },
];

/// Reads stored settings, or the defaults.
///
/// Deliberately total: it cannot fail. A corrupt file, a file from a newer build, a file that is not
/// an object at all - all answer with defaults, and the next save replaces it. The alternative is an
/// app that will not open because a remembered panel width is malformed.
export function loadSettings(raw: unknown): Settings {
  if (raw === undefined || raw === null) return DEFAULT_SETTINGS;

  const result = loadPersisted(raw, {
    currentVersion: SETTINGS_VERSION,
    migrations: SETTINGS_MIGRATIONS,
    parse: (value) => SettingsSchema.parse(value),
  });

  return result.ok ? result.value : DEFAULT_SETTINGS;
}
