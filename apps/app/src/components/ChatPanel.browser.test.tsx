import { render, screen } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { describe, expect, it, vi } from "vitest";
import { ChatProfileSchema, type ChatSessionSummary } from "@trypthos/domain";
import ChatPanel from "./ChatPanel";

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

function panel() {
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
    />,
  );
}

/// Whether the browser would paint it. Not a measured height: Chromium hides a closed `details`
/// element's contents with `content-visibility: hidden`, which still lays them out, so a box inside
/// a closed block has a real size while being out of sight.
const shown = (element: Element) => element.checkVisibility();

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
