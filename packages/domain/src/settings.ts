import { z } from "zod";
import { ChatProfileListSchema } from "./chat";
import { loadPersisted, type Migration } from "./persisted";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt";

/// Everything Trypthos remembers between launches, in one file.
///
/// One file rather than several: one shape to migrate, one place to look, and no chance of two files
/// disagreeing about which workspace was last open. It lives in the app-data directory, never in the
/// user's workspace - see the chat storage rule, which this follows for the same reasons.
///
/// None of this is the user's work. It is a convenience, so every failure to read it falls back to
/// defaults rather than stopping the app.

export const SETTINGS_VERSION = 4;

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
        /// May be empty. Somebody who clears it means it, and a migration must not put it back.
        systemPrompt: z.string(),
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
  chat: { profiles: [], systemPrompt: DEFAULT_SYSTEM_PROMPT },
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
    // Version 4 added the system prompt, seeded with the default so chat is useful before anyone
    // opens Preferences. Only a file that predates the field is seeded - a prompt somebody cleared
    // on purpose is already at version 4 and is never touched again.
    migrate: (input) => {
      const chat = (input as { chat?: Record<string, unknown> }).chat ?? {};
      return { ...input, chat: { ...chat, systemPrompt: DEFAULT_SYSTEM_PROMPT } };
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
