import { render, screen } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { describe, expect, it, vi } from "vitest";
import { ChatProfileSchema, type ChatSessionSummary } from "@trypthos/domain";
import ChatPanel from "./ChatPanel";
import { noteReplyEvent, startReplyStats } from "../lib/replyStats";

/// The tool-call block under a reply, in a real browser.
///
/// The only place "folded away" can be asked. jsdom renders a closed `details` element's contents
/// into the tree like any other element and has no layout to hide them with, so a test there can
/// say the block is closed but not that the calls inside it are out of sight.

const model = ChatProfileSchema.parse({
  id: "one",
  label: "Local model",
  endpoint: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  isDefault: true,
});

function panel(extra: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  render(
    <ChatPanel
      width={348}
      onCollapse={vi.fn()}
      models={[model]}
      selectedId="one"
      onSelectModel={vi.fn()}
      turns={[
        { role: "user", content: "What is in there?" },
        {
          role: "assistant",
          content: "Here is what I found.",
          tools: [
            { name: "list_directory", detail: "notes" },
            { name: "get_file_contents", detail: "notes/plan.md" },
          ],
        },
      ]}
      fileTypes={["markdown"]}
      streaming={false}
      error={null}
      activity={null}
      context={{ tokens: 0, limit: null }}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onClear={vi.fn()}
      onConfigure={vi.fn()}
      resolveEdit={() => ({ ok: false, reason: "no-document" }) as never}
      onApplyEdit={vi.fn(() => true)}
      chats={[] as ChatSessionSummary[]}
      openChatId={null}
      missingFile={null}
      onSaveChat={vi.fn()}
      scope={{
        attachments: [],
        files: [],
        includeFolder: false,
        folderPath: "",
        canUseFolder: true,
        onToggleFolder: vi.fn(),
        onNeedFiles: vi.fn(),
        onAttach: vi.fn(),
        onDetach: vi.fn(),
      }}
      onOpenChat={vi.fn()}
      onDeleteChat={vi.fn()}
      {...extra}
    />,
  );
}

/// Whether the browser would paint it. Not a measured height: Chromium hides a closed `details`
/// element's contents with `content-visibility: hidden`, which still lays them out, so a box inside
/// a closed block has a real size while being out of sight.
const shown = (element: Element) => element.checkVisibility();

/// The question box, measured. Only a browser can say how tall a textarea is.
describe("the message box, rendered", () => {
  const box = () => screen.getByLabelText<HTMLTextAreaElement>("Message");
  const height = () => box().getBoundingClientRect().height;

  it("starts two lines tall, and grows with what is typed", async () => {
    panel();
    const empty = height();

    await userEvent.fill(box(), "one\ntwo\nthree\nfour\nfive");
    const five = height();
    expect(five).toBeGreaterThan(empty + 20);
    // Grown to fit: nothing typed is scrolled out of sight.
    expect(box().scrollHeight).toBeLessThanOrEqual(box().clientHeight + 1);

    await userEvent.fill(box(), "one");
    expect(height()).toBe(empty);
  });

  // A long paste must not push the conversation off the panel. Past a limit the box stops growing
  // and scrolls instead.
  it("stops growing at a limit and scrolls past it", async () => {
    panel();

    await userEvent.fill(box(), Array.from({ length: 60 }, (_, n) => `line ${n}`).join("\n"));
    const tall = height();
    expect(box().scrollHeight).toBeGreaterThan(box().clientHeight);

    await userEvent.fill(box(), Array.from({ length: 120 }, (_, n) => `line ${n}`).join("\n"));
    expect(height()).toBe(tall);
  });
});

describe("the tool calls a reply made, rendered", () => {
  it("shows only the summary until it is opened", async () => {
    panel();

    const summary = screen.getByText("Tool calls (2)");
    const call = screen.getByText("notes/plan.md", { exact: false });
    expect(shown(summary)).toBe(true);
    expect(shown(call)).toBe(false);

    await userEvent.click(summary);
    expect(shown(call)).toBe(true);
  });
});

/// The statistics popover opens inside a panel that clips what overflows it, so where it lands is a
/// question only layout can answer - a box drawn half outside the panel is half a box.
describe("the chat statistics, rendered", () => {
  it("opens wholly inside the panel", async () => {
    const stats = noteReplyEvent(
      noteReplyEvent(startReplyStats({ profileId: "one", at: 0 }), { type: "token", text: "Hi" }, 300),
      { type: "end" },
      900,
    );
    panel({ replyStats: [stats] });

    await userEvent.click(screen.getByRole("button", { name: "Chat statistics" }));

    const aside = screen.getByRole("complementary").getBoundingClientRect();
    const box = screen.getByRole("dialog", { name: "Chat statistics" }).getBoundingClientRect();
    expect(box.width).toBeGreaterThan(200);
    expect(box.left).toBeGreaterThanOrEqual(aside.left);
    expect(box.right).toBeLessThanOrEqual(aside.right);
  });
});

/// The saved-conversations list opens inside the same clipping panel, from a button further in still.
describe("the saved conversations list, rendered", () => {
  it("opens wholly inside the panel", async () => {
    panel({
      chats: [
        {
          id: "3f1a1a2e-0000-4000-8000-000000000001",
          title: "Planning the garden with Ada",
          updatedAt: "2026-09-16T10:00:00.000Z",
          filePath: "notes/garden.md",
        },
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Saved conversations" }));

    const aside = screen.getByRole("complementary").getBoundingClientRect();
    const list = screen.getByText("Planning the garden with Ada").closest(".absolute");
    expect(list).not.toBeNull();
    const box = list!.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(200);
    expect(box.left).toBeGreaterThanOrEqual(aside.left);
    expect(box.right).toBeLessThanOrEqual(aside.right);
  });
});
