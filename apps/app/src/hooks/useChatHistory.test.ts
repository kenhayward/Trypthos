import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@trypthos/domain";
import { useChatHistory, type ChatHistoryBridge } from "./useChatHistory";

const TURNS: ChatSession["turns"] = [
  { role: "user", content: "Summarise this" },
  { role: "assistant", content: "It is a plan." },
];

/// A shell that keeps saved chats in memory, so the hook's own bookkeeping is what is under test.
function fakeBridge() {
  const saved = new Map<string, ChatSession>();
  const listed = vi.fn();
  let next = 0;

  const bridge: ChatHistoryBridge = {
    listChats: vi.fn(async () => {
      listed();
      return {
      ok: true as const,
      chats: [...saved.values()].map((chat) => ({
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        filePath: chat.filePath,
      })),
      };
    }),
    loadChat: vi.fn(async (id: string) => {
      const chat = saved.get(id);
      return chat === undefined
        ? { ok: false as const, reason: "not-found" }
        : { ok: true as const, chat };
    }),
    saveChat: vi.fn(async ({ id, turns, profileId, filePath }) => {
      next += 1;
      const chatId = id ?? `chat-${next}`;
      saved.set(chatId, {
        schemaVersion: 1,
        id: chatId,
        title: "Summarise this",
        createdAt: "2026-09-03T10:00:00.000Z",
        updatedAt: `2026-09-03T10:0${next}:00.000Z`,
        workspaceRoot: "D:/Notes",
        filePath,
        profileId,
        turns,
      });
      return { ok: true as const, id: chatId, title: "Summarise this" };
    }),
    deleteChat: vi.fn(async (id: string) => {
      saved.delete(id);
      return { ok: true as const };
    }),
  };

  return { bridge, saved, listed };
}

const history = (bridge: ChatHistoryBridge | null) => renderHook(() => useChatHistory(bridge));

describe("useChatHistory", () => {
  it("lists what has been saved", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(TURNS, "one", "plan.md");
    });

    expect(result.current.chats.map((chat) => chat.title)).toEqual(["Summarise this"]);
  });

  // Saving twice must replace, or every save would leave another copy in the list.
  it("replaces the open chat rather than saving a second copy", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(TURNS, "one", "plan.md");
    });
    await act(async () => {
      await result.current.save([...TURNS, { role: "user", content: "More" }], "one", "plan.md");
    });

    expect(result.current.chats).toHaveLength(1);
  });

  it("remembers which chat is open, so a later save updates it", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(TURNS, "one", "plan.md");
    });

    expect(result.current.openId).not.toBeNull();
  });

  it("saves nothing for an empty conversation", async () => {
    const { bridge, saved } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save([], null, null);
    });

    expect(saved.size).toBe(0);
  });

  it("opens a saved chat", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(TURNS, "one", "plan.md");
    });

    let opened: ChatSession | null = null;
    await act(async () => {
      opened = await result.current.open(result.current.chats[0]!.id);
    });

    expect(opened).not.toBeNull();
    expect(opened!.turns).toEqual(TURNS);
  });

  // Deleted from underneath the panel, or a file that will not read. Either way the list is brought
  // up to date so a chat that cannot be opened stops being offered.
  it("refreshes the list when a chat will not open", async () => {
    const { bridge, listed } = fakeBridge();
    const { result } = history(bridge);
    await waitFor(() => expect(listed).toHaveBeenCalled());
    const before = listed.mock.calls.length;

    let opened: ChatSession | null = null;
    await act(async () => {
      opened = await result.current.open("gone");
    });

    expect(opened).toBeNull();
    expect(listed.mock.calls.length).toBeGreaterThan(before);
  });

  it("deletes a chat and stops listing it", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(TURNS, "one", "plan.md");
    });
    await act(async () => {
      await result.current.remove(result.current.chats[0]!.id);
    });

    expect(result.current.chats).toEqual([]);
  });

  // Saving again after deleting the open chat must not resurrect the file the user just removed.
  it("forgets the open chat when it is the one deleted", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(TURNS, "one", "plan.md");
    });
    const id = result.current.openId!;
    await act(async () => {
      await result.current.remove(id);
    });

    expect(result.current.openId).toBeNull();
  });

  it("keeps the open chat when a different one is deleted", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(TURNS, "one", "a.md");
    });
    const first = result.current.openId!;
    await act(async () => {
      await result.current.remove("chat-somebody-else");
    });

    expect(result.current.openId).toBe(first);
  });

  // Starting a new conversation means the next save is a new chat, not an overwrite of the last.
  it("forgets the open chat when the thread is cleared", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(TURNS, "one", "plan.md");
    });
    act(() => result.current.forget());

    expect(result.current.openId).toBeNull();
  });

  // The browser preview, where there is no shell to save into.
  it("does nothing at all without a shell", async () => {
    const { result } = history(null);

    await act(async () => {
      await result.current.save(TURNS, null, null);
      await result.current.remove("anything");
    });

    expect(result.current.chats).toEqual([]);
  });
});
