import { z } from "zod";
import type { ChatTurn } from "./chatCompletion";
import { loadPersisted, type Migration } from "./persisted";

/// A saved conversation.
///
/// Chats are plain files in the app-data directory - inspectable, greppable, no database and no
/// native module - and deliberately NOT in the workspace: writing into a folder the user curates
/// would put non-markdown files in their tree, and into a cloud-synced folder would invite sync
/// conflicts on files they never asked to sync.
///
/// The consequence is the interesting part. A chat **references** a workspace and a file it does not
/// own, so by the time it is opened again the file may have been renamed, moved or deleted, and the
/// workspace may not be open at all. None of those may stop a chat opening - the conversation is the
/// user's own words, and it is still worth reading with a broken reference attached.
///
/// **Reading is not total, unlike settings.** A settings file that cannot be read falls back to
/// defaults, because a default panel width is as good as a remembered one. There is no default
/// conversation: replacing an unreadable chat with an empty one would look exactly like a chat that
/// had been lost, so it reports failure instead and the caller can say so.

export const CHAT_SESSION_VERSION = 3;

/// How much of a reply's thinking a saved chat keeps, in characters.
///
/// Chain of thought is frequently longer than the answer, and chats are plain files in the app-data
/// directory - so a conversation whose file is mostly discarded working is a poor trade. Generous
/// enough to keep a real train of thought, small enough that a long session does not become a large
/// file. What is dropped is marked, never silently shortened.
export const SAVED_REASONING_LIMIT = 4_000;

/// One turn as a saved chat holds it.
///
/// NOT `ChatTurnSchema`, which is strict and describes what a PROVIDER receives. A saved chat is a
/// record of what the panel showed, so it keeps the two things the panel records for itself - what
/// the model thought, and which files it read. Neither is ever sent back.
const SessionTurnSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
    reasoning: z.string().optional(),
    /// True when `reasoning` was shortened on the way to disk, so the panel can say so rather than
    /// showing a train of thought that appears to stop mid-sentence.
    reasoningTruncated: z.boolean().optional(),
    reads: z.array(z.string()).optional(),
    /// True for a turn the APP wrote - the answer to a slash command, and the command that asked
    /// for it. Kept, because the panel showed it; carried, because reopening the chat must not
    /// start sending this app's own command tables to a provider.
    local: z.boolean().optional(),
  })
  .strict();

/// Trims what a chat keeps of each reply's thinking.
///
/// The beginning, as everywhere else here: reasoning says what it is about in its first lines, and
/// an arbitrary middle is worth less than an opening.
export function cappedForSaving<T extends { reasoning?: string }>(
  turns: readonly T[],
): (T & { reasoningTruncated?: boolean })[] {
  return turns.map((turn) => {
    if (turn.reasoning === undefined || turn.reasoning.length <= SAVED_REASONING_LIMIT) return turn;
    return {
      ...turn,
      reasoning: turn.reasoning.slice(0, SAVED_REASONING_LIMIT),
      reasoningTruncated: true,
    };
  });
}

export const ChatSessionSchema = z
  .object({
    schemaVersion: z.number(),
    /// A UUID. Also the file name, which is why the shell validates its shape before touching disk.
    id: z.string().min(1),
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    /// The workspace this chat was held in, recorded so a chat opened against a different folder can
    /// say where it came from. Null for a conversation with nothing open.
    workspaceRoot: z.string().nullable(),
    /// Workspace-relative, as it was when the chat was saved. May name a file that no longer exists.
    filePath: z.string().nullable(),
    /// The model it was held with. May name a profile since deleted, which is why nothing here
    /// assumes it resolves.
    profileId: z.string().nullable(),
    turns: z.array(SessionTurnSchema).min(1),
  })
  .strict();

export type ChatSession = z.infer<typeof ChatSessionSchema>;

/// What the list of saved chats shows.
///
/// Deliberately without the turns. The list is drawn before anything is opened, and carrying the
/// conversation would mean reading every word of every saved chat to draw a menu.
export interface ChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  filePath: string | null;
}

/// No migrations yet. The first shape change writes one here, in the PR that makes it.
export const CHAT_SESSION_MIGRATIONS: Migration[] = [
  {
    to: 3,
    // Version 3 lets a turn say the app wrote it rather than the model. Optional in the schema, so
    // a version 2 file loads either way - the version exists for the OTHER direction, as version 2
    // did: a chat written here and read by the previous build would fail its strict turn schema and
    // take the conversation with it.
    migrate: (input) => input,
  },
  {
    to: 2,
    // Version 2 lets a turn carry what the panel recorded for itself - the model's thinking, and the
    // files a reply read. Both are optional in the schema, so a version 1 file loads either way;
    // the version exists for the OTHER direction, as it does in settings. A chat written here and
    // read by the previous build would fail its strict turn schema and take the conversation with
    // it. A version it does not recognise is refused cleanly instead.
    migrate: (input) => input,
  },
];

export function loadChatSession(raw: unknown): ChatSession | null {
  const result = loadPersisted(raw, {
    currentVersion: CHAT_SESSION_VERSION,
    migrations: CHAT_SESSION_MIGRATIONS,
    parse: (value) => ChatSessionSchema.parse(value),
  });

  return result.ok ? result.value : null;
}

export function summariseSession(session: ChatSession): ChatSessionSummary {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    filePath: session.filePath,
  };
}

/// How long a title may be before it is cut. Long enough for a real question, short enough that a
/// list of them stays a list.
const TITLE_LIMIT = 60;

/// Names a conversation after the question that started it.
///
/// Derived rather than asked for: a dialog demanding a name before a chat can be saved is a dialog
/// people learn to dismiss, and the first question is almost always what the conversation was about.
export function chatTitleFrom(turns: readonly ChatTurn[]): string {
  const asked = turns.find((turn) => turn.role === "user" && turn.content.trim() !== "");
  // Whitespace collapsed: a question typed over several lines would otherwise put line breaks
  // through the middle of a menu entry.
  const title = asked?.content.replace(/\s+/g, " ").trim() ?? "";

  if (title === "") return "Untitled chat";
  return title.length <= TITLE_LIMIT ? title : `${title.slice(0, TITLE_LIMIT - 3).trimEnd()}...`;
}
