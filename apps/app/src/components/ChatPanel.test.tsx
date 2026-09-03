import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatProfileSchema } from "@trypthos/domain";
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
    onSend: vi.fn(),
    onStop: vi.fn(),
    onClear: vi.fn(),
    onConfigure: vi.fn(),
    resolveEdit: () => ({ ok: true as const, from: 0, to: 0, insert: "" }),
    onApplyEdit: vi.fn(() => true),
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

    await user.click(screen.getByRole("button", { name: "Open Preferences" }));
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

  // A model can be removed from Preferences between one turn and the next, so a remembered id may
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
