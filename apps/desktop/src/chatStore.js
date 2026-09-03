"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { ChatSessionSchema, loadChatSession, summariseSession } = require("@trypthos/domain");

/// Saved conversations, one plain JSON file each.
///
/// In the app-data directory rather than the workspace: writing into a folder the user curates would
/// put non-markdown files in their tree, and into a cloud-synced folder would invite sync conflicts
/// on files they never asked to sync. Pretty-printed, because "inspectable and greppable" is the
/// whole reason this is files rather than a database.
///
/// **A chat's id becomes its file name, and the id arrives from the renderer.** That is the security
/// surface here: an id that could escape this directory would be a way to read or overwrite any file
/// the user can. It is validated as a UUID before anything touches the filesystem - a shape check
/// rather than a hunt for dangerous characters, which is the version that stays correct as new ones
/// are invented.
///
/// **Reading is not total, unlike settings.** There is no default conversation. A file that cannot
/// be read is reported missing rather than replaced with an empty chat, which would look exactly
/// like a conversation that had been lost.

/// Version 4 UUIDs, as `crypto.randomUUID` produces. Anchored at both ends, so nothing may be
/// smuggled on either side of one.
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function chatsDir(userDataDir) {
  return path.join(userDataDir, "chats");
}

/// The path a chat lives at, or null if the id is not one we would ever have written.
function chatPath(userDataDir, id) {
  if (typeof id !== "string" || !CHAT_ID.test(id)) return null;
  return path.join(chatsDir(userDataDir), `${id}.json`);
}

async function saveSession(userDataDir, session) {
  const file = chatPath(userDataDir, session?.id);
  if (file === null) {
    console.error("Refused to save a chat with an id that is not a UUID.");
    return { ok: false, reason: "bad-id" };
  }

  // Validated before writing, not after reading: a malformed chat on disk is a chat the user cannot
  // open again, and the moment to refuse it is while their words are still in the panel.
  const parsed = ChatSessionSchema.safeParse(session);
  if (!parsed.success) {
    console.error("Refused to save a conversation that does not match the stored shape.");
    return { ok: false, reason: "bad-session" };
  }

  await fs.mkdir(chatsDir(userDataDir), { recursive: true });
  // Written via a temporary file and a rename, which is atomic: a crash mid-write would otherwise
  // leave a truncated file, and a truncated chat is an unreadable one.
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(parsed.data, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);

  return { ok: true };
}

async function loadSession(userDataDir, id) {
  const file = chatPath(userDataDir, id);
  if (file === null) return null;

  try {
    return loadChatSession(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    // Missing, unreadable, or not JSON. All the same answer to the caller, which then says the chat
    // could not be opened rather than showing an empty one.
    return null;
  }
}

async function listSessions(userDataDir) {
  let entries;
  try {
    entries = await fs.readdir(chatsDir(userDataDir), { withFileTypes: true });
  } catch {
    return []; // Nothing saved yet. The overwhelmingly common case.
  }

  const summaries = [];
  for (const entry of entries) {
    // A directory named like a chat file is not a chat, and neither is anything else in here.
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const session = await loadSession(userDataDir, entry.name.slice(0, -".json".length));
    // One corrupt file must not cost the user the rest of their history, so it is skipped rather
    // than allowed to fail the listing.
    if (session !== null) summaries.push(summariseSession(session));
  }

  // Newest first: the chat somebody wants next is almost always the one they had last.
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function deleteSession(userDataDir, id) {
  const file = chatPath(userDataDir, id);
  if (file === null) return { ok: false, reason: "bad-id" };

  // `force` so deleting a chat that is already gone is not an error: the user asked for it not to
  // be there, and it is not there.
  await fs.rm(file, { force: true });
  return { ok: true };
}

module.exports = { chatsDir, deleteSession, listSessions, loadSession, saveSession };
