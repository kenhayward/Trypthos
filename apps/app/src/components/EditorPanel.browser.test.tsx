import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { describe, expect, it } from "vitest";
import EditorPanel from "./EditorPanel";

const DOC = "# Title\n\nSome **bold** text.\n\nA [link](https://example.com) here.\n";

function Harness({ onSelect }: { onSelect?: (text: string) => void } = {}) {
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
    const seen: string[] = [];
    render(<Harness onSelect={(text) => seen.push(text)} />);

    await putCaretOn("Some");

    // A click sets an empty selection. Reported, and reported as empty - which is what makes chat
    // fall back to the whole file rather than sending nothing.
    expect(seen.at(-1)).toBe("");
  });

  it("reports the text once a selection is made", async () => {
    const seen: string[] = [];
    render(<Harness onSelect={(text) => seen.push(text)} />);

    await putCaretOn("Some");
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}");

    expect(seen.at(-1)?.length).toBe(4);
  });

  it("reports the selection emptying again when it is collapsed", async () => {
    const seen: string[] = [];
    render(<Harness onSelect={(text) => seen.push(text)} />);

    await putCaretOn("Some");
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
    expect(seen.at(-1)).not.toBe("");

    await userEvent.keyboard("{ArrowRight}");
    expect(seen.at(-1)).toBe("");
  });

  it("reports the whole document when everything is selected", async () => {
    const seen: string[] = [];
    render(<Harness onSelect={(text) => seen.push(text)} />);

    await putCaretOn("Some");
    await userEvent.keyboard("{Control>}a{/Control}");

    expect(seen.at(-1)).toBe(DOC);
  });
});
