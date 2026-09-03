import { z } from "zod";
import { ChatTurnSchema, type ChatTurn } from "./chatCompletion";
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

export const CHAT_SESSION_VERSION = 1;

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
    turns: z.array(ChatTurnSchema).min(1),
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
export const CHAT_SESSION_MIGRATIONS: Migration[] = [];

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
