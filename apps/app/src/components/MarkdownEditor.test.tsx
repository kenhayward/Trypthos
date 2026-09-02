import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MarkdownEditor from "./MarkdownEditor";

function Harness({
  onChange,
  onCaret,
}: {
  onChange: (value: string) => void;
  onCaret?: (line: number, column: number) => void;
}) {
  const [doc, setDoc] = useState({ id: "a.md", text: "first file\nline two\nline three\n" });

  return (
    <>
      <button type="button" onClick={() => setDoc({ id: "b.md", text: "second file\n" })}>
        open other
      </button>
      <button type="button" onClick={() => setDoc((d) => ({ ...d, text: "reloaded\n" }))}>
        reload same
      </button>
      <MarkdownEditor
        documentId={doc.id}
        value={doc.text}
        onChange={onChange}
        live={false}
        onCaret={onCaret}
        ariaLabel="Markdown source"
      />
    </>
  );
}

describe("MarkdownEditor", () => {
  // The document is replaced by dispatching a change into CodeMirror, which is indistinguishable
  // from typing unless it is marked. Unmarked, opening a file reported an edit the moment it loaded,
  // and every file arrived already marked Unsaved.
  it("does not report an edit when the document is replaced from outside", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "open other" }).click();
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();
  });

  // The counterpart to the test above: marking external changes must not also silence real ones.
  it("still reports edits the user makes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByLabelText("Markdown source"));
    await user.keyboard("X");

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("X");
  });

  // Opening a different file must start at the top. Reusing one editor keeps caret and scroll unless
  // they are reset, so the new document opened wherever the previous one had been left.
  it("returns the caret to the start when a different document is opened", async () => {
    const onCaret = vi.fn();
    render(<Harness onChange={vi.fn()} onCaret={onCaret} />);

    onCaret.mockClear();
    screen.getByRole("button", { name: "open other" }).click();
    await Promise.resolve();

    expect(onCaret).toHaveBeenCalledWith(1, 1);
  });

  // A reload of the SAME file is not a new document, so the caret is not forced back to the start -
  // that would throw away the reader's place for a change they did not make.
  //
  // The caret has to be moved off line 1 first, or the assertion passes for the wrong reason: it was
  // already at 1,1, so reporting 1,1 proves nothing either way.
  it("does not send the caret back to the start when the same document is reloaded", async () => {
    const user = userEvent.setup();
    const onCaret = vi.fn();
    render(<Harness onChange={vi.fn()} onCaret={onCaret} />);

    await user.click(screen.getByLabelText("Markdown source"));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(onCaret.mock.calls.at(-1)?.[0]).toBeGreaterThan(1);

    onCaret.mockClear();
    screen.getByRole("button", { name: "reload same" }).click();
    await Promise.resolve();

    const line = onCaret.mock.calls.at(-1)?.[0];
    if (line !== undefined) expect(line).toBeGreaterThan(1);
  });
});
