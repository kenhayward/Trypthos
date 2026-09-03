import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatContext, ChatEvent } from "@trypthos/domain";
import { useChat, type ChatBridge } from "./useChat";

/// A shell that hands back a stream id and lets a test push events into it.
function fakeBridge({ ok = true }: { ok?: boolean } = {}) {
  let listener: ((message: { streamId: string; event: ChatEvent }) => void) | null = null;
  const sent: { profileId: string; turns: unknown[]; context: unknown }[] = [];
  const cancelled: string[] = [];
  let next = 0;

  const bridge: ChatBridge = {
    sendChat: vi.fn(async (profileId: string, turns: never[], context: never) => {
      sent.push({ profileId, turns, context });
      next += 1;
      return ok
        ? { ok: true as const, streamId: `stream-${next}` }
        : { ok: false as const, reason: "no-such-profile" };
    }),
    cancelChat: vi.fn(async (streamId: string) => {
      cancelled.push(streamId);
    }),
    onChatEvent: (handler) => {
      listener = handler;
      return () => {
        listener = null;
      };
    },
  };

  return {
    bridge,
    sent,
    cancelled,
    push: (event: ChatEvent, streamId = `stream-${next}`) => listener?.({ streamId, event }),
    get listening() {
      return listener !== null;
    },
  };
}

const chat = (bridge: ChatBridge | null, profileId: string | null = "one") =>
  renderHook(() => useChat(bridge, profileId));

describe("useChat", () => {
  it("shows the question straight away, with a reply waiting to fill", async () => {
    const { bridge } = fakeBridge();
    const { result } = chat(bridge);

    await act(async () => {
      await result.current.send("Hello");
    });

    expect(result.current.turns).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
    ]);
    expect(result.current.streaming).toBe(true);
  });

  it("renders tokens as they arrive", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("Hello");
    });
    act(() => {
      harness.push({ type: "token", text: "Hel" });
      harness.push({ type: "token", text: "lo" });
    });

    expect(result.current.turns.at(-1)?.content).toBe("Hello");
  });

  it("stops streaming when the turn ends", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("Hello");
    });
    act(() => harness.push({ type: "end" }));

    expect(result.current.streaming).toBe(false);
  });

  it("sends the whole conversation, so the model has the history", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("First");
    });
    act(() => {
      harness.push({ type: "token", text: "An answer" });
      harness.push({ type: "end" });
    });
    await act(async () => {
      await result.current.send("Second");
    });

    expect(harness.sent[1]?.turns).toEqual([
      { role: "user", content: "First" },
      { role: "assistant", content: "An answer" },
      { role: "user", content: "Second" },
    ]);
  });

  // The reason every event carries a stream id. Without this check, a reply the user stopped would
  // keep appending itself to whatever they typed next.
  it("ignores events from a stream it is no longer showing", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("Hello");
    });
    act(() => harness.push({ type: "token", text: "stray" }, "an-older-stream"));

    expect(result.current.turns.at(-1)?.content).toBe("");
  });

  it("shows an error where the answer would have been", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("Hello");
    });
    act(() => {
      harness.push({ type: "error", message: "The endpoint rejected the API key." });
      harness.push({ type: "end" });
    });

    expect(result.current.error).toBe("The endpoint rejected the API key.");
    expect(result.current.streaming).toBe(false);
  });

  // Tokens already on screen are the model's actual words. Replacing them with the error would
  // discard a partial answer that may well be worth reading.
  it("keeps a partial reply when the stream fails part-way", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("Hello");
    });
    act(() => {
      harness.push({ type: "token", text: "Half an answer" });
      harness.push({ type: "error", message: "The reply stopped part-way through." });
      harness.push({ type: "end" });
    });

    expect(result.current.turns.at(-1)?.content).toBe("Half an answer");
    expect(result.current.error).toBe("The reply stopped part-way through.");
  });

  it("reports a request the shell refused", async () => {
    const { bridge } = fakeBridge({ ok: false });
    const { result } = chat(bridge);

    await act(async () => {
      await result.current.send("Hello");
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it("stops a reply on request", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("Hello");
    });
    await act(async () => {
      await result.current.stop();
    });

    expect(harness.cancelled).toEqual(["stream-1"]);
  });

  it("sends nothing for an empty or blank message", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("   ");
    });

    expect(harness.sent).toEqual([]);
    expect(result.current.turns).toEqual([]);
  });

  it("will not start a second reply while one is arriving", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("First");
    });
    await act(async () => {
      await result.current.send("Second");
    });

    expect(harness.sent).toHaveLength(1);
  });

  // Retry drops the answer it did not like and asks the same question again, rather than making the
  // user retype it.
  it("retries the last question without repeating it in the thread", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("Hello");
    });
    act(() => {
      harness.push({ type: "token", text: "A poor answer" });
      harness.push({ type: "end" });
    });
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.turns).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
    ]);
    expect(harness.sent[1]?.turns).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("clears the thread", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge);

    await act(async () => {
      await result.current.send("Hello");
    });
    act(() => harness.push({ type: "end" }));
    act(() => result.current.clear());

    expect(result.current.turns).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // No model configured. The panel says so rather than the send button silently doing nothing.
  it("refuses to send with no model chosen", async () => {
    const harness = fakeBridge();
    const { result } = chat(harness.bridge, null);

    await act(async () => {
      await result.current.send("Hello");
    });

    expect(harness.sent).toEqual([]);
  });

  it("stops listening when it goes away, so a late reply reaches nothing", async () => {
    const harness = fakeBridge();
    const { unmount } = chat(harness.bridge);

    await waitFor(() => expect(harness.listening).toBe(true));
    unmount();

    expect(harness.listening).toBe(false);
  });

  // The browser preview, where there is no shell to ask.
  it("does nothing at all without a shell", async () => {
    const { result } = chat(null);

    await act(async () => {
      await result.current.send("Hello");
    });

    expect(result.current.turns).toEqual([]);
    expect(result.current.streaming).toBe(false);
  });
});

/// The document the question is about.
///
/// Read at the moment a turn is sent, not when the hook was created: somebody selects a passage,
/// types a question, and may well change the selection before pressing Enter.
describe("useChat and the document", () => {
  const FILE = { kind: "file" as const, path: "notes.md", text: "# Notes", truncated: false };

  it("sends the context alongside the question", async () => {
    const harness = fakeBridge();
    const { result } = renderHook(() => useChat(harness.bridge, "one", () => FILE));

    await act(async () => {
      await result.current.send("Summarise this");
    });

    expect(harness.sent[0]?.context).toEqual(FILE);
  });

  it("asks for the context afresh on every turn, not once", async () => {
    const harness = fakeBridge();
    let current: ChatContext = FILE;
    const { result } = renderHook(() => useChat(harness.bridge, "one", () => current));

    await act(async () => {
      await result.current.send("First");
    });
    act(() => harness.push({ type: "end" }));

    current = { kind: "selection", path: "notes.md", text: "One line", truncated: false };
    await act(async () => {
      await result.current.send("Second");
    });

    expect(harness.sent[1]?.context).toEqual(current);
  });

  // A retry can happen minutes later. The document as it stands now is the one the user means.
  it("re-reads the context when a question is retried", async () => {
    const harness = fakeBridge();
    let current: ChatContext = FILE;
    const { result } = renderHook(() => useChat(harness.bridge, "one", () => current));

    await act(async () => {
      await result.current.send("Summarise this");
    });
    act(() => harness.push({ type: "end" }));

    current = { ...FILE, text: "# Notes\n\nEdited since." };
    await act(async () => {
      await result.current.retry();
    });

    expect(harness.sent[1]?.context).toEqual(current);
  });

  it("sends no context when there is nothing to send", async () => {
    const harness = fakeBridge();
    const { result } = renderHook(() => useChat(harness.bridge, "one"));

    await act(async () => {
      await result.current.send("Hello");
    });

    expect(harness.sent[0]?.context).toEqual({ kind: "none" });
  });
});
