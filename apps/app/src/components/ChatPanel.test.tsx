import { fireEvent, render, screen, within } from "@testing-library/react";
import { TREE_FILE_TYPE } from "../lib/treeDrag";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatProfileSchema, type ChatEvent, type ChatSessionSummary } from "@trypthos/domain";
import { noteReplyEvent, startReplyStats, type ReplyStats } from "../lib/replyStats";
import ChatPanel from "./ChatPanel";

/// The panel is presentation. The conversation and the stream live in `useChat`, so what is asserted
/// here is what a person sees and can press - not what a reply does as it arrives.

const model = ChatProfileSchema.parse({
  id: "one",
  label: "Local model",
  endpoint: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  isDefault: true,
});

function panel(overrides: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  const props = {
    width: 348,
    onCollapse: vi.fn(),
    models: [model],
    selectedId: "one",
    onSelectModel: vi.fn(),
    turns: [],
    fileTypes: ["markdown"] as readonly string[],
    streaming: false,
    error: null,
    activity: null,
    onSend: vi.fn(),
    onStop: vi.fn(),
    onClear: vi.fn(),
    onConfigure: vi.fn(),
    resolveEdit: () => ({ ok: true as const, from: 0, to: 0, insert: "" }),
    onApplyEdit: vi.fn(() => true),
    chats: [] as ChatSessionSummary[],
    openChatId: null,
    missingFile: null,
    onSaveChat: vi.fn(),
    onOpenChat: vi.fn(),
    onDeleteChat: vi.fn(),
    context: { tokens: 0, limit: null as number | null },
    scope: {
      attachments: [] as string[],
      files: [] as string[],
      includeFolder: false,
      folderPath: "",
      canUseFolder: true,
      onToggleFolder: vi.fn(),
      onNeedFiles: vi.fn(),
      onAttach: vi.fn(),
      onDetach: vi.fn(),
    },
    ...overrides,
  };
  render(<ChatPanel {...props} />);
  return props;
}

describe("ChatPanel", () => {
  it("invites a first question when the thread is empty", () => {
    panel();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDefined();
  });

  // The dial belongs with the rest of what is being sent, and it counts what is typed as well as
  // what is already there - the question you are about to ask is part of the request.
  it("shows how full the context is, including what is typed but not sent", async () => {
    const user = userEvent.setup();
    panel({ context: { tokens: 1000, limit: 8000 } });

    expect(screen.getByRole("img", { name: /About 1,000 of 8,000/ })).toBeDefined();

    // Forty characters, not four hundred: userEvent types one key at a time and re-renders the
    // panel on each, and the assertion is about the count moving, not about how far.
    await user.type(screen.getByRole("textbox", { name: "Message" }), "a".repeat(40));
    expect(screen.getByRole("img", { name: /About 1,010 of 8,000/ })).toBeDefined();
  });

  // Nothing to be a fraction of, so the ring stays empty and the hover says what is missing rather
  // than inventing a window.
  it("shows the count alone when the model's window is unknown", () => {
    panel({ context: { tokens: 1000, limit: null } });

    expect(screen.getByRole("img", { name: /About 1,000 tokens/ })).toBeDefined();
  });

  // A question is prose, and the shell's right-click menu can only offer a correction for a word
  // the spellchecker flagged. Said out loud rather than left to the browser's default, so a later
  // `spellcheck="false"` copied in from a form field is a visible change.
  it("spellchecks what you are typing", () => {
    panel();
    expect(
      screen.getByRole("textbox", { name: "Message" }).getAttribute("spellcheck"),
    ).toBe("true");
  });

  it("shows both sides of the conversation", () => {
    panel({
      turns: [
        { role: "user", content: "What is this file about?" },
        { role: "assistant", content: "It is a list of notes." },
      ],
    });

    expect(screen.getByText("What is this file about?")).toBeDefined();
    expect(screen.getByText("It is a list of notes.")).toBeDefined();
  });

  it("renders a reply as markdown", () => {
    panel({ turns: [{ role: "assistant", content: "Some **bold** text" }] });
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  // A model's output is text the app did not write, and is treated as data for exactly the reason a
  // file from the workspace is. renderMarkdown sanitises; this is the test that says so out loud.
  it("does not execute markup a model produced", () => {
    panel({
      turns: [{ role: "assistant", content: "<img src=x onerror=\"window.pwned = true\">" }],
    });

    expect(document.querySelector("img")?.getAttribute("onerror")).toBeNull();
  });

  // Without this the panel shows an empty bubble, which reads as an answer of nothing rather than as
  // an answer on its way.
  it("says it is thinking while nothing has arrived", () => {
    panel({
      turns: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "" },
      ],
      streaming: true,
    });

    expect(screen.getByText("Thinking...")).toBeDefined();
  });

  it("stops saying it is thinking once a token lands", () => {
    panel({
      turns: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hel" },
      ],
      streaming: true,
    });

    expect(screen.queryByText("Thinking...")).toBeNull();
    expect(screen.getByText("Hel")).toBeDefined();
  });

  it("sends what was typed", async () => {
    const user = userEvent.setup();
    const props = panel();

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(props.onSend).toHaveBeenCalledWith("Hello");
  });

  it("sends on Enter, and leaves the box empty afterwards", async () => {
    const user = userEvent.setup();
    const props = panel();
    const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;

    await user.type(box, "Hello{Enter}");

    expect(props.onSend).toHaveBeenCalledWith("Hello");
    expect(box.value).toBe("");
  });

  // Asking a question of several lines is normal, and Enter alone is the wrong key to lose it on.
  it("makes a newline on Shift+Enter rather than sending", async () => {
    const user = userEvent.setup();
    const props = panel();
    const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;

    await user.type(box, "First{Shift>}{Enter}{/Shift}Second");

    expect(props.onSend).not.toHaveBeenCalled();
    expect(box.value).toBe("First\nSecond");
  });

  it("will not send an empty message", async () => {
    const user = userEvent.setup();
    const props = panel();

    await user.type(screen.getByRole("textbox", { name: "Message" }), "   ");
    await user.keyboard("{Enter}");

    expect(props.onSend).not.toHaveBeenCalled();
  });

  // Same place, same shape. An endpoint that accepts a request and then never streams otherwise
  // leaves a panel that looks broken with no way out of it.
  it("turns the send button into a stop button while a reply arrives", async () => {
    const user = userEvent.setup();
    const props = panel({ streaming: true });

    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(props.onStop).toHaveBeenCalledOnce();
  });

  it("shows an error without hiding the reply beside it", () => {
    panel({
      turns: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Half an answer" },
      ],
      error: "The reply stopped part-way through.",
    });

    expect(screen.getByRole("alert").textContent).toContain("stopped part-way");
    expect(screen.getByText("Half an answer")).toBeDefined();
  });

  it("clears the thread", async () => {
    const user = userEvent.setup();
    const props = panel({ turns: [{ role: "user", content: "Hello" }] });

    await user.click(screen.getByRole("button", { name: "Clear the conversation" }));
    expect(props.onClear).toHaveBeenCalledOnce();
  });

  it("has nothing to clear in an empty thread", () => {
    panel();
    expect(
      screen.getByRole("button", { name: "Clear the conversation" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("collapses", async () => {
    const user = userEvent.setup();
    const props = panel();

    await user.click(screen.getByRole("button", { name: "Hide the chat panel" }));
    expect(props.onCollapse).toHaveBeenCalledOnce();
  });
});

/// With nothing configured, the panel's job is to say so and offer the way out. A send button that
/// silently does nothing is the failure this replaces.
describe("ChatPanel with no model configured", () => {
  it("says so, rather than offering an input that cannot work", () => {
    panel({ models: [], selectedId: null });

    expect(screen.getByText(/No chat model is configured/)).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Message" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  });

  it("offers the way to fix it", async () => {
    const user = userEvent.setup();
    const props = panel({ models: [], selectedId: null });

    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(props.onConfigure).toHaveBeenCalledOnce();
  });
});

describe("ChatModelPicker", () => {
  const second = ChatProfileSchema.parse({
    id: "two",
    label: "Cloud model",
    endpoint: "https://api.example.com/v1",
    model: "some-model",
  });

  it("shows the chosen model by its label, not its slug", () => {
    panel({ models: [model, second], selectedId: "one" });
    expect(screen.getByRole("button", { name: "Choose the model" }).textContent).toContain(
      "Local model",
    );
  });

  it("lists the configured models, with the slug as secondary text", async () => {
    const user = userEvent.setup();
    panel({ models: [model, second] });

    await user.click(screen.getByRole("button", { name: "Choose the model" }));

    expect(screen.getByRole("menuitemradio", { name: /Cloud model/ })).toBeDefined();
    expect(screen.getByText("qwen2.5-coder")).toBeDefined();
  });

  it("chooses a model", async () => {
    const user = userEvent.setup();
    const props = panel({ models: [model, second] });

    await user.click(screen.getByRole("button", { name: "Choose the model" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Cloud model/ }));

    expect(props.onSelectModel).toHaveBeenCalledWith("two");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    panel({ models: [model, second] });

    await user.click(screen.getByRole("button", { name: "Choose the model" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
  });

  // Switching mid-reply would change the model behind an answer already arriving, and the turn is in
  // flight with the old one either way.
  it("cannot be changed while a reply is streaming", () => {
    panel({ models: [model, second], streaming: true });
    expect(screen.getByRole("button", { name: "Choose the model" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  // A model can be removed from Settings between one turn and the next, so a remembered id may
  // name a model that is no longer configured.
  it("falls back to the default when the remembered model has gone", () => {
    panel({ models: [second], selectedId: "deleted-model" });
    expect(screen.getByRole("button", { name: "Choose the model" }).textContent).toContain(
      "Cloud model",
    );
  });
});

/// Proposed edits.
///
/// The panel never writes to the document itself: it renders the proposal and calls back. What is
/// asserted here is that a person can see what would happen and has to ask for it.
describe("ChatPanel: proposed edits", () => {
  const reply = [
    "Here is a summary.",
    "",
    '```trypthos-edit insert-before heading="Objectives"',
    "## Summary",
    "",
    "An overview.",
    "```",
  ].join("\n");

  const withEdit = (overrides: Partial<React.ComponentProps<typeof ChatPanel>> = {}) =>
    panel({ turns: [{ role: "assistant", content: reply }], ...overrides });

  it("shows the prose and the proposal separately", () => {
    withEdit();
    expect(screen.getByText("Here is a summary.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDefined();
  });

  it("says where the change would go", () => {
    withEdit();
    expect(screen.getByText(/Insert before "Objectives"/)).toBeDefined();
  });

  // Source, not rendered: what matters is exactly what would be written into the file, and rendering
  // it would hide the very markers that are the point.
  it("shows the proposed markdown as source", () => {
    withEdit();
    expect(screen.getByText(/## Summary/)).toBeDefined();
  });

  // The security property, not a courtesy. The document is in the model's context, so an edit that
  // applied itself would make "treat file contents as data" unenforceable.
  it("writes nothing until the button is pressed", () => {
    const props = withEdit();
    expect(props.onApplyEdit).not.toHaveBeenCalled();
  });

  it("applies the edit on request", async () => {
    const user = userEvent.setup();
    const props = withEdit();

    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(props.onApplyEdit).toHaveBeenCalledWith({
      op: "insert-before",
      heading: "Objectives",
      content: "## Summary\n\nAn overview.",
    });
  });

  it("cannot be applied twice", async () => {
    const user = userEvent.setup();
    withEdit();

    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.getByText("Applied")).toBeDefined();
  });

  it("stays offered when the apply did not land", async () => {
    const user = userEvent.setup();
    withEdit({ onApplyEdit: vi.fn(() => false) });

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("button", { name: "Apply" })).toBeDefined();
  });

  // Disabled and explained, never disabled and silent: the user has to know whether to rename a
  // heading back, re-select a passage, or just copy the text by hand.
  it("explains why an edit cannot be placed, instead of offering it", () => {
    withEdit({ resolveEdit: () => ({ ok: false, reason: "heading-not-found" }) });

    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.getByText(/no longer in the document/)).toBeDefined();
  });

  it("names the ambiguous case rather than picking one", () => {
    withEdit({ resolveEdit: () => ({ ok: false, reason: "heading-ambiguous" }) });
    expect(screen.getByText(/More than one heading/)).toBeDefined();
  });

  // The block is the model's own output, so it can contain anything. It is shown as text, never
  // rendered as markup.
  it("does not execute markup inside a proposal", () => {
    panel({
      turns: [
        {
          role: "assistant",
          content: '```trypthos-edit append\n<img src=x onerror="window.pwned = true">\n```',
        },
      ],
    });

    expect(document.querySelector("img")).toBeNull();
  });

  // A model that gets the format wrong costs a copy and paste, never the answer.
  it("leaves a block it cannot understand as readable text", () => {
    panel({
      turns: [{ role: "assistant", content: "```trypthos-edit nonsense\n## Summary\n```" }],
    });

    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.getByText(/## Summary/)).toBeDefined();
  });

  it("forgets what was applied when the thread is cleared", async () => {
    const user = userEvent.setup();
    withEdit();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByText("Applied")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Clear the conversation" }));
    // The turns are a prop, so the thread itself does not empty here - but the applied marks must,
    // or a new conversation would inherit them by position.
    expect(screen.getByRole("button", { name: "Apply" })).toBeDefined();
  });
});

/// A turn that finished having produced nothing.
///
/// Reasoning models do this: they think, then stop. The panel used to render an empty bubble - no
/// text, no error, no indication anything had happened.
describe("ChatPanel: a reply with no answer", () => {
  const empty = [
    { role: "user" as const, content: "Summarise this" },
    { role: "assistant" as const, content: "" },
  ];

  /// The same reply, having thought before it stopped. Reasoning travels on the turn now, so it is
  /// part of the reply rather than a prop beside it.
  const thinkingReply = (reasoning: string) => [
    empty[0]!,
    { ...empty[1]!, reasoning },
  ];

  it("says the model wrote nothing, rather than showing an empty bubble", () => {
    panel({ turns: empty, streaming: false });
    expect(screen.getByText(/finished without writing an answer/)).toBeDefined();
  });

  it("offers the model's thinking when there is some", () => {
    panel({ turns: thinkingReply("Working out the summary."), streaming: false });
    expect(screen.getByText("Show what the model was thinking")).toBeDefined();
  });

  // Folded away, because it is not the answer and is often long. Asserted on the disclosure's own
  // state rather than on whether the text is in the DOM: jsdom keeps a closed <details> element's
  // children mounted, so a presence check would pass whether it was folded or not.
  it("keeps the thinking behind a disclosure rather than in the thread", async () => {
    const user = userEvent.setup();
    panel({ turns: thinkingReply("Working out the summary."), streaming: false });

    const disclosure = screen.getByText("Show what the model was thinking").closest("details")!;
    expect(disclosure.open).toBe(false);

    await user.click(screen.getByText("Show what the model was thinking"));
    expect(disclosure.open).toBe(true);
    expect(screen.getByText("Working out the summary.")).toBeDefined();
  });

  it("offers nothing to show when the model did not think out loud either", () => {
    panel({ turns: empty, streaming: false });
    expect(screen.queryByText("Show what the model was thinking")).toBeNull();
  });

  // While a reply is still on its way, an empty bubble means "waiting", not "gave up".
  it("still says it is thinking while the reply is on its way", () => {
    panel({ turns: empty, streaming: true });
    expect(screen.getByText("Thinking...")).toBeDefined();
    expect(screen.queryByText(/finished without writing/)).toBeNull();
  });
});

/// A block only becomes a card once the turn is over.
///
/// Half a fenced block can transiently look complete while it streams - especially now that a
/// closing fence appended to a line is accepted - and a card appearing mid-sentence could be applied
/// with truncated content.
describe("ChatPanel: edits while streaming", () => {
  const partial = [
    { role: "user" as const, content: "Summarise this" },
    {
      role: "assistant" as const,
      content: '```trypthos-edit append\nHalf a sentence```',
    },
  ];

  it("shows the reply as text while it is still arriving", () => {
    panel({ turns: partial, streaming: true });
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("offers the card once the turn has finished", () => {
    panel({ turns: partial, streaming: false });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDefined();
  });
});

/// Saved conversations.
describe("ChatPanel: saved conversations", () => {
  const saved: ChatSessionSummary[] = [
    { id: "a", title: "About the plan", updatedAt: "2026-09-03T10:00:00.000Z", filePath: "plan.md" },
    { id: "b", title: "A scratch question", updatedAt: "2026-09-02T10:00:00.000Z", filePath: null },
  ];

  const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Saved conversations" }));
  };

  it("saves the conversation on request", async () => {
    const user = userEvent.setup();
    const props = panel({ turns: [{ role: "user", content: "Hello" }] });

    await user.click(screen.getByRole("button", { name: "Save this conversation" }));
    expect(props.onSaveChat).toHaveBeenCalledOnce();
  });

  it("has nothing to save in an empty thread", () => {
    panel();
    expect(
      screen.getByRole("button", { name: "Save this conversation" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("lists what has been saved, with the file each was about", async () => {
    const user = userEvent.setup();
    panel({ chats: saved });
    await openMenu(user);

    expect(screen.getByText("About the plan")).toBeDefined();
    expect(screen.getByText("plan.md")).toBeDefined();
    // A conversation held with nothing open still needs a second line, or the rows jump about.
    expect(screen.getByText("No file")).toBeDefined();
  });

  it("says so when nothing has been saved yet", async () => {
    const user = userEvent.setup();
    panel({ chats: [] });
    await openMenu(user);

    expect(screen.getByText(/No saved conversations yet/)).toBeDefined();
  });

  it("opens a saved conversation", async () => {
    const user = userEvent.setup();
    const props = panel({ chats: saved });
    await openMenu(user);

    await user.click(screen.getByText("About the plan"));
    expect(props.onOpenChat).toHaveBeenCalledWith("a");
  });

  // Named with the title, so a row of buttons all called "Delete" is not what a screen reader hears.
  it("deletes a saved conversation", async () => {
    const user = userEvent.setup();
    const props = panel({ chats: saved });
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: 'Delete "About the plan"' }));
    expect(props.onDeleteChat).toHaveBeenCalledWith("a");
  });

  it("closes the list on Escape", async () => {
    const user = userEvent.setup();
    panel({ chats: saved });
    await openMenu(user);

    await user.keyboard("{Escape}");
    expect(screen.queryByText("About the plan")).toBeNull();
  });

  // Switching conversations mid-reply would leave a stream writing into somebody else's words.
  it("cannot be opened while a reply is arriving", () => {
    panel({ chats: saved, streaming: true });
    expect(
      screen.getByRole("button", { name: "Saved conversations" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  // The conversation still opens - it is the user's own words - and this says what it was about, so
  // a reply referring to "the document" is not a mystery.
  it("says when the file a conversation was about has gone", () => {
    panel({ turns: [{ role: "user", content: "Hello" }], missingFile: "plan.md" });
    expect(screen.getByText(/plan\.md, which is not in the open folder any more/)).toBeDefined();
  });

  it("says nothing about the file when it is still there", () => {
    panel({ turns: [{ role: "user", content: "Hello" }], missingFile: null });
    expect(screen.queryByText(/not in the open folder/)).toBeNull();
  });

  // The folder is saved as a path, so it can only come back if it is open. The attachments came
  // back with their own text, and the note says so.
  it("says when the folder a conversation used is not open", () => {
    panel({ turns: [{ role: "user", content: "Hello" }], missingFolder: "Notes/docs" });
    expect(
      screen.getByText("This conversation used the folder Notes/docs, which is not open. Its attached files are still here."),
    ).toBeDefined();
  });

  it("names the saved conversation on screen", () => {
    panel({
      turns: [{ role: "user", content: "Hello" }],
      chats: [{ id: "c1", title: "Plan review", updatedAt: "2026-09-15T10:00:00.000Z", filePath: null }],
      openChatId: "c1",
    });
    expect(screen.getByText("Saved as Plan review")).toBeDefined();
  });

  it("names nothing for a conversation that has not been saved", () => {
    panel({ turns: [{ role: "user", content: "Hello" }] });
    expect(screen.queryByText(/^Saved as/)).toBeNull();
  });
});

/// What chat can see, beyond the open document.
///
/// Shown above the composer rather than hidden in a menu, because it changes what an answer is based
/// on: a reply that quietly consulted five files, or quietly did not, is one nobody can judge.
describe("ChatPanel: scope", () => {
  const withScope = (over: Partial<React.ComponentProps<typeof ChatPanel>["scope"]> = {}) =>
    panel({
      scope: {
        attachments: [],
        files: ["notes/plan.md", "notes/risks.md"],
        includeFolder: false,
        folderPath: "",
        canUseFolder: true,
        onToggleFolder: vi.fn(),
        onNeedFiles: vi.fn(),
        onAttach: vi.fn(),
        onDetach: vi.fn(),
        ...over,
      },
    });

  it("offers the folder, off by default", () => {
    withScope();
    expect(screen.getByRole("button", { name: "Folder" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("turns the folder on", async () => {
    const user = userEvent.setup();
    const props = withScope();

    await user.click(screen.getByRole("button", { name: "Folder" }));
    expect(props.scope.onToggleFolder).toHaveBeenCalledWith(true);
  });

  it("shows the folder as on when it is", () => {
    withScope({ includeFolder: true });
    expect(screen.getByRole("button", { name: "Folder" }).getAttribute("aria-pressed")).toBe("true");
  });

  /// The button says what is being SENT, not what is selected somewhere else.
  ///
  /// It used to name the folder either way, so a button that was off still read "Folder: src" - which
  /// says the folder is going with the question when it is not. Naming it only when it is on makes
  /// the label and the pressed state say the same thing.
  it("names the folder only when the folder is actually going", () => {
    withScope({ folderPath: "notes/2026/drafts", includeFolder: true });
    expect(screen.getByRole("button", { name: "Folder: drafts" })).toBeDefined();
  });

  it("does not name a folder it is not sending", () => {
    withScope({ folderPath: "notes/2026/drafts", includeFolder: false });

    expect(screen.getByRole("button", { name: "Folder" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Folder: drafts" })).toBeNull();
  });

  /// The button has room for a name, and a deep folder has more than a name.
  ///
  /// "Folder: docs" is two folders away from telling you which docs. The full path is on hover,
  /// where length costs nothing - the button stays short and the answer is still reachable. It is
  /// there when the button is off too, which is how you find out what turning it on would send.
  it("shows the whole path on hover, not just the folder's name", () => {
    withScope({ folderPath: "notes/2026/drafts", includeFolder: true });

    expect(
      screen.getByRole("button", { name: "Folder: drafts" }).getAttribute("title"),
    ).toContain("notes/2026/drafts");
  });

  it("shows the path on hover even when the folder is not going", () => {
    withScope({ folderPath: "notes/2026/drafts", includeFolder: false });

    expect(screen.getByRole("button", { name: "Folder" }).getAttribute("title")).toContain(
      "notes/2026/drafts",
    );
  });

  // At the root there is no path to show beyond the folder itself, so the hover is the explanation
  // it has always been.
  it("explains what the folder does when it is the workspace root", () => {
    withScope({ folderPath: "" });
    const button = screen.getByRole("button", { name: "Folder" });

    expect(button.getAttribute("title")).toContain("files in the folder");
  });

  // Nothing to include, so nothing to offer.
  it("cannot use the folder when none is open", () => {
    withScope({ canUseFolder: false });
    expect(screen.getByRole("button", { name: "Folder" }).hasAttribute("disabled")).toBe(true);
  });

  // The walk is not free, so it happens when somebody actually wants to pick a file.
  it("asks for the file list only when the picker opens", async () => {
    const user = userEvent.setup();
    const props = withScope();
    expect(props.scope.onNeedFiles).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Attach a file" }));
    expect(props.scope.onNeedFiles).toHaveBeenCalledOnce();
  });

  it("attaches a file from the picker", async () => {
    const user = userEvent.setup();
    const props = withScope();

    await user.click(screen.getByRole("button", { name: "Attach a file" }));
    await user.click(screen.getByRole("button", { name: "notes/risks.md" }));

    expect(props.scope.onAttach).toHaveBeenCalledWith("notes/risks.md");
  });

  it("filters the list, for a folder with more files than fit", async () => {
    const user = userEvent.setup();
    withScope();

    await user.click(screen.getByRole("button", { name: "Attach a file" }));
    await user.type(screen.getByLabelText("Find a file"), "risks");

    expect(screen.queryByRole("button", { name: "notes/plan.md" })).toBeNull();
    expect(screen.getByRole("button", { name: "notes/risks.md" })).toBeDefined();
  });

  // Attaching the same file twice would send it twice and spend the budget on a duplicate.
  it("does not offer a file that is already attached", async () => {
    const user = userEvent.setup();
    withScope({ attachments: ["notes/risks.md"] });

    await user.click(screen.getByRole("button", { name: "Attach a file" }));
    expect(screen.queryByRole("button", { name: "notes/risks.md" })).toBeNull();
  });

  it("lists what is attached, and removes one", async () => {
    const user = userEvent.setup();
    const props = withScope({ attachments: ["Notes/research/risks.md"] });

    expect(screen.getByText("risks.md")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Remove Notes/research/risks.md" }));
    expect(props.scope.onDetach).toHaveBeenCalledWith("Notes/research/risks.md");
  });

  // The chip is narrow and a path is cut from the right, so the whole path left the NAME - the part
  // that says which file it is - behind the ellipsis. The name is shown; the path is on hover, where
  // two files called notes.md in different folders can still be told apart.
  // Only the model used to be told a file did not fit. An attachment sent empty looked exactly like
  // one sent whole, which is how a model answering from three thousand characters of a file went
  // unnoticed (#145).
  it("marks an attachment that is cut short, or not sent at all", () => {
    withScope({
      attachments: ["Notes/whole.md", "Notes/part.md", "Notes/none.md"],
      cutShort: { "Notes/part.md": "partial", "Notes/none.md": "none" },
    });

    const chip = (name: string) => screen.getByText(name).closest("[title]")!;
    expect(chip("whole.md").textContent).not.toMatch(/cut short|not sent/);
    expect(chip("part.md").textContent).toContain("cut short");
    expect(chip("part.md").getAttribute("title")).toContain("Only the beginning of this file fits");
    expect(chip("none.md").textContent).toContain("not sent");
    expect(chip("none.md").getAttribute("title")).toContain("None of this file fits");
  });

  it("names an attachment by its file, with the whole path on hover", () => {
    withScope({ attachments: ["Notes/research/risks.md"] });

    expect(screen.getByText("risks.md").closest("[title]")?.getAttribute("title")).toBe(
      "Notes/research/risks.md",
    );
    expect(screen.getByText("risks.md").closest("[title]")?.textContent).not.toMatch(
      /cut short|not sent/,
    );
  });

  it("says when there is nothing left to attach", async () => {
    const user = userEvent.setup();
    withScope({ files: [] });

    await user.click(screen.getByRole("button", { name: "Attach a file" }));
    expect(screen.getByText(/No other files/)).toBeDefined();
  });

  // Changing what an answer is based on mid-reply would make the reply unexplainable.
  it("cannot be changed while a reply is arriving", () => {
    panel({
      streaming: true,
      scope: {
        attachments: [],
        files: [],
        includeFolder: false,
        folderPath: "",
        canUseFolder: true,
        onToggleFolder: vi.fn(),
        onNeedFiles: vi.fn(),
        onAttach: vi.fn(),
        onDetach: vi.fn(),
      },
    });

    expect(screen.getByRole("button", { name: "Folder" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Attach a file" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("offers no scope at all when no model is configured", () => {
    panel({ models: [], selectedId: null });
    expect(screen.queryByRole("button", { name: "Folder" })).toBeNull();
  });
});

/// Adding a file to the conversation by dragging it from the folder browser.
///
/// The tree marks what it drags with its own type, so only a file from the tree is taken - text or a
/// file dragged in from outside the app is not something this panel can read by name.
describe("ChatPanel: dropping a file from the folder browser", () => {
  const scopeWith = (over: Record<string, unknown> = {}) => ({
    attachments: [] as string[],
    files: [] as string[],
    includeFolder: false,
    folderPath: "",
    canUseFolder: true,
    onToggleFolder: vi.fn(),
    onNeedFiles: vi.fn(),
    onAttach: vi.fn(),
    onDetach: vi.fn(),
    ...over,
  });

  /// A DataTransfer as far as a drop needs one. jsdom has none of its own.
  const carrying = (entries: Record<string, string>) => ({
    types: Object.keys(entries),
    getData: (type: string) => entries[type] ?? "",
    dropEffect: "none",
  });

  it("attaches a file dropped from the tree", () => {
    const scope = scopeWith();
    panel({ scope });
    const target = screen.getByRole("complementary", { name: "Chat" });

    const dataTransfer = carrying({ [TREE_FILE_TYPE]: "ws/notes/risks.md" });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(scope.onAttach).toHaveBeenCalledWith("ws/notes/risks.md");
  });

  // While something is held over the panel it says it will take it, so a drop is not a guess.
  it("shows that it will take the file while one is held over it", () => {
    panel({ scope: scopeWith() });
    const target = screen.getByRole("complementary", { name: "Chat" });

    fireEvent.dragOver(target, { dataTransfer: carrying({ [TREE_FILE_TYPE]: "ws/a.md" }) });
    expect(screen.getByText("Drop to add to the chat")).toBeDefined();

    fireEvent.dragLeave(target, { dataTransfer: carrying({ [TREE_FILE_TYPE]: "ws/a.md" }) });
    expect(screen.queryByText("Drop to add to the chat")).toBeNull();
  });

  it("ignores anything that did not come from the tree", () => {
    const scope = scopeWith();
    panel({ scope });
    const target = screen.getByRole("complementary", { name: "Chat" });

    const dataTransfer = carrying({ "text/plain": "ws/notes/risks.md" });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(scope.onAttach).not.toHaveBeenCalled();
    expect(screen.queryByText("Drop to add to the chat")).toBeNull();
  });

  // The same rule the Attach button follows: what an answer is based on does not change mid-reply.
  it("does not attach while a reply is arriving", () => {
    const scope = scopeWith();
    panel({ scope, streaming: true });
    const target = screen.getByRole("complementary", { name: "Chat" });

    fireEvent.drop(target, { dataTransfer: carrying({ [TREE_FILE_TYPE]: "ws/a.md" }) });
    expect(scope.onAttach).not.toHaveBeenCalled();
  });

  // A file that could not be attached says why, beside the attachments it did not join.
  it("says why a file could not be attached", () => {
    panel({ scope: scopeWith({ attachFailure: "not-text" }) });
    expect(screen.getByRole("alert").textContent).toBe(
      "That file is not a text file, so it cannot be added to the chat.",
    );
  });
});

/// Reading a file the model asked for.
///
/// The only signal that anything is happening: a turn that pauses for several seconds while a file
/// is read would otherwise look stuck.
describe("ChatPanel: reading a file", () => {
  const waiting = [
    { role: "user" as const, content: "What do my notes say?" },
    { role: "assistant" as const, content: "" },
  ];

  const reading = { name: "get_file_contents", detail: "plan.md" };

  it("says which file it is reading, in place of thinking", () => {
    panel({ turns: waiting, streaming: true, activity: reading });

    expect(screen.getByText("Reading plan.md...")).toBeDefined();
    expect(screen.queryByText("Thinking...")).toBeNull();
  });

  // Any other tool is named rather than described as a read: "Reading notes" for a directory
  // listing would say something that did not happen.
  it("names any other tool it is using", () => {
    panel({
      turns: waiting,
      streaming: true,
      activity: { name: "search_contents", detail: "TODO" },
    });

    expect(screen.getByText("Using search_contents...")).toBeDefined();
    expect(screen.queryByText(/Reading/)).toBeNull();
  });

  it("goes back to thinking when nothing is being read", () => {
    panel({ turns: waiting, streaming: true, activity: null });
    expect(screen.getByText("Thinking...")).toBeDefined();
  });

  // Once tokens arrive, the answer replaces the progress line.
  it("stops once the reply starts arriving", () => {
    panel({
      turns: [
        { role: "user", content: "What do my notes say?" },
        { role: "assistant", content: "They say" },
      ],
      streaming: true,
      activity: reading,
    });

    expect(screen.queryByText("Reading plan.md...")).toBeNull();
    expect(screen.getByText("They say")).toBeDefined();
  });
});

/// The tool calls a reply made.
///
/// A block of their own, folded away like the thinking beside it: a line naming every call pushed
/// the answer around for a turn that made several, and squeezed the calls into a list of file names
/// that could not say what was searched or listed. Closed, the block is one short line; open, it is
/// every call in the order it was made.
describe("the tool calls a reply made", () => {
  const calls = [
    { name: "list_directory", detail: "apps/desktop/src" },
    { name: "get_file_contents", detail: "apps/desktop/src/main.js" },
    { name: "search_contents", detail: "appName" },
  ];
  const answered = (tools: { name: string; detail: string; cut?: { sent: number; total: number } }[]) => [
    { role: "user" as const, content: "What is in there?" },
    { role: "assistant" as const, content: "Here is what I found.", tools },
  ];

  it("is folded away, and says how many calls it holds", () => {
    panel({ turns: answered(calls) });

    const block = screen.getByTestId("turn-tools");
    expect(block.tagName).toBe("DETAILS");
    expect(block.hasAttribute("open")).toBe(false);
    expect(within(block).getByText("Tool calls (3)")).toBeDefined();
  });

  /// A read cut to the model's budget. The model is told in the text it was given; the user is told
  /// here, on the call, and on the closed block's own line so it is seen without opening it.
  describe("a read that was cut short", () => {
    const withCut = [
      calls[0]!,
      { ...calls[1]!, cut: { sent: 60_000, total: 142_300 } },
      calls[2]!,
    ];

    it("says so on the call, with how much of the file was sent", () => {
      panel({ turns: answered(withCut) });

      const items = within(screen.getByTestId("turn-tools")).getAllByRole("listitem");
      expect(items[1]!.textContent).toContain("get_file_contents apps/desktop/src/main.js");
      expect(items[1]!.textContent).toContain("cut short: 60,000 of 142,300 characters sent");
      expect(items[0]!.textContent).not.toContain("cut short");
    });

    it("says so on the folded block's own line, without opening it", () => {
      panel({ turns: answered(withCut) });
      expect(within(screen.getByTestId("turn-tools")).getByText("Tool calls (3) - 1 cut short")).toBeDefined();
    });
  });

  it("lists every call, in the order it was made", () => {
    panel({ turns: answered(calls) });

    const items = within(screen.getByTestId("turn-tools")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "list_directory apps/desktop/src",
      "get_file_contents apps/desktop/src/main.js",
      "search_contents appName",
    ]);
  });

  // A listing of the attached folder names no directory. The call still happened.
  it("names a call that had nothing to say about where it looked", () => {
    panel({ turns: answered([{ name: "list_directory", detail: "" }]) });

    const items = within(screen.getByTestId("turn-tools")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["list_directory"]);
  });

  it("opens to show the calls", async () => {
    panel({ turns: answered(calls) });

    await userEvent.click(screen.getByText("Tool calls (3)"));
    expect(screen.getByTestId("turn-tools").hasAttribute("open")).toBe(true);
  });

  it("shows nothing for a reply that made no calls", () => {
    panel({ turns: answered([]) });
    expect(screen.queryByTestId("turn-tools")).toBeNull();
  });

  it("shows nothing for a reply with no record of calls at all", () => {
    panel({ turns: [{ role: "assistant", content: "Hi" }] });
    expect(screen.queryByTestId("turn-tools")).toBeNull();
  });

  // It stays with the reply. Scrolling back to an answer should still say what it was based on.
  it("stays after the reply has finished", () => {
    panel({ turns: answered(calls), streaming: false });
    expect(screen.getByTestId("turn-tools")).toBeDefined();
  });

  // While the reply is still waiting, the bubble already says "Reading a.js" - the live signal.
  // Saying it twice in two different tenses is two controls for one fact.
  it("does not double up with the live reading message", () => {
    const read = { name: "get_file_contents", detail: "a.js" };
    panel({
      turns: [
        { role: "user", content: "What is in there?" },
        { role: "assistant", content: "", tools: [read] },
      ],
      streaming: true,
      activity: read,
    });

    expect(screen.queryByTestId("turn-tools")).toBeNull();
  });
});

/// What the model thought, shown per reply and collapsed.
///
/// It used to appear only when a reply produced no answer at all. A reply that thought and then
/// answered lost its thinking the moment it answered.
describe("the thinking behind a reply", () => {
  const thought = (reasoning: string, content = "Here is the answer.") => [
    { role: "user" as const, content: "Why?" },
    { role: "assistant" as const, content, reasoning },
  ];

  it("offers it on a reply that answered", () => {
    panel({ turns: thought("Because of that.") });
    expect(screen.getByText("Show what the model was thinking")).toBeDefined();
  });

  // Collapsed, per the request, and per reply: expanding one says nothing about the next.
  it("starts closed", () => {
    panel({ turns: thought("Because of that.") });
    expect(screen.getByTestId("turn-reasoning").hasAttribute("open")).toBe(false);
  });

  it("shows the thinking once opened", async () => {
    panel({ turns: thought("Because of that.") });
    await userEvent.click(screen.getByText("Show what the model was thinking"));
    expect(screen.getByTestId("turn-reasoning").textContent).toContain("Because of that.");
  });

  it("offers nothing on a reply that thought nothing", () => {
    panel({ turns: thought("") });
    expect(screen.queryByTestId("turn-reasoning")).toBeNull();
  });

  // THE ONE THAT MATTERS. A reply's content is split into edit cards with an Apply button, and a
  // model reasoning about whether to propose an edit writes something that looks exactly like one.
  // Reasoning is text and never goes near that splitter, or the user is offered Apply for a change
  // the model never proposed and may have decided against.
  it("never turns thinking into an apply card", async () => {
    const block = ["```trypthos-edit append", "Some content", "```"].join("\n");
    panel({ turns: thought(`Maybe I should write:\n\n${block}`) });

    await userEvent.click(screen.getByText("Show what the model was thinking"));
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
    expect(screen.getByTestId("turn-reasoning").textContent).toContain("trypthos-edit");
  });

  // The case that already worked: a reply that thought and then stopped.
  it("still explains a reply that produced no answer", () => {
    panel({ turns: thought("I thought about it.", ""), streaming: false });
    expect(screen.getByText("The model finished without writing an answer. Try asking again.")).toBeDefined();
    expect(screen.getByTestId("turn-reasoning")).toBeDefined();
  });
});

/// The paths a reply names, made clickable.
///
/// The rule and the DOM pass are tested in `replyLinks.test`; this is the wiring, and the one thing
/// that only shows up in the panel - that it happens at all, and that it is marked in the way the
/// window's own click handler looks for.
describe("ChatPanel: links in a reply", () => {
  const reply = (content: string) =>
    panel({
      fileTypes: ["markdown", "python"],
      // Which folder the model's paths are in. Without one a bare path names nothing, which is the
      // honest answer when no folder is open.
      linkWorkspaceId: "Notes",
      turns: [
        { role: "user" as const, content: "Where is it?" },
        { role: "assistant" as const, content },
      ],
    });

  it("makes a file path in a reply a link the window will open", () => {
    reply("It is in `notes/plan.md`, near the top.");

    const anchor = document.querySelector("a[data-md-link]");
    expect(anchor?.getAttribute("href")).toBe("notes/plan.md");
    expect(anchor?.textContent).toBe("notes/plan.md");
  });

  it("leaves a command in backticks as text", () => {
    reply("Run `npm run build` first.");
    expect(document.querySelector("a[data-md-link]")).toBeNull();
  });
});

// A reply's rendered markup is set with `dangerouslySetInnerHTML`, and React 19 sets it again whenever
// that object is a new one. Typing a question re-renders the panel, and used to wipe whatever had
// been drawn into the replies above it - coloured code - on every keystroke.
describe("ChatPanel: a reply's rendering", () => {
  it("survives typing the next question", async () => {
    const user = userEvent.setup();
    panel({ turns: [{ role: "user", content: "Show me" }, { role: "assistant", content: "Here:\n\n```ts\nconst a = 1;\n```" }] });
    const code = document.querySelector(".chat-md pre code")!;
    code.setAttribute("data-drawn", "yes");

    await user.type(screen.getByRole("textbox", { name: "Message" }), "next");

    expect(document.querySelector(".chat-md pre code")).toBe(code);
    expect(code.getAttribute("data-drawn")).toBe("yes");
  });
});

describe("copying a response", () => {
  const conversation = [
    { role: "user" as const, content: "First question" },
    { role: "assistant" as const, content: "An **older** answer" },
    { role: "user" as const, content: "Second question" },
    { role: "assistant" as const, content: "# Newest\n\n- one\n- `two`" },
  ];

  // The markdown the model wrote, not the text the panel rendered from it: pasted into a document it
  // should be the same document.
  it("copies only the most recent reply, as markdown", async () => {
    const user = userEvent.setup();
    const copyText = vi.fn(async () => {});
    panel({ turns: conversation, copyText });

    await user.click(screen.getByRole("button", { name: "Copy response" }));

    expect(copyText).toHaveBeenCalledWith("# Newest\n\n- one\n- `two`");
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Response copied");
  });

  it("says so when the clipboard refuses", async () => {
    const user = userEvent.setup();
    const copyText = vi.fn(async () => {
      throw new Error("denied");
    });
    panel({ turns: conversation, copyText });

    await user.click(screen.getByRole("button", { name: "Copy response" }));

    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "The response could not be copied",
    );
  });

  it("has nothing to copy before a reply", () => {
    panel({ turns: [{ role: "user", content: "Hello" }] });
    expect(screen.getByRole("button", { name: "Copy response" })).toHaveProperty("disabled", true);
  });

  // Half an answer is not the response, and copying it would put a truncated reply on the clipboard
  // that looks complete.
  it("cannot copy while the reply is still arriving", () => {
    panel({ turns: conversation, streaming: true });
    expect(screen.getByRole("button", { name: "Copy response" })).toHaveProperty("disabled", true);
  });
});

describe("chat statistics", () => {
  const windowed = ChatProfileSchema.parse({ ...model, contextWindow: 8000 });

  function reply(): ReplyStats {
    const steps: [number, ChatEvent][] = [
      [1400, { type: "token", text: "Hello" }],
      [3400, { type: "usage", promptTokens: 1200, replyTokens: 50 }],
      [3500, { type: "end" }],
    ];
    return steps.reduce(
      (stats, [at, event]) => noteReplyEvent(stats, event, at),
      startReplyStats({ profileId: "one", at: 1000 }),
    );
  }

  /// A reply that called a tool, so made two requests, and is still arriving.
  function toolReply(): ReplyStats {
    const steps: [number, ChatEvent][] = [
      [1100, { type: "tool", name: "get_file_contents", detail: "a.md" }],
      [1100, { type: "usage", promptTokens: 100, replyTokens: 20 }],
      [1500, { type: "token", text: "Done" }],
      [1600, { type: "usage", promptTokens: 900, replyTokens: 30 }],
    ];
    return steps.reduce(
      (stats, [at, event]) => noteReplyEvent(stats, event, at),
      startReplyStats({ profileId: "one", at: 1000 }),
    );
  }

  // Each request resends the conversation, so the totals run far past the context used - which is
  // right, and read as a contradiction while nothing said they were totals (#169).
  it("says the token counts cover every request, and shows what the last one sent", async () => {
    const user = userEvent.setup();
    panel({ models: [windowed], replyStats: [toolReply()] });

    await user.click(screen.getByRole("button", { name: "Chat statistics" }));
    const stats = within(screen.getByRole("dialog", { name: "Chat statistics" }));
    const row = (label: string) => stats.getAllByText(label)[0]!.nextElementSibling?.textContent;

    expect(row("Tokens sent")).toBe("1,000 in 2 requests");
    expect(row("Tokens returned")).toBe("50 in 2 requests");
    expect(row("Total tokens")).toBe("1,050 in 2 requests");
    expect(row("Sent in the last request")).toBe("900");
    expect(row("Context used")).toBe("930 of 8,000 (12%)");
  });

  it("shows no last-request row for a reply that made one request", async () => {
    const user = userEvent.setup();
    panel({ models: [windowed], replyStats: [reply()] });

    await user.click(screen.getByRole("button", { name: "Chat statistics" }));

    expect(screen.queryByText("Sent in the last request")).toBeNull();
  });

  it("does not give a conversation still arriving a total time of 0 ms", async () => {
    const user = userEvent.setup();
    panel({ models: [windowed], replyStats: [toolReply()] });

    await user.click(screen.getByRole("button", { name: "Chat statistics" }));
    const stats = within(screen.getByRole("dialog", { name: "Chat statistics" }));
    // The second "Total response time" is the conversation's.
    const conversationTime = () => stats.getAllByText("Total response time")[1]!.nextElementSibling?.textContent;

    expect(conversationTime()).toBe("Not yet");
  });

  it("says a reply is still arriving beside the time the finished ones took", async () => {
    const user = userEvent.setup();
    panel({ models: [windowed], replyStats: [reply(), toolReply()] });

    await user.click(screen.getByRole("button", { name: "Chat statistics" }));
    const stats = within(screen.getByRole("dialog", { name: "Chat statistics" }));

    expect(stats.getAllByText("Total response time")[1]!.nextElementSibling?.textContent).toBe(
      "2.50 s, plus 1 still arriving",
    );
  });

  it("opens from the toolbar", async () => {
    const user = userEvent.setup();
    panel({ models: [windowed], replyStats: [reply()] });

    await user.click(screen.getByRole("button", { name: "Chat statistics" }));

    expect(screen.getByRole("dialog", { name: "Chat statistics" })).toBeDefined();
  });

  it("shows how the most recent reply went", async () => {
    const user = userEvent.setup();
    panel({ models: [windowed], replyStats: [reply()] });

    await user.click(screen.getByRole("button", { name: "Chat statistics" }));
    const stats = within(screen.getByRole("dialog", { name: "Chat statistics" }));
    const row = (label: string) => stats.getAllByText(label)[0]!.nextElementSibling?.textContent;

    expect(row("Model")).toBe("Local model");
    expect(row("Time to first token")).toBe("400 ms");
    expect(row("Total response time")).toBe("2.50 s");
    expect(row("Tokens per second")).toBe("23.8");
    expect(row("Tokens sent")).toBe("1,200");
    expect(row("Tokens returned")).toBe("50");
    expect(row("Total tokens")).toBe("1,250");
    expect(row("Context used")).toBe("1,250 of 8,000 (16%)");
  });

  it("says what was estimated when the endpoint reports no usage", async () => {
    const user = userEvent.setup();
    const unreported = [
      noteReplyEvent(
        noteReplyEvent(startReplyStats({ profileId: "one", at: 0 }), { type: "token", text: "a".repeat(40) }, 100),
        { type: "end" },
        1100,
      ),
    ];
    panel({ replyStats: unreported });

    await user.click(screen.getByRole("button", { name: "Chat statistics" }));
    const stats = within(screen.getByRole("dialog", { name: "Chat statistics" }));

    expect(stats.getAllByText("Tokens sent")[0]!.nextElementSibling?.textContent).toBe("Not reported");
    expect(stats.getAllByText("Tokens returned")[0]!.nextElementSibling?.textContent).toBe("About 10");
    expect(stats.getByText(/did not report token counts/)).toBeDefined();
  });

  // For a reply that looks wrong: the log shows what the endpoint actually sent.
  it("opens the conversation log from the statistics, and closes itself", async () => {
    const user = userEvent.setup();
    const onOpenLog = vi.fn();
    panel({ models: [windowed], replyStats: [reply()], onOpenLog });

    await user.click(screen.getByRole("button", { name: "Chat statistics" }));
    await user.click(screen.getByRole("button", { name: "View conversation log" }));

    expect(onOpenLog).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Chat statistics" })).toBeNull();
  });

  it("says there is nothing to show before a reply has been timed", async () => {
    const user = userEvent.setup();
    panel();

    await user.click(screen.getByRole("button", { name: "Chat statistics" }));

    expect(screen.getByText(/No reply has been timed/)).toBeDefined();
  });
});
