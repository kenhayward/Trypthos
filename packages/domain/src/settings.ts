import { z } from "zod";
import { ChatProfileListSchema } from "./chat";
import { DEFAULT_EDITOR_MODE, EditorModeSchema } from "./editorMode";
import { DEFAULT_FILE_TYPES } from "./fileTypes";
import { DEFAULT_OUTLINE_FILE_LIMIT, OUTLINE_PATH_LIMIT } from "./chatContext";
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

export const SETTINGS_VERSION = 12;

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
        /// How many files the folder outline names.
        ///
        /// A setting rather than a constant because it is a trade the user owns: every entry is a
        /// file the model might ask to read, so a larger list is a more capable chat and a more
        /// expensive one. Bounded at both ends - zero would make the folder option do nothing while
        /// appearing to work.
        folderFileLimit: z.number().int().min(1).max(OUTLINE_PATH_LIMIT),
        /// Whether the chat panel is part of the window at all.
        ///
        /// **Null means "decide from what is configured", and is not the same as false.** A panel
        /// with no model behind it can only tell the user to go and configure one, so until they
        /// have, it is not there - and the moment they add their first model it appears without
        /// anybody having to find this setting. Storing false instead would keep it hidden through
        /// exactly the moment it became useful.
        ///
        /// An explicit true or false wins in both directions: somebody who wants a plain editor
        /// with models configured, or an empty panel to configure them from, means it.
        showPanel: z.boolean().nullable(),
      })
      .strict(),
    fileTypes: z
      .object({
        /// The file types the app takes an interest in, by id.
        ///
        /// **Strings, not an enum, and deliberately so.** A settings file written by a newer build
        /// names types this one has never heard of; a strict enum would refuse the whole file and
        /// take the user's panel widths, their open folder and every configured model with it. An
        /// id nothing recognises is ignored where it is READ (`enabledFileTypes`) and left alone
        /// here, so an upgrade and a downgrade do not each wipe the other's choices.
        ///
        /// Ids rather than extensions, so a type can gain an extension in a later release without
        /// a migration.
        enabled: z.array(z.string()),
      })
      .strict(),
    editor: z
      .object({
        /// The view a document opens in.
        ///
        /// A default rather than a mode: switching view in the header is still a per-document
        /// choice, and this is only where each one starts. Stored as the mode's own name so a
        /// settings file says what it means, and refused when it names a mode the editor cannot
        /// draw - an unknown one would leave the centre panel blank.
        defaultViewMode: EditorModeSchema,
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
  chat: {
    profiles: [],
    systemPrompt: null,
    folderFileLimit: DEFAULT_OUTLINE_FILE_LIMIT,
    showPanel: null,
  },
  fileTypes: { enabled: [...DEFAULT_FILE_TYPES] },
  editor: { defaultViewMode: DEFAULT_EDITOR_MODE },
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
    to: 7,
    // Version 7 added the outline size. Seeded with the default rather than left absent, because
    // this one is a number the user may want to change and an unset number is not a value.
    migrate: (input) => {
      const chat = (input as { chat?: Record<string, unknown> }).chat ?? {};
      return { ...input, chat: { ...chat, folderFileLimit: DEFAULT_OUTLINE_FILE_LIMIT } };
    },
  },
  {
    to: 8,
    // Version 8 added the chat panel switch. Null rather than a value, so an existing settings file
    // gets the same answer a new one does: the panel is there if a model is configured. Writing
    // true for everyone who had one would freeze the choice for people who never made it.
    migrate: (input) => {
      const chat = (input as { chat?: Record<string, unknown> }).chat ?? {};
      return { ...input, chat: { ...chat, showPanel: null } };
    },
  },
  {
    to: 9,
    // Version 9 added the editor section. Seeded with the mode the app has always opened in, because
    // adding a setting must not change what an existing installation does.
    migrate: (input) => ({ ...input, editor: { defaultViewMode: DEFAULT_EDITOR_MODE } }),
  },
  {
    to: 10,
    // Version 10 added each profile's context window. The schema defaults it, so an old file would
    // load either way - the version is for the OTHER direction, as with version 6: a file written
    // here and read by the previous build would fail its strict profile schema and take every
    // configured model with it.
    migrate: (input) => {
      const chat = (input as { chat?: { profiles?: unknown[] } }).chat ?? {};
      const profiles = Array.isArray(chat.profiles) ? chat.profiles : [];
      return {
        ...input,
        chat: {
          ...chat,
          profiles: profiles.map((profile) => ({ contextWindow: null, ...(profile as object) })),
        },
      };
    },
  },
  {
    to: 12,
    // Version 12 added thinking and its level to each profile. The schema defaults both, so an old
    // file would load either way - the version is for the OTHER direction, as with versions 6 and
    // 10: ChatProfileSchema is strict, so a file written here and read by the previous build would
    // fail to parse and take every configured model with it. A version it does not recognise is
    // refused cleanly instead.
    migrate: (input) => {
      const chat = (input as { chat?: { profiles?: unknown[] } }).chat ?? {};
      const profiles = Array.isArray(chat.profiles) ? chat.profiles : [];
      return {
        ...input,
        chat: {
          ...chat,
          profiles: profiles.map((profile) => ({
            thinking: false,
            reasoningEffort: "medium",
            ...(profile as object),
          })),
        },
      };
    },
  },
  {
    to: 11,
    // Version 11 added the file types. Markdown alone, written out rather than read from
    // DEFAULT_FILE_TYPES: a migration is a record of what a version DID, and reading a constant
    // would silently change what old files become the day that constant changes. Nothing an
    // existing installation shows is altered by this.
    migrate: (input) => ({ ...input, fileTypes: { enabled: ["markdown"] } }),
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

/// Whether the chat panel belongs in the window.
///
/// Pure, and shared, because both the layout and the preference control have to agree: the panel is
/// drawn from this, and the checkbox that sets it shows this as its state. See `showPanel` for why
/// unset is derived rather than stored.
export function chatPanelVisible(chat: Settings["chat"]): boolean {
  return chat.showPanel ?? chat.profiles.length > 0;
}
