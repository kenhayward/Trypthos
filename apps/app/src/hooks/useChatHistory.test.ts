import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@trypthos/domain";
import { useChatHistory, type ChatHistoryBridge, type SavedChat } from "./useChatHistory";

const TURNS: ChatSession["turns"] = [
  { role: "user", content: "Summarise this" },
  { role: "assistant", content: "It is a plan." },
];

/// What the panel hands over when a conversation is saved, with the named parts changed.
const chat = (overrides: Partial<SavedChat> = {}): SavedChat => ({
  title: "Summarise this",
  turns: TURNS,
  profileId: "one",
  filePath: "plan.md",
  attachments: [],
  folder: null,
  ...overrides,
});

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
    saveChat: vi.fn(async ({ id, title, turns, profileId, filePath, attachments, folder }) => {
      next += 1;
      const chatId = id ?? `chat-${next}`;
      saved.set(chatId, {
        schemaVersion: 6,
        id: chatId,
        title,
        createdAt: "2026-09-03T10:00:00.000Z",
        updatedAt: `2026-09-03T10:0${next}:00.000Z`,
        workspaceRoot: "D:/Notes",
        filePath,
        profileId,
        turns,
        attachments,
        folder,
      });
      return { ok: true as const, id: chatId, title };
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
      await result.current.save(chat());
    });

    expect(result.current.chats.map((chat) => chat.title)).toEqual(["Summarise this"]);
  });

  // Saving twice must replace, or every save would leave another copy in the list.
  it("replaces the open chat rather than saving a second copy", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(chat());
    });
    await act(async () => {
      await result.current.save(chat({ turns: [...TURNS, { role: "user", content: "More" }] }));
    });

    expect(result.current.chats).toHaveLength(1);
  });

  it("remembers which chat is open, so a later save updates it", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(chat());
    });

    expect(result.current.openId).not.toBeNull();
  });

  it("saves nothing for an empty conversation", async () => {
    const { bridge, saved } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(chat({ turns: [] }));
    });

    expect(saved.size).toBe(0);
  });

  // The whole conversation goes to the shell: the name given, and what it was held with.
  it("saves under the name given, with the attachments' text and the folder's path", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);
    const attachments = [{ path: "Notes/a.md", content: "# A" }];

    let outcome: Awaited<ReturnType<typeof result.current.save>> | null = null;
    await act(async () => {
      outcome = await result.current.save(chat({ title: "Plan review", attachments, folder: "Notes/docs" }));
    });

    expect(outcome).toMatchObject({ ok: true, title: "Plan review" });
    expect(bridge.saveChat).toHaveBeenCalledWith({
      id: null,
      title: "Plan review",
      turns: TURNS,
      profileId: "one",
      filePath: "plan.md",
      attachments,
      folder: "Notes/docs",
    });
    expect(result.current.chats.map((saved) => saved.title)).toEqual(["Plan review"]);
  });

  it("opens a saved chat", async () => {
    const { bridge } = fakeBridge();
    const { result } = history(bridge);

    await act(async () => {
      await result.current.save(chat());
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
      await result.current.save(chat());
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
      await result.current.save(chat());
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
      await result.current.save(chat({ filePath: "a.md" }));
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
      await result.current.save(chat());
    });
    act(() => result.current.forget());

    expect(result.current.openId).toBeNull();
  });

  // The browser preview, where there is no shell to save into.
  it("does nothing at all without a shell", async () => {
    const { result } = history(null);

    await act(async () => {
      await result.current.save(chat());
      await result.current.remove("anything");
    });

    expect(result.current.chats).toEqual([]);
  });
});
