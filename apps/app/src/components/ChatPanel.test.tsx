import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatProfileSchema, type ChatSessionSummary } from "@trypthos/domain";
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
    streaming: false,
    error: null,
    reasoning: "",
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

  it("says the model wrote nothing, rather than showing an empty bubble", () => {
    panel({ turns: empty, streaming: false });
    expect(screen.getByText(/finished without writing an answer/)).toBeDefined();
  });

  it("offers the model's thinking when there is some", () => {
    panel({ turns: empty, streaming: false, reasoning: "Working out the summary." });
    expect(screen.getByText("Show what the model was thinking")).toBeDefined();
  });

  // Folded away, because it is not the answer and is often long. Asserted on the disclosure's own
  // state rather than on whether the text is in the DOM: jsdom keeps a closed <details> element's
  // children mounted, so a presence check would pass whether it was folded or not.
  it("keeps the thinking behind a disclosure rather than in the thread", async () => {
    const user = userEvent.setup();
    panel({ turns: empty, streaming: false, reasoning: "Working out the summary." });

    const disclosure = screen.getByText("Show what the model was thinking").closest("details")!;
    expect(disclosure.open).toBe(false);

    await user.click(screen.getByText("Show what the model was thinking"));
    expect(disclosure.open).toBe(true);
    expect(screen.getByText("Working out the summary.")).toBeDefined();
  });

  it("offers nothing to show when the model did not think out loud either", () => {
    panel({ turns: empty, streaming: false, reasoning: "" });
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
    const props = withScope({ attachments: ["notes/risks.md"] });

    expect(screen.getByText("notes/risks.md")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Remove notes/risks.md" }));
    expect(props.scope.onDetach).toHaveBeenCalledWith("notes/risks.md");
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

/// Reading a file the model asked for.
///
/// The only signal that anything is happening: a turn that pauses for several seconds while a file
/// is read would otherwise look stuck.
describe("ChatPanel: reading a file", () => {
  const waiting = [
    { role: "user" as const, content: "What do my notes say?" },
    { role: "assistant" as const, content: "" },
  ];

  it("says which file it is reading, in place of thinking", () => {
    panel({ turns: waiting, streaming: true, activity: "plan.md" });

    expect(screen.getByText("Reading plan.md...")).toBeDefined();
    expect(screen.queryByText("Thinking...")).toBeNull();
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
      activity: "plan.md",
    });

    expect(screen.queryByText("Reading plan.md...")).toBeNull();
    expect(screen.getByText("They say")).toBeDefined();
  });
});
