import { useCallback, useEffect, useState } from "react";
import type { ChatSession, ChatSessionSummary } from "@trypthos/domain";

/// The saved conversations, and what can be done to them.
///
/// Separate from `useChat`, which owns the conversation in progress. The two meet only when one is
/// saved or opened, and keeping them apart means the panel can list history without the streaming
/// state that has nothing to do with it.

export interface ChatHistoryBridge {
  listChats(): Promise<{ ok: true; chats: ChatSessionSummary[] } | { ok: false; reason: string }>;
  loadChat(id: string): Promise<{ ok: true; chat: ChatSession } | { ok: false; reason: string }>;
  saveChat(request: {
    id: string | null;
    turns: ChatSession["turns"];
    profileId: string | null;
    filePath: string | null;
  }): Promise<{ ok: true; id: string; title: string } | { ok: false; reason: string }>;
  deleteChat(id: string): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export function useChatHistory(bridge: ChatHistoryBridge | null) {
  const [chats, setChats] = useState<ChatSessionSummary[]>([]);
  /// The chat currently open, so saving again replaces it rather than making a second copy.
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (bridge === null) return;
    const result = await bridge.listChats();
    if (result.ok) setChats(result.chats);
  }, [bridge]);

  useEffect(() => {
    if (bridge === null) return;

    let cancelled = false;
    void bridge.listChats().then((result) => {
      // The panel can close, or a newer listing can land first. Setting state then would replace a
      // current answer with a stale one.
      if (cancelled || !result.ok) return;
      setChats(result.chats);
    });

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const save = useCallback(
    async (turns: ChatSession["turns"], profileId: string | null, filePath: string | null) => {
      // Nothing to save is not a failure, and a chat with no turns is not a conversation.
      if (bridge === null || turns.length === 0) return { ok: false as const, reason: "nothing" };

      const result = await bridge.saveChat({ id: openId, turns, profileId, filePath });
      if (result.ok) {
        setOpenId(result.id);
        await refresh();
      }
      return result;
    },
    [bridge, openId, refresh],
  );

  const open = useCallback(
    async (id: string) => {
      if (bridge === null) return null;

      const result = await bridge.loadChat(id);
      if (!result.ok) {
        // Gone or unreadable. The list is refreshed either way, so a chat deleted from underneath
        // the panel stops being offered.
        await refresh();
        return null;
      }

      setOpenId(id);
      return result.chat;
    },
    [bridge, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (bridge === null) return;

      await bridge.deleteChat(id);
      // Deleting the chat that is open makes the thread on screen a new, unsaved one: saving again
      // must not resurrect the file the user just removed.
      if (id === openId) setOpenId(null);
      await refresh();
    },
    [bridge, openId, refresh],
  );

  /// Called when the thread is cleared or replaced by a new conversation.
  const forget = useCallback(() => setOpenId(null), []);

  return { chats, openId, refresh, save, open, remove, forget };
}
