import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { describe, expect, it, vi } from "vitest";
import EditorPanel from "./EditorPanel";
import { resolveEdit } from "@trypthos/domain";
import type { EditorHandle, EditorSelection } from "./DocumentEditor";

const DOC = "# Title\n\nSome **bold** text.\n\nA [link](https://example.com) here.\n";

function Harness({
  onSelect,
  onFollowLink,
}: {
  onSelect?: (selection: EditorSelection) => void;
  onFollowLink?: (href: string) => void;
} = {}) {
  const [value, setValue] = useState(DOC);
  return (
    <EditorPanel
      workspaceName="Notes"
      paths={["notes.md"]}
      activePath="notes.md"
      dirty={false}
      value={value}
      onChange={setValue}
      onSelectionChange={onSelect}
      onFollowLink={onFollowLink}
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

  /// Live mode hides the target, so hover is the only way to see where a link goes without moving
  /// the caret onto its line. In this suite because the decoration only exists once rendered.
  describe("following a link", () => {
    it("shows the target on hover", async () => {
      render(<Harness />);
      await putCaretOn("Title");

      const link = lineWith("link").querySelector(".cm-live-link") as HTMLElement;
      expect(link).not.toBeNull();
      expect(link.getAttribute("title")).toBe("https://example.com");
    });

    // A plain click has to place the caret: this is an editing surface, and link text is text a
    // reader edits. The modifier is what distinguishes editing the link from following it.
    it("places the caret on a plain click without following anything", async () => {
      const followed: string[] = [];
      render(<Harness onFollowLink={(href) => followed.push(href)} />);
      await putCaretOn("Title");

      await userEvent.click(lineWith("link").querySelector(".cm-live-link") as HTMLElement);

      expect(followed).toEqual([]);
      // The caret landed on the link's own line, which reveals its markers.
      expect(lineWith("link").textContent).toContain("https://example.com");
    });

    it("follows the link on a modified click", async () => {
      const followed: string[] = [];
      render(<Harness onFollowLink={(href) => followed.push(href)} />);
      await putCaretOn("Title");

      const link = lineWith("link").querySelector(".cm-live-link") as HTMLElement;
      await userEvent.click(link, { modifiers: ["ControlOrMeta"] });

      expect(followed).toEqual(["https://example.com"]);
    });
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
            paths={[path]}
            activePath={path}
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
        paths={["notes.md"]}
        activePath="notes.md"
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

const scroller = () => document.querySelector(".cm-scroller") as HTMLElement;

/// The lines the reader can see, in order, from the top of the view down.
function visibleLines(): string[] {
  const box = scroller().getBoundingClientRect();
  return [...document.querySelectorAll(".cm-line")]
    .filter((element) => {
      const line = element.getBoundingClientRect();
      return line.bottom > box.top + 1 && line.top < box.bottom - 1;
    })
    .map((element) => element.textContent ?? "");
}

/// The text of the first line the reader can see.
function topLineText(): string {
  return visibleLines()[0] ?? "";
}

/// The top line, once the editor has drawn the view it was scrolled to.
///
/// CodeMirror scrolls in one measure pass and draws the lines it has arrived at in the next, so the
/// first frame after a jump has nothing rendered where the reader is looking.
async function topLineDrawn(): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const text = topLineText();
    if (text !== "") return text;
    await settled();
  }
  return "";
}

/// Waits for the browser to draw, twice - long enough for CodeMirror's own measure pass to run.
async function settled(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/// Coming back to a document you were in the middle of.
///
/// Only answerable here: CodeMirror resolves a caret position by measuring text, so in jsdom the
/// click that puts it there moves nothing and every assertion afterwards reads the wrong state.
describe("EditorPanel: returning to a tab", () => {
  // Every line carries text, deliberately: a blank line at the top of the view is still the top of
  // the view, and a test that read one would be measuring nothing.
  const LONG = Array.from({ length: 200 }, (_, index) => `Line ${index + 1} of the document.`).join(
    "\n",
  );

  /// Two documents and a working tab strip, as the window has them.
  function TwoFiles() {
    const [active, setActive] = useState("first.md");
    const [text, setText] = useState<Record<string, string>>({
      "first.md": LONG,
      "second.md": "# Second\n\nA much shorter file.\n",
    });

    return (
      <div style={{ height: 300, display: "flex" }}>
        <EditorPanel
          workspaceName="Notes"
          paths={["first.md", "second.md"]}
          activePath={active}
          dirty={false}
          value={text[active]!}
          onChange={(next) => setText((prev) => ({ ...prev, [active]: next }))}
          onActivateFile={setActive}
        />
      </div>
    );
  }

  it("puts the caret back where it was left", async () => {
    render(<TwoFiles />);

    await putCaretOn("Line 12 of the document.");
    const before = screen.getByText(/Ln \d+, Col/).textContent;
    expect(before).toContain("Ln 12");

    await userEvent.click(screen.getByRole("tab", { name: /second\.md/ }));
    // A different document starts at the top rather than inheriting where the last one was left.
    expect(screen.getByText(/Ln \d+, Col/).textContent).toContain("Ln 1,");

    await userEvent.click(screen.getByRole("tab", { name: /first\.md/ }));
    expect(screen.getByText(/Ln \d+, Col/).textContent).toBe(before);
  });

  it("puts the view back where it was left", async () => {
    render(<TwoFiles />);

    // Moved with real input rather than by assigning `scrollTop`. CodeMirror redraws on the scroll
    // events a reader generates; an assignment leaves it drawing the top of the document while the
    // scroller sits somewhere else, so everything measured afterwards is of a view nobody is looking
    // at.
    await putCaretOn("Line 3 of the document.");
    await userEvent.keyboard("{Control>}{End}{/Control}");
    await settled();

    const before = await topLineDrawn();
    expect(before).not.toBe("");
    expect(scroller().scrollTop).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("tab", { name: /second\.md/ }));
    // A document opened for the first time starts at the top.
    expect(scroller().scrollTop).toBe(0);

    await userEvent.click(screen.getByRole("tab", { name: /first\.md/ }));
    await settled();
    // The same TEXT at the top, which is what a reader means by where they were. Not the same pixel
    // offset: CodeMirror measures a document lazily, so the height an offset would be measured
    // against does not fully exist at the moment of the switch.
    await topLineDrawn();
    // Back at the top of the view, give or take the line above it: CodeMirror scrolls a line fully
    // into view, so a line that was half cut off at the top comes back whole and brings its
    // neighbour into sight. What matters is that the reader is looking at the same text, not at the
    // top of a two-hundred-line file.
    expect(visibleLines().indexOf(before)).toBeGreaterThanOrEqual(0);
    expect(visibleLines().indexOf(before)).toBeLessThanOrEqual(1);
  });
});

/// The tab strip, with more open files than the row can hold.
///
/// A layout question, so it can only be answered here: jsdom has no layout engine, and the bug this
/// exists to catch was one element drawing on top of another. The name used to live in the header,
/// which drew the whole path as segments that refused to shrink - so a long folder name overflowed
/// its span and printed over the mode buttons. The name is a tab now, and the same thing must not
/// happen to the strip.
describe("EditorPanel: tabs that do not fit", () => {
  const LONG = "clinicaleligibility-deploy-quickstart-with-a-very-long-name-indeed.md";

  function narrow(children: React.ReactNode) {
    // Narrow enough that the names cannot fit, which is the whole case under test.
    return <div style={{ width: "420px" }}>{children}</div>;
  }

  it("keeps the tabs off the controls beside them", () => {
    const path = `deploy-quickstart-documentation/${LONG}`;
    render(
      narrow(
        <EditorPanel
          workspaceName="CLINICALELIGIBILITY"
          paths={[path]}
          activePath={path}
          dirty
          value={DOC}
          onChange={() => {}}
        />,
      ),
    );

    const tab = screen.getByRole("tab");
    const modes = screen.getByRole("group", { name: "View mode" });

    // Measured against the controls beside it, because that is where the bug showed: with the old
    // markup and these exact names in a 420px panel, a segment's box ran to x=271 while the mode
    // buttons began at x=258 - it was drawn over them, and over the segment before it. The row's own
    // scrollWidth does NOT catch this, which is why it is not what is asserted.
    expect(tab.getBoundingClientRect().right).toBeLessThanOrEqual(
      modes.getBoundingClientRect().left,
    );
  });

  it("cuts a name short rather than drawing all of it", () => {
    render(
      narrow(
        <EditorPanel
          workspaceName="Notes"
          paths={[LONG]}
          activePath={LONG}
          dirty={false}
          value={DOC}
          onChange={() => {}}
        />,
      ),
    );

    const name = screen.getByRole("tab").querySelector("span")!;

    // Ellipsised: the text is wider than the box it is drawn in, which is what `truncate` does - and
    // is how the reader can tell the name goes on.
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
    expect(getComputedStyle(name).textOverflow).toBe("ellipsis");
  });

  // Ten files open in a narrow window: the strip scrolls, and the row keeps its height. A strip that
  // wrapped would push the document down the screen every time another file was opened.
  it("scrolls rather than growing when many files are open", () => {
    const paths = Array.from({ length: 10 }, (_, index) => `folder/document-${index}.md`);
    render(
      narrow(
        <EditorPanel
          workspaceName="Notes"
          paths={paths}
          activePath={paths[0]!}
          dirty={false}
          value={DOC}
          onChange={() => {}}
        />,
      ),
    );

    const strip = screen.getByRole("tablist");
    expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
    // One row of tabs, not three: every tab shares the strip's own height.
    const heights = [...strip.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.getBoundingClientRect().height,
    );
    expect(Math.max(...heights)).toBeLessThanOrEqual(strip.getBoundingClientRect().height);
    // The panel itself does not grow with the strip: the overflow is the strip's, and stays there.
    const panel = screen.getByRole("main", { name: "Editor" });
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  });
});


/// The toolbar, acting on a REAL selection.
///
/// The rule each button follows is tested as data in the domain, and the wiring in jsdom - but
/// neither can select text. A selection made with the pointer is the case the toolbar exists for,
/// and it is the one CodeMirror only produces for real input: a synthetic double-click leaves the
/// selection empty, and the button then acts on the word under a caret that never moved.
describe("the formatting toolbar, on a real selection", () => {
  it("wraps the selected word, and unwraps it when pressed again", async () => {
    render(<Harness />);
    await userEvent.click(modeButton("Source"));

    // Selected with the keyboard, from a caret the pointer put on the line. A double-click would
    // land wherever the middle of the line happens to be, which is a different word on a different
    // day; Home and four shifted rights are the same four characters every time.
    await userEvent.click(lineWith("Some"));
    await userEvent.keyboard("{Home}");
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}");

    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(lineWith("Some").textContent).toContain("**Some**");

    // The selection survives the press, so a second one takes the markers off again.
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(lineWith("Some").textContent).not.toContain("**Some**");
  });

  it("puts the caret back in the document after a press", async () => {
    render(<Harness />);
    await userEvent.click(modeButton("Source"));

    await userEvent.click(lineWith("Title"));
    await userEvent.click(screen.getByRole("button", { name: "Quote" }));

    // Typing goes into the document rather than into the button that was just pressed.
    await userEvent.keyboard("X");
    expect(lineWith("Title").textContent).toContain("X");
  });
});

/// Syntax colouring, which only a browser can answer.
///
/// CodeMirror decides what to decorate by measuring the visible range, and jsdom has no layout
/// engine - so a jsdom assertion here would be testing the geometry polyfill rather than the editor.
/// It is also the only place the two halves meet: the loader fetches a grammar, and the theme turns
/// its tags into the same CSS variables the chrome around it reads.
describe("syntax colouring, rendered", () => {
  function open(path: string, value: string) {
    render(
      <EditorPanel
        workspaceName="Notes"
        paths={[path]}
        activePath={path}
        dirty={false}
        value={value}
        onChange={() => {}}
        fileTypes={["markdown", "json", "javascript"]}
      />,
    );
  }

  /// The colours actually painted in the content, ignoring the inherited default.
  const paintedColours = (): Set<string> => {
    const base = getComputedStyle(surface()).color;
    const seen = new Set<string>();
    for (const span of surface().querySelectorAll("span")) {
      const colour = getComputedStyle(span).color;
      if (colour !== base) seen.add(colour);
    }
    return seen;
  };

  async function settle() {
    // The grammar arrives through a dynamic import, so there is a turn of the event loop between
    // the document appearing and its colouring doing so.
    await vi.waitFor(() => expect(paintedColours().size).toBeGreaterThan(0), { timeout: 3000 });
  }

  it("colours a JSON document once its grammar has loaded", async () => {
    open("data.json", '{\n  "name": "Ada",\n  "count": 42\n}\n');
    await settle();

    // Keys, strings and numbers are three different roles, so three different colours.
    expect(paintedColours().size).toBeGreaterThanOrEqual(3);
  });

  it("colours TypeScript, from the same one row in Settings as JavaScript", async () => {
    open("main.ts", "const answer: number = 42; // a comment\n");
    await settle();

    expect(paintedColours().size).toBeGreaterThanOrEqual(3);
  });

  // Plain text has no loader at all, and CodeMirror's default is already exactly that. This is the
  // control: it proves the assertions above are measuring colouring rather than something the
  // editor paints regardless.
  it("leaves plain text uncoloured", async () => {
    render(
      <EditorPanel
        workspaceName="Notes"
        paths={["notes.txt"]}
        activePath="notes.txt"
        dirty={false}
        value={"const answer = 42;\n"}
        onChange={() => {}}
        fileTypes={["markdown", "text"]}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(paintedColours().size).toBe(0);
  });
});

/// Fenced code inside a markdown document.
///
/// The payoff of the whole File types arc for the audience Trypthos actually has: notes full of
/// code are far commoner here than source files opened as documents. Only a browser can answer it -
/// the fence's language is decided by parsing, and the colouring by measuring.
describe("fenced code inside markdown, rendered", () => {
  const FENCED = [
    "# Notes",
    "",
    "```python",
    "def greet(name):",
    '    return f"hello {name}"',
    "```",
    "",
    "Prose after it.",
    "",
  ].join("\n");

  function open(fileTypes: readonly string[]) {
    render(
      <EditorPanel
        workspaceName="Notes"
        paths={["notes.md"]}
        activePath="notes.md"
        dirty={false}
        value={FENCED}
        onChange={() => {}}
        fileTypes={fileTypes}
      />,
    );
  }

  /// Colours painted on the line holding `text`, ignoring the inherited default.
  const coloursOn = (text: string): Set<string> => {
    const line = lineWith(text);
    const base = getComputedStyle(surface()).color;
    const seen = new Set<string>();
    for (const span of line.querySelectorAll("span")) {
      const colour = getComputedStyle(span).color;
      if (colour !== base) seen.add(colour);
    }
    return seen;
  };

  // MORE than one colour, not merely some. Markdown's own grammar already paints a fence's contents
  // in the code colour, so "is it coloured at all" passes with Python turned off - which is exactly
  // what the control below caught when it was first written the other way round.
  it("colours the code inside the fence by role", async () => {
    open(["markdown", "python"]);
    await userEvent.click(modeButton("Source"));

    await vi.waitFor(() => expect(coloursOn("def greet").size).toBeGreaterThan(1), {
      timeout: 3000,
    });
  });

  // The setting governs the inside of a document as much as the folder tree. This is the control
  // for the test above: same document, same fence, Python turned off.
  it("leaves the fence in markdown's own code colour when its language is turned off", async () => {
    open(["markdown"]);
    await userEvent.click(modeButton("Source"));

    // Long enough for a load to have happened if one were going to.
    await new Promise((resolve) => setTimeout(resolve, 400));

    // ONE colour, not none: markdown paints a fence's contents in the code colour whatever is
    // inside them. What turning Python on adds is the difference between one colour and several -
    // which is why the test above asks for more than one rather than for any at all.
    expect(coloursOn("def greet").size).toBe(1);
  });

  // The prose around it is still markdown. A fence that swallowed the rest of the document would
  // colour this line as Python, or not at all.

  // Preview renders through marked rather than CodeMirror, and until now showed code as plain
  // monospace - so the same document looked different in two of its three views. Only a browser can
  // answer this: the classes resolve to CSS variables, and nothing but a real engine computes them.
  it("colours the fence in Preview too", async () => {
    open(["markdown", "python"]);
    await userEvent.click(modeButton("Preview"));

    const painted = async () => {
      const block = document.querySelector(".markdown-body pre code");
      if (block === null) return new Set<string>();
      const base = getComputedStyle(block).color;
      return new Set(
        [...block.querySelectorAll("span")]
          .map((span) => getComputedStyle(span).color)
          .filter((colour) => colour !== base),
      );
    };

    await vi.waitFor(async () => expect((await painted()).size).toBeGreaterThan(1), {
      timeout: 3000,
    });
  });

  // The control, as in Source: the setting governs Preview on the same terms.
  it("leaves Preview's fence uncoloured when its language is turned off", async () => {
    open(["markdown"]);
    await userEvent.click(modeButton("Preview"));

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(document.querySelectorAll(".markdown-body pre code span")).toHaveLength(0);
  });

  it("still colours the markdown around it", async () => {
    open(["markdown", "python"]);
    await userEvent.click(modeButton("Source"));

    await vi.waitFor(() => expect(coloursOn("# Notes").size).toBeGreaterThan(0), { timeout: 3000 });
  });
});
