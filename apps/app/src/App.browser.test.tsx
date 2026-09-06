import { render, screen, waitFor } from "@testing-library/react";
import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@trypthos/domain";
import App from "./App";
import { browserClient } from "./lib/workspaceClient";

/// The chat thread, scrolled for real.
///
/// Everything else about the panel is a rule over data and belongs in the jsdom suite. This is not:
/// where a thread sits while a reply streams into it is a question about boxes, and jsdom answers
/// zero to every measurement it is asked - a scroll assertion there would be asserting the polyfill.

const PROFILE = {
  id: "one",
  label: "Local model",
  endpoint: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  contextWindow: null,
  supportsImages: false,
  supportsTools: false,
  thinking: false,
  reasoningEffort: "medium" as const,
  isDefault: true,
};

const END = "THE VERY LAST LINE OF THE ANSWER";

/// A reply several screens long, written the way a model writes prose.
const LONG = `${Array.from(
  { length: 40 },
  (_, n) => `Paragraph ${n + 1}. The quick brown fox jumps over the lazy dog, at length.`,
).join("\n\n")}\n\n${END}`;

type Listener = (message: { streamId: string; event: unknown }) => void;

function fakeShell(): { push: (event: unknown) => void } {
  const listeners: Listener[] = [];
  const streamId = "stream-1";

  window.trypthos = {
    ...browserClient,
    isDesktop: true,
    readSettings: async () => ({
      ok: true as const,
      settings: { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, profiles: [PROFILE] } },
    }),
    writeSettings: async () => {},
    sendChat: async () => ({ ok: true as const, streamId }),
    cancelChat: async () => {},
    onChatEvent: (listener: Listener) => {
      listeners.push(listener);
      return () => {};
    },
    onWindowState: () => () => {},
    onCloseRequested: () => () => {},
    onMenuAction: () => () => {},
    setDocumentDirty: async () => {},
  } as unknown as typeof window.trypthos;

  return {
    push: (event: unknown) => {
      for (const listener of listeners) listener({ streamId, event });
    },
  };
}

afterEach(() => {
  delete window.trypthos;
});

const thread = () => document.querySelector("[data-testid='chat-thread']") as HTMLElement;
const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

/// React commits the last of a burst of events after the assertion that waited for its text has
/// already passed, and the effect that moves the thread runs with it. Everything here measures where
/// the thread ENDED UP, so it has to be read after that has happened.
const settled = () => new Promise((resolve) => setTimeout(resolve, 200));

async function open() {
  // A desktop window. The suite's default viewport is 414 wide, at which `resolvePanelWidths` gives
  // the chat panel nothing at all, and every measurement here would be of a panel zero across.
  await page.viewport(1280, 860);
  const shell = fakeShell();

  // A container filling the viewport, because that is what #root is in the real app. Testing
  // library's own container is an unsized div, in which every panel measures zero.
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0";
  document.body.append(container);
  render(<App />, { container });

  return shell;
}

async function ask(shell: { push: (event: unknown) => void }, question: string) {
  const box = await screen.findByRole("textbox", { name: "Message" });
  // Set through the DOM rather than with userEvent: what this needs is the send click, and a real
  // pointer click is not reliably actionable inside the fixed container.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(box, question);
  box.dispatchEvent(new Event("input", { bubbles: true }));

  (screen.getByRole("button", { name: "Send" }) as HTMLElement).click();
  // The stream id is only recorded once `sendChat` resolves, and an event carrying an id the hook
  // does not yet know is dropped. Waiting for "Thinking..." is waiting for that.
  await waitFor(() => expect(screen.getByText("Thinking...")).toBeDefined());
}

/// The reply in chunks, as it actually arrives - each one a render, and a chance to move the thread.
function stream(shell: { push: (event: unknown) => void }, text: string) {
  for (const chunk of text.match(/[\s\S]{1,60}/g) ?? []) {
    shell.push({ type: "token", text: chunk });
  }
}

/// Scrolls the thread as a person would, and tells the panel about it.
///
/// The event matters: the panel decides whether to keep following the answer from where the thread
/// actually is, and it only learns that from a scroll.
function scrollTo(top: number) {
  thread().scrollTop = top;
  thread().dispatchEvent(new Event("scroll", { bubbles: false }));
}

describe("a long reply", () => {
  it("follows the answer down as it arrives", async () => {
    const shell = await open();
    await ask(shell, "Explain this");

    stream(shell, LONG);
    shell.push({ type: "end" });
    await waitFor(() => expect(screen.getByText(new RegExp(END))).toBeDefined());
    await settled();

    expect(distanceFromBottom(thread())).toBeLessThanOrEqual(2);
  });

  // The reason this file exists. A thread that jumps to the newest token every time one arrives is a
  // thread you cannot read while it is being written: the answer is all there, and the part you were
  // looking at is snatched away several times a second.
  it("stays where the user put it when they scroll up mid-reply", async () => {
    const shell = await open();
    await ask(shell, "Explain this");

    stream(shell, LONG);
    await waitFor(() => expect(thread().scrollHeight).toBeGreaterThan(thread().clientHeight * 2));
    await settled();

    // Back to the top, as somebody re-reading the beginning of an answer would.
    scrollTo(0);

    stream(shell, "\n\nAnd a good deal more text arriving after they scrolled away.");
    shell.push({ type: "end" });
    await settled();

    expect(thread().scrollTop).toBe(0);
  });

  // Asking is not reading. Somebody who scrolled up and then typed a question wants to see the
  // answer to it, so a question of their own puts the thread back at the bottom.
  it("goes back to the bottom when the user asks something new", async () => {
    const shell = await open();
    await ask(shell, "Explain this");

    stream(shell, LONG);
    shell.push({ type: "end" });
    await waitFor(() => expect(screen.getByText(new RegExp(END))).toBeDefined());
    await settled();

    scrollTo(0);
    await ask(shell, "And another thing");
    await settled();

    expect(distanceFromBottom(thread())).toBeLessThanOrEqual(2);
  });

  // A guard on the shape of the panel rather than on its behaviour: a thread whose scroll range
  // stops short of its own text, or a panel whose bottom is off the screen, would both look to a
  // user exactly like a scrollbar that will not reach the end of the answer.
  it("can be scrolled to its last line, inside a panel that fits the window", async () => {
    const shell = await open();
    await ask(shell, "Explain this");

    stream(shell, LONG);
    shell.push({ type: "end" });
    await waitFor(() => expect(screen.getByText(new RegExp(END))).toBeDefined());
    await settled();

    const box = thread();
    box.scrollTop = box.scrollHeight;

    expect(screen.getByText(new RegExp(END)).getBoundingClientRect().bottom).toBeLessThanOrEqual(
      box.getBoundingClientRect().bottom + 1,
    );
    expect((box.closest("aside") as HTMLElement).getBoundingClientRect().bottom).toBeLessThanOrEqual(
      window.innerHeight + 1,
    );
  });
});
