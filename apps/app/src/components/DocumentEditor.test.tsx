import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FILE_TYPES, MARKDOWN_FILE_TYPE } from "@trypthos/domain";
import DocumentEditor, { type EditorHandle } from "./DocumentEditor";

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
      <DocumentEditor
        documentId={doc.id}
        value={doc.text}
        onChange={onChange}
        live={false}
        fileType={MARKDOWN_FILE_TYPE}
        fileTypes={["markdown"]}
        onCaret={onCaret}
        ariaLabel="Document source"
      />
    </>
  );
}

describe("DocumentEditor", () => {
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

    await user.click(screen.getByLabelText("Document source"));
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

    await user.click(screen.getByLabelText("Document source"));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(onCaret.mock.calls.at(-1)?.[0]).toBeGreaterThan(1);

    onCaret.mockClear();
    screen.getByRole("button", { name: "reload same" }).click();
    await Promise.resolve();

    const line = onCaret.mock.calls.at(-1)?.[0];
    if (line !== undefined) expect(line).toBeGreaterThan(1);
  });
});

/// Spelling in the editor.
///
/// CodeMirror sets spellcheck="false" on its content element by default, so this is an override
/// rather than a default being confirmed. Without it the editor is the one text surface in the app
/// with no corrections, while the chat box and settings fields have them - and nothing would say so.
describe("spelling", () => {
  it("lets the platform spellcheck the document", () => {
    render(
      <DocumentEditor
        documentId="notes.md"
        value="Some prose."
        onChange={() => {}}
        live={false}
        fileType={MARKDOWN_FILE_TYPE}
        fileTypes={["markdown"]}
        ariaLabel="Editor"
      />,
    );

    expect(document.querySelector(".cm-content")?.getAttribute("spellcheck")).toBe("true");
  });
});

/// Formatting, driven from outside the editor.
///
/// The toolbar has no CodeMirror of its own: it names an action, and the editor turns the current
/// document and selection into one change. What each action produces is the domain's own test - what
/// matters here is that the change reaches the document and is reported as an edit.
describe("formatting", () => {
  function Formatting({ onChange, readOnly = false }: { onChange: (value: string) => void; readOnly?: boolean }) {
    const handle = useRef<EditorHandle>(null);
    return (
      <>
        <button type="button" onClick={() => handle.current?.format("bold")}>
          bold
        </button>
        <DocumentEditor
          documentId="a.md"
          value={"first file\nline two\n"}
          onChange={onChange}
          live={false}
        fileType={MARKDOWN_FILE_TYPE}
        fileTypes={["markdown"]}
          readOnly={readOnly}
          ref={handle}
          ariaLabel="Document source"
        />
      </>
    );
  }

  it("applies an action to the document and reports the edit", async () => {
    const onChange = vi.fn();
    render(<Formatting onChange={onChange} />);

    // The caret opens at the start of the document, so the word it is in is the first one.
    screen.getByRole("button", { name: "bold" }).click();
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledWith("**first** file\nline two\n");
  });

  // The guide opens read-only, and read-only has to mean the surface itself refuses - not merely
  // that nothing downstream records the change. A buffer that accepts keystrokes and silently drops
  // them is a document the user watches themselves lose.
  it("refuses to be typed into when the document is read-only", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Formatting onChange={onChange} readOnly />);

    await user.click(screen.getByLabelText("Document source"));
    await user.keyboard("X");

    expect(onChange).not.toHaveBeenCalled();
  });
});

/// Editing behaviour follows the file type's `kind`, and all three of these are invisible when
/// wrong: a source file quietly underlined in red, or a log quietly rewrapped so the column a
/// character sits in stops meaning anything.
describe("behaviour by kind", () => {
  const typeOf = (id: string) => FILE_TYPES.find((type) => type.id === id)!;

  function open(id: string, name: string) {
    render(
      <DocumentEditor
        documentId={name}
        value={'{ "a": 1 }'}
        onChange={() => {}}
        live={false}
        fileType={typeOf(id)}
        fileTypes={["markdown", "json"]}
        ariaLabel="Editor"
      />,
    );
    return document.querySelector(".cm-content") as HTMLElement;
  }

  it("does not spellcheck code", () => {
    expect(open("json", "data.json").getAttribute("spellcheck")).toBe("false");
  });

  it("wraps prose", () => {
    expect(open("markdown", "notes.md").classList.contains("cm-lineWrapping")).toBe(true);
  });

  // Wrapping a source file or a log is wrong: the column a character sits in is information there.
  it("does not wrap code", () => {
    expect(open("json", "data.json").classList.contains("cm-lineWrapping")).toBe(false);
  });
});
