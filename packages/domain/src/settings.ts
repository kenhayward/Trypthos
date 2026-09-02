import { z } from "zod";
import { loadPersisted, type Migration } from "./persisted";

/// Everything Trypthos remembers between launches, in one file.
///
/// One file rather than several: one shape to migrate, one place to look, and no chance of two files
/// disagreeing about which workspace was last open. It lives in the app-data directory, never in the
/// user's workspace - see the chat storage rule, which this follows for the same reasons.
///
/// None of this is the user's work. It is a convenience, so every failure to read it falls back to
/// defaults rather than stopping the app.

export const SETTINGS_VERSION = 1;

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
};

/// Written in the PR that changes the shape, never afterwards.
///
/// Empty while there is only one version - the machinery is here so the first shape change has
/// somewhere to go, rather than being retrofitted once somebody's settings are already on disk.
export const SETTINGS_MIGRATIONS: Migration[] = [];

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
