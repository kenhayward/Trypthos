import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EditorPanel from "./EditorPanel";

const DOC = "# Title\n\nSome **bold** text and `code`.\n\n- one\n- two\n";

/// Mirrors the real arrangement: the document lives above the panel, so a mode switch has no path
/// by which to change it.
function Harness({
  onChange = vi.fn(),
  dirty = false,
}: {
  onChange?: (value: string) => void;
  dirty?: boolean;
}) {
  const [value, setValue] = useState(DOC);
  return (
    <EditorPanel
      workspaceName="Diariz"
      paths={["docs/notes.md"]}
      activePath="docs/notes.md"
      dirty={dirty}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const modeButton = (name: string) => screen.getByRole("button", { name });

describe("EditorPanel", () => {
  it("opens in Live mode with the document in an editable surface", () => {
    render(<Harness />);

    expect(modeButton("Live").getAttribute("aria-pressed")).toBe("true");
    expect(modeButton("Source").getAttribute("aria-pressed")).toBe("false");
    expect(modeButton("Preview").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Markdown source")).toBeDefined();
  });

  // The configured default, not a hard-coded one: the setting decides which view a document opens
  // in, and it arrives after the panel has mounted because settings are read from disk.
  it("opens a document in the configured view mode", () => {
    render(
      <EditorPanel
        workspaceName="Diariz"
        paths={["docs/notes.md"]}
        activePath="docs/notes.md"
        dirty={false}
        value={DOC}
        defaultMode="source"
        onChange={vi.fn()}
      />,
    );

    expect(modeButton("Source").getAttribute("aria-pressed")).toBe("true");
  });

  // A choice made in the header is about the document in front of you, and outlasts a setting
  // arriving late from disk.
  it("keeps a chosen mode when the configured default changes underneath it", async () => {
    const user = userEvent.setup();
    const panel = (mode: "live" | "source" | "preview") => (
      <EditorPanel
        workspaceName="Diariz"
        paths={["docs/notes.md"]}
        activePath="docs/notes.md"
        dirty={false}
        value={DOC}
        defaultMode={mode}
        onChange={vi.fn()}
      />
    );
    const view = render(panel("live"));

    await user.click(modeButton("Preview"));
    view.rerender(panel("source"));

    expect(modeButton("Preview").getAttribute("aria-pressed")).toBe("true");
  });

  // Each document opens in the configured view, which is what a default for documents means - the
  // last document's choice is not carried into the next one.
  it("returns to the configured view when another document is opened", async () => {
    const user = userEvent.setup();
    const panel = (filePath: string) => (
      <EditorPanel
        workspaceName="Diariz"
        paths={[filePath]}
        activePath={filePath}
        dirty={false}
        value={DOC}
        defaultMode="live"
        onChange={vi.fn()}
      />
    );
    const view = render(panel("docs/notes.md"));

    await user.click(modeButton("Source"));
    view.rerender(panel("docs/other.md"));

    expect(modeButton("Live").getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the same editing surface across Live and Source", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const before = screen.getByLabelText("Markdown source");
    await user.click(modeButton("Source"));

    // The same element, not a replacement: Live and Source are decorations over one editor, so
    // switching between them must not rebuild it and discard undo history.
    expect(screen.getByLabelText("Markdown source")).toBe(before);
  });

  // The document is named by its tab, not by the header. The header speaks for the STATE of what is
  // on screen - saved or not, and how you are looking at it - and the two must not repeat each other.
  it("names the document on its tab", () => {
    render(<Harness />);

    expect(screen.getByRole("tab", { name: /notes\.md/ })).toBeDefined();
  });

  // The strip scrolls, so a tab can be out of sight. The list is how you reach it, and it sits at the
  // end of the strip rather than inside it, where it would scroll away with the tabs.
  it("reaches an open file through the list as well as its tab", async () => {
    const user = userEvent.setup();
    const onActivateFile = vi.fn();
    render(
      <EditorPanel
        workspaceName="Diariz"
        paths={["docs/notes.md", "docs/plan.md"]}
        activePath="docs/notes.md"
        dirty={false}
        value={DOC}
        onChange={vi.fn()}
        onActivateFile={onActivateFile}
      />,
    );

    await user.click(screen.getByRole("button", { name: "All open files" }));
    // The list, not the close button on the tab of the same name.
    await user.click(within(screen.getByRole("list")).getByRole("button", { name: /plan\.md/ }));

    expect(onActivateFile).toHaveBeenCalledWith("docs/plan.md");
  });

  it("has no open-files list when there is nothing open", () => {
    render(
      <EditorPanel
        workspaceName={null}
        paths={[]}
        activePath={null}
        dirty={false}
        value={DOC}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "All open files" })).toBeNull();
  });

  it("names the scratch buffer when no document is open", () => {
    render(
      <EditorPanel
        workspaceName={null}
        paths={[]}
        activePath={null}
        dirty={false}
        value={DOC}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Scratch buffer")).toBeDefined();
  });

  it("says in the header that the document on screen is unsaved", () => {
    render(<Harness dirty />);

    expect(screen.getByText("Unsaved")).toBeDefined();
  });

  // Moved out of the header when the tabs arrived: the top row has to give its width to the strip,
  // and the status bar is where an editor reports where the caret is anyway.
  it("reports the caret and the word count in the status bar", () => {
    render(<Harness />);

    const status = screen.getByText("UTF-8").parentElement;
    expect(status?.textContent).toContain("Ln 1, Col 1");
    expect(status?.textContent).toContain("words");
  });

  it("renders the document as prose in Preview mode", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(modeButton("Preview"));

    const preview = screen.getByLabelText("Markdown preview");
    expect(preview.querySelector("h1")?.textContent).toBe("Title");
    expect(preview.querySelector("strong")?.textContent).toBe("bold");
    expect(preview.querySelectorAll("li")).toHaveLength(2);
    // The markers are gone because the view renders them, not because the text lost them.
    expect(preview.textContent).not.toContain("**bold**");
  });

  it("has no editing surface in Preview mode", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(modeButton("Preview"));

    expect(screen.queryByLabelText("Markdown source")).toBeNull();
  });

  // The invariant the whole editor design rests on. If a mode switch could rewrite the document,
  // the two audiences would be back to a trade-off: one of them gets their file reformatted.
  it("never alters the document when switching modes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(modeButton("Source"));
    const before = screen.getByLabelText("Markdown source").textContent;

    await user.click(modeButton("Preview"));
    await user.click(modeButton("Live"));
    await user.click(modeButton("Source"));
    await user.click(modeButton("Preview"));
    await user.click(modeButton("Source"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Markdown source").textContent).toBe(before);
  });

  it("reports edits to the owner of the document", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(modeButton("Source"));
    await user.click(screen.getByLabelText("Markdown source"));
    await user.keyboard("X");

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("X");
  });
});

/// The formatting toolbar.
///
/// It lives in Source, where the markers it writes are visible. What each button produces is tested
/// as data in the domain; what matters here is that the toolbar is in the right view, acts on the
/// document actually on screen, and is not offered for a document that refuses edits.
describe("the formatting toolbar", () => {
  const toolbar = () => screen.queryByRole("toolbar", { name: "Formatting" });

  it("appears in Source, and in neither of the other views", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(toolbar()).toBeNull();

    await user.click(modeButton("Source"));
    expect(toolbar()).not.toBeNull();

    await user.click(modeButton("Preview"));
    expect(toolbar()).toBeNull();
  });

  it("changes the document on screen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(modeButton("Source"));
    // The caret opens at the start of the document, so this acts on the title line - which is
    // already a level one heading, and so goes back to being a paragraph.
    await user.click(screen.getByRole("button", { name: "Heading 1" }));

    expect(onChange).toHaveBeenLastCalledWith(DOC.replace("# Title", "Title"));
  });

  it("is not offered for a document that cannot be edited", async () => {
    const user = userEvent.setup();
    render(
      <EditorPanel
        workspaceName={null}
        paths={["trypthos:markdown-guide"]}
        activePath="trypthos:markdown-guide"
        dirty={false}
        value={DOC}
        readOnly
        onChange={vi.fn()}
      />,
    );

    await user.click(modeButton("Source"));

    expect(toolbar()).toBeNull();
  });
});
