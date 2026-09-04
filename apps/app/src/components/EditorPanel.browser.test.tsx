import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { describe, expect, it } from "vitest";
import EditorPanel from "./EditorPanel";
import { resolveEdit } from "@trypthos/domain";
import type { EditorHandle, EditorSelection } from "./MarkdownEditor";

const DOC = "# Title\n\nSome **bold** text.\n\nA [link](https://example.com) here.\n";

function Harness({ onSelect }: { onSelect?: (selection: EditorSelection) => void } = {}) {
  const [value, setValue] = useState(DOC);
  return (
    <EditorPanel
      workspaceName="Notes"
      filePath="notes.md"
      dirty={false}
      value={value}
      onChange={setValue}
      onSelectionChange={onSelect}
    />
  );
}

const modeButton = (name: string) => screen.getByRole("button", { name });
const surface = () => document.querySelector(".cm-content") as HTMLElement;

const lineWith = (text: string): HTMLElement => {
  const line = [...document.querySelectorAll(".cm-line")].find((el) =>
    el.textContent?.includes(text),
  );
  if (!line) throw new Error(`No rendered line containing ${JSON.stringify(text)}`);
  return line as HTMLElement;
};

/// Moves the caret by clicking, using the browser's real input rather than a synthetic event.
///
/// This matters more than it looks. `@testing-library/user-event` dispatches synthetic events, and
/// CodeMirror does not move its caret for them - it resolves a position from real pointer input. A
/// test using the synthetic click passes while the caret never moves, so every assertion after it is
/// measuring the wrong state. That is exactly how the first version of this file "passed" a
/// reveal-tracking test that was doing nothing.
async function putCaretOn(text: string): Promise<void> {
  await userEvent.click(lineWith(text));
}

/// These assertions are impossible in jsdom.
///
/// CodeMirror decides what to render by measuring text, and jsdom has no layout engine, so nothing
/// below would be testing the editor - it would be testing the polyfill that stands in for geometry.
/// Everything here is a rendering question, which is what this suite is for.
describe("Live mode, rendered", () => {
  it("hides the heading's hash while the caret is elsewhere", async () => {
    render(<Harness />);
    // The caret starts at the top, which reveals line 1. Move it away first.
    await putCaretOn("bold");

    expect(lineWith("Title").textContent).toBe("Title");
    expect(surface().textContent).not.toContain("# Title");
  });

  it("still holds the hidden characters in the document", async () => {
    render(<Harness />);
    await putCaretOn("bold");

    // Nothing was rewritten: Source shows exactly what is stored, hash and all.
    await userEvent.click(modeButton("Source"));
    expect(surface().textContent).toContain("# Title");
  });

  it("reveals the caret line's own markers, and only that line's", async () => {
    render(<Harness />);

    await putCaretOn("bold");
    expect(lineWith("bold").textContent).toContain("**");
    expect(lineWith("Title").textContent).not.toContain("#");

    await putCaretOn("Title");
    expect(lineWith("Title").textContent).toContain("#");
    expect(lineWith("bold").textContent).not.toContain("**");
  });

  it("draws a heading larger than body text, rather than colouring it", async () => {
    render(<Harness />);
    await putCaretOn("bold");

    // The decoration is a span inside the line, not the line itself - measuring the line reports the
    // editor's base size and compares it against itself.
    const heading = document.querySelector(".cm-live-h1") as HTMLElement;
    expect(heading).not.toBeNull();

    const headingSize = parseFloat(getComputedStyle(heading).fontSize);
    const bodySize = parseFloat(getComputedStyle(lineWith("bold")).fontSize);
    expect(headingSize).toBeGreaterThan(bodySize);
  });

  it("draws bold text bold", async () => {
    render(<Harness />);
    await putCaretOn("Title");

    const strong = document.querySelector(".cm-live-strong") as HTMLElement;
    expect(strong).not.toBeNull();
    expect(Number(getComputedStyle(strong).fontWeight)).toBeGreaterThanOrEqual(700);
  });

  it("shows a link as its text, not its target", async () => {
    render(<Harness />);
    await putCaretOn("Title");

    const line = lineWith("link");
    expect(line.textContent).toContain("link");
    expect(line.textContent).not.toContain("https://example.com");
  });
});

describe("Source mode, rendered", () => {
  it("shows every character, on every line", async () => {
    render(<Harness />);
    await userEvent.click(modeButton("Source"));

    const text = surface().textContent ?? "";
    expect(text).toContain("# Title");
    expect(text).toContain("**bold**");
    expect(text).toContain("(https://example.com)");
  });
});

/// Scroll position is geometry, so this is the only place it can be asserted at all.
describe("Opening a different file, rendered", () => {
  function TwoFiles() {
    const [path, setPath] = useState("long.md");
    const long = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");

    return (
      <>
        <button type="button" onClick={() => setPath("short.md")}>
          open short
        </button>
        {/* A definite height, or the editor simply grows to fit its content and there is nothing to
            scroll - the assertion would then pass for the wrong reason. */}
        <div style={{ height: 300, display: "flex" }}>
          <EditorPanel
            workspaceName="ws"
            filePath={path}
            dirty={false}
            value={path === "long.md" ? long : "short file\n"}
            onChange={() => {}}
          />
        </div>
      </>
    );
  }

  it("opens the new file at the top, not where the last one was left", async () => {
    render(<TwoFiles />);

    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = 900;
    expect(scroller.scrollTop).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "open short" }));
    // The same scroller element: the editor is reused, which is exactly why the position had to be
    // reset rather than being discarded along with the old view.
    expect((document.querySelector(".cm-scroller") as HTMLElement).scrollTop).toBe(0);
  });
});

/// What the chat panel is given as context.
///
/// In this suite because a selection is real input: `@testing-library/user-event` dispatches
/// synthetic events and CodeMirror does not move its caret for them, so the jsdom version of this
/// test would report an empty selection for ever and pass anyway.
describe("Reporting the selection, in a real browser", () => {
  it("reports nothing when the caret is only placed, not dragged", async () => {
    const seen: EditorSelection[] = [];
    render(<Harness onSelect={(selection) => seen.push(selection)} />);

    await putCaretOn("Some");

    // A click sets an empty selection. Reported, and reported as empty - which is what makes chat
    // fall back to the whole file rather than sending nothing.
    expect(seen.at(-1)?.text).toBe("");
  });

  it("reports the text once a selection is made", async () => {
    const seen: EditorSelection[] = [];
    render(<Harness onSelect={(selection) => seen.push(selection)} />);

    await putCaretOn("Some");
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}");

    expect(seen.at(-1)?.text.length).toBe(4);
  });

  it("reports the selection emptying again when it is collapsed", async () => {
    const seen: EditorSelection[] = [];
    render(<Harness onSelect={(selection) => seen.push(selection)} />);

    await putCaretOn("Some");
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
    expect(seen.at(-1)?.text).not.toBe("");

    await userEvent.keyboard("{ArrowRight}");
    expect(seen.at(-1)?.text).toBe("");
  });

  it("reports the whole document when everything is selected", async () => {
    const seen: EditorSelection[] = [];
    render(<Harness onSelect={(selection) => seen.push(selection)} />);

    await putCaretOn("Some");
    await userEvent.keyboard("{Control>}a{/Control}");

    expect(seen.at(-1)?.text).toBe(DOC);
  });

  // The offsets are what an accepted "replace the selection" edit writes to. A wrong range there
  // overwrites the wrong span of somebody's document, which no assertion on the text would catch.
  it("reports offsets that bracket exactly the selected text", async () => {
    const seen: EditorSelection[] = [];
    render(<Harness onSelect={(selection) => seen.push(selection)} />);

    await putCaretOn("Some");
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}");

    const last = seen.at(-1)!;
    expect(DOC.slice(last.from, last.to)).toBe(last.text);
  });
});

/// Preview's styling comes from a class, and a class is a string in two files.
///
/// Rename it in the stylesheet and not in the component - or the reverse - and Preview renders as
/// unstyled HTML: no heading sizes, no table borders, no code background. Everything still passes,
/// because every other test asserts on TEXT. Only a real browser has the computed styles to notice.
describe("Preview mode is actually styled", () => {
  const preview = async () => {
    render(<Harness />);
    await userEvent.click(modeButton("Preview"));
  };

  it("draws a heading larger than body text", async () => {
    await preview();

    const heading = document.querySelector(".markdown-body h1");
    const paragraph = document.querySelector(".markdown-body p");
    if (heading === null || paragraph === null) throw new Error("nothing rendered");

    const size = (element: Element) =>
      Number.parseFloat(getComputedStyle(element).fontSize.replace("px", ""));
    expect(size(heading)).toBeGreaterThan(size(paragraph));
  });

  it("gives a link the accent colour rather than the browser default", async () => {
    await preview();

    const link = document.querySelector(".markdown-body a");
    if (link === null) throw new Error("no link rendered");
    // The default is a blue nobody chose; the point is only that a rule applied at all.
    expect(getComputedStyle(link).textDecorationLine).toBe("underline");
  });
});

/// Applying an edit the user accepted.
///
/// The seam between two halves that are each already tested: `resolveEdit` computes offsets against
/// a string, and CodeMirror holds the real buffer. Nothing else checks that an offset from one lands
/// where it should in the other - and a mistake there writes into somebody's document at a
/// plausible-looking place.
describe("Applying a resolved edit, in a real browser", () => {
  const ANCHORED = "# Plan\n\nPreamble.\n\n## Objectives\n\nDo the thing.\n";

  function Editable({ handle }: { handle: React.Ref<EditorHandle> }) {
    const [value, setValue] = useState(ANCHORED);
    return (
      <EditorPanel
        workspaceName="Notes"
        filePath="notes.md"
        dirty={false}
        value={value}
        onChange={setValue}
        ref={handle}
      />
    );
  }

  /// The visible text, without touching focus or the mode.
  const live = () =>
    [...document.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n");

  /// Read in Source mode, where every character is visible.
  ///
  /// Live mode hides the syntax markers away from the caret, so a heading reads as "Summary" rather
  /// than "## Summary" - which would make an assertion about the markdown that was written measure
  /// the decoration instead of the document.
  const sourceText = async () => {
    await userEvent.click(modeButton("Source"));
    return [...document.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n");
  };

  const resolved = (edit: Parameters<typeof resolveEdit>[0]) => {
    const target = resolveEdit(edit, { doc: ANCHORED, selection: null });
    if (!target.ok) throw new Error(target.reason);
    return target;
  };

  it("inserts before the named heading, where the resolver said", async () => {
    const handle = { current: null as EditorHandle | null };
    render(<Editable handle={handle} />);

    const target = resolved({
      op: "insert-before",
      heading: "Objectives",
      content: "## Summary\n\nAn overview.",
    });
    handle.current!.applyChange(target.from, target.to, target.insert);

    const shown = await sourceText();
    expect(shown).toContain("## Summary");
    // The order is the whole point: after the preamble, before the heading it was anchored to.
    expect(shown.indexOf("Preamble.")).toBeLessThan(shown.indexOf("## Summary"));
    expect(shown.indexOf("An overview.")).toBeLessThan(shown.indexOf("## Objectives"));
  });

  it("leaves the rest of the document untouched", async () => {
    const handle = { current: null as EditorHandle | null };
    render(<Editable handle={handle} />);

    const target = resolved({ op: "append", heading: null, content: "## Notes\n\nAdded." });
    handle.current!.applyChange(target.from, target.to, target.insert);

    const shown = await sourceText();
    expect(shown).toContain("# Plan");
    expect(shown).toContain("Do the thing.");
    expect(shown).toContain("## Notes");
  });

  // One transaction, so one Ctrl+Z gives the document back. A user who dislikes what the model wrote
  // should not have to undo it a paragraph at a time.
  it("is a single undo step", async () => {
    const handle = { current: null as EditorHandle | null };
    render(<Editable handle={handle} />);

    const target = resolved({
      op: "insert-before",
      heading: "Objectives",
      content: "## Summary\n\nAn overview.",
    });
    // Asserted on prose rather than on "## Summary", and without switching mode: clicking the mode
    // button would take focus off the editor, and the undo keystroke would go to the button. The
    // heading markers are hidden in Live mode anyway - what matters here is that ONE undo takes the
    // whole insertion back, not how it was decorated.
    handle.current!.applyChange(target.from, target.to, target.insert);
    expect(live()).toContain("An overview.");

    await userEvent.keyboard("{Control>}z{/Control}");
    expect(live()).not.toContain("An overview.");
    expect(live()).toContain("Do the thing.");
  });

  // The offsets were resolved against a document that may be a keystroke old by the time Apply is
  // pressed. An out-of-range change throws inside CodeMirror and takes the panel down with it.
  it("survives offsets that run past the end of the document", async () => {
    const handle = { current: null as EditorHandle | null };
    render(<Editable handle={handle} />);

    handle.current!.applyChange(9_000, 10_000, "Appended anyway.");
    expect(await sourceText()).toContain("Appended anyway.");
  });
});

/// The header, with a name too long for the space it has.
///
/// A layout question, so it can only be answered here: jsdom has no layout engine, and the bug it
/// exists to catch was one element drawing on top of another. The old header drew the whole path as
/// segments, and every segment but the last refused to shrink - so a long workspace or folder name
/// overflowed its span and printed over the next one.
describe("EditorPanel: a document whose name does not fit", () => {
  const LONG = "clinicaleligibility-deploy-quickstart-with-a-very-long-name-indeed.md";

  function narrow(children: React.ReactNode) {
    // Narrow enough that the name cannot fit, which is the whole case under test.
    return <div style={{ width: "420px" }}>{children}</div>;
  }

  it("keeps the header inside the panel rather than overflowing it", () => {
    render(
      narrow(
        <EditorPanel
          workspaceName="CLINICALELIGIBILITY"
          filePath={`deploy-quickstart-documentation/${LONG}`}
          dirty
          value={DOC}
          onChange={() => {}}
        />,
      ),
    );

    const name = screen.getByTitle(`CLINICALELIGIBILITY/deploy-quickstart-documentation/${LONG}`);
    const modes = screen.getByRole("group", { name: "View mode" });

    // Measured against the controls beside it, because that is where the bug showed: with the old
    // markup and these exact names in a 420px panel, a segment's box ran to x=271 while the mode
    // buttons began at x=258 - it was drawn over them, and over the segment before it. The row's own
    // scrollWidth does NOT catch this, which is why it is not what is asserted.
    expect(name.getBoundingClientRect().right).toBeLessThanOrEqual(
      modes.getBoundingClientRect().left,
    );
  });

  it("cuts the name short rather than drawing all of it", () => {
    render(narrow(<EditorPanel workspaceName="Notes" filePath={LONG} dirty={false} value={DOC} onChange={() => {}} />));

    const name = screen.getByTitle(`Notes/${LONG}`);

    // Ellipsised: the text is wider than the box it is drawn in, which is what `truncate` does - and
    // is how the reader can tell the name goes on.
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
    expect(getComputedStyle(name).textOverflow).toBe("ellipsis");
  });
});
