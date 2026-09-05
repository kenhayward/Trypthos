import { describe, expect, it } from "vitest";
import { TOOLBAR_ACTIONS, toolbarEdit, type ToolbarAction } from "./markdownToolbar";

/// The toolbar's decisions, as data.
///
/// Every button is a pure function of the document and the selection, which is what makes the
/// awkward cases - a second press that removes what the first added, a marker that already sits
/// just outside the selection, a heading toggled between levels - testable without an editor. What
/// CodeMirror does with the answer is one dispatch, and nothing here needs a caret to measure.
///
/// Fixtures are written with `^` for the caret and `{...}` for a selection. Deliberately not `|` and
/// `[...]`: a pipe is a table's own punctuation and square brackets are a task item's, so either
/// would make the fixture for the construct being tested unreadable or simply wrong.

function apply(action: ToolbarAction, marked: string): string {
  const { doc, from, to } = parse(marked);
  const edit = toolbarEdit(action, doc, { from, to });

  const next = doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
  return mark(next, edit.selection.from, edit.selection.to);
}

function parse(marked: string): { doc: string; from: number; to: number } {
  const caret = marked.indexOf("^");
  if (caret !== -1) return { doc: marked.replace("^", ""), from: caret, to: caret };

  const open = marked.indexOf("{");
  const close = marked.indexOf("}");
  if (open === -1 || close === -1) throw new Error("No caret or selection in the fixture");
  const doc = marked.slice(0, open) + marked.slice(open + 1, close) + marked.slice(close + 1);
  return { doc, from: open, to: close - 1 };
}

function mark(doc: string, from: number, to: number): string {
  if (from === to) return `${doc.slice(0, from)}^${doc.slice(from)}`;
  return `${doc.slice(0, from)}{${doc.slice(from, to)}}${doc.slice(to)}`;
}

describe("toolbar actions", () => {
  it("covers every markdown construct the app renders", () => {
    // A guard on the SET rather than on each name: the toolbar draws whatever is here, so an action
    // added without a glyph or a label is caught by the renderer's own test, and one removed here
    // takes its button with it.
    expect([...TOOLBAR_ACTIONS]).toEqual([
      "bold",
      "italic",
      "strikethrough",
      "code",
      "link",
      "image",
      "heading1",
      "heading2",
      "heading3",
      "quote",
      "bulletList",
      "orderedList",
      "taskList",
      "codeBlock",
      "table",
      "rule",
    ]);
  });
});

describe("inline formatting", () => {
  it("wraps the selected text and keeps it selected", () => {
    expect(apply("bold", "make {this} bold")).toBe("make **{this}** bold");
    expect(apply("italic", "make {this} italic")).toBe("make *{this}* italic");
    expect(apply("strikethrough", "make {this} gone")).toBe("make ~~{this}~~ gone");
    expect(apply("code", "make {this} code")).toBe("make `{this}` code");
  });

  // The second press undoes the first. Without this a toolbar is a one-way trip: the only way back
  // is to delete the markers by hand, which is exactly what the button existed to avoid.
  it("unwraps a selection that already carries the markers", () => {
    expect(apply("bold", "make {**this**} plain")).toBe("make {this} plain");
    expect(apply("code", "make {`this`} plain")).toBe("make {this} plain");
  });

  // Double-clicking a word selects the word, not its markers - so the markers this has to find are
  // the ones just OUTSIDE the selection. Missing this case is what makes a bold button that only
  // ever adds more asterisks.
  it("unwraps markers that sit just outside the selection", () => {
    expect(apply("bold", "make **{this}** plain")).toBe("make {this} plain");
    expect(apply("strikethrough", "make ~~{this}~~ plain")).toBe("make {this} plain");
  });

  // One asterisk each side of a bold span is bold's own punctuation. Stripping it as italic leaves
  // `*this*`, which is a different word in a different style - and the text looks plausible enough
  // afterwards that nobody notices until the file is read back.
  it("does not mistake bold's asterisks for italics", () => {
    expect(apply("italic", "make {**this**} italic")).toBe("make *{**this**}* italic");
  });

  it("takes the word under the caret when nothing is selected", () => {
    expect(apply("bold", "make th^is bold")).toBe("make **{this}** bold");
    expect(apply("italic", "make **th^is** plain")).toBe("make ***{this}*** plain");
  });

  // Nothing to wrap, so the markers go in with the caret between them and the user types into it.
  it("opens an empty pair when the caret is on nothing", () => {
    expect(apply("bold", "make it: ^")).toBe("make it: **^**");
    expect(apply("code", "^")).toBe("`^`");
  });
});

describe("links and images", () => {
  it("turns the selection into a link and selects the address to type over", () => {
    expect(apply("link", "see {the docs} for more")).toBe("see [the docs]({url}) for more");
  });

  it("uses the word under the caret as the link text", () => {
    expect(apply("link", "see doc^s here")).toBe("see [docs]({url}) here");
  });

  it("offers both halves when there is nothing to name", () => {
    expect(apply("link", "see ^")).toBe("see [{text}](url)");
    expect(apply("image", "see ^")).toBe("see ![{alt}](url)");
  });

  it("unlinks a selected link rather than nesting another inside it", () => {
    expect(apply("link", "see {[the docs](https://example.com)} here")).toBe("see {the docs} here");
  });
});

describe("headings", () => {
  it("adds the heading marker to the line the caret is on", () => {
    expect(apply("heading1", "Ti^tle\n\nBody")).toBe("# Ti^tle\n\nBody");
    expect(apply("heading3", "Ti^tle")).toBe("### Ti^tle");
  });

  // Pressing the level a line already is takes it off. Pressing a different level changes it, which
  // is one button behaving as a switch between levels rather than a stack of markers.
  it("toggles the level off, and swaps between levels", () => {
    expect(apply("heading1", "# Ti^tle")).toBe("Ti^tle");
    expect(apply("heading2", "# Ti^tle")).toBe("## Ti^tle");
    expect(apply("heading1", "### Ti^tle")).toBe("# Ti^tle");
  });

  it("applies to every line the selection touches, and keeps them selected", () => {
    expect(apply("heading2", "{One\nTwo}")).toBe("{## One\n## Two}");
  });

  it("takes the level off only when every line already has it", () => {
    expect(apply("heading2", "{## One\nTwo}")).toBe("{## One\n## Two}");
    expect(apply("heading2", "{## One\n## Two}")).toBe("{One\nTwo}");
  });
});

describe("lists and quotes", () => {
  it("prefixes every line in the selection", () => {
    expect(apply("bulletList", "{one\ntwo}")).toBe("{- one\n- two}");
    expect(apply("taskList", "{one\ntwo}")).toBe("{- [ ] one\n- [ ] two}");
    expect(apply("quote", "{one\ntwo}")).toBe("{> one\n> two}");
  });

  it("numbers an ordered list from one", () => {
    expect(apply("orderedList", "{one\ntwo\nthree}")).toBe("{1. one\n2. two\n3. three}");
  });

  it("removes the prefix when every line already has it", () => {
    expect(apply("bulletList", "{- one\n- two}")).toBe("{one\ntwo}");
    expect(apply("orderedList", "{1. one\n2. two}")).toBe("{one\ntwo}");
    expect(apply("quote", "{> one\n> two}")).toBe("{one\ntwo}");
  });

  // One list marker, not two. A line that is already a bullet has its marker REPLACED, so pressing
  // the numbered button on a bulleted list converts it rather than producing "- 1. one".
  it("replaces one list marker with another", () => {
    expect(apply("orderedList", "{- one\n- two}")).toBe("{1. one\n2. two}");
    expect(apply("bulletList", "{- [ ] one}")).toBe("{- one}");
  });

  it("keeps the indent of a nested item", () => {
    expect(apply("quote", "  ^one")).toBe("  > ^one");
  });

  it("moves the caret with the line it is on", () => {
    expect(apply("bulletList", "on^e")).toBe("- on^e");
    expect(apply("bulletList", "- on^e")).toBe("on^e");
  });
});

describe("blocks", () => {
  it("fences the selected lines", () => {
    expect(apply("codeBlock", "{one\ntwo}")).toBe("```\n{one\ntwo}\n```");
  });

  it("unfences a block that is already fenced", () => {
    expect(apply("codeBlock", "{```\none\n```}")).toBe("{one}");
  });

  it("opens an empty fence when there is nothing to fence", () => {
    expect(apply("codeBlock", "^")).toBe("```\n^\n```");
  });

  it("puts a rule below the line the caret is on", () => {
    expect(apply("rule", "Bo^dy")).toBe("Body\n\n---\n\n^");
  });

  it("uses the line the caret is on when it is empty", () => {
    expect(apply("rule", "^")).toBe("---\n\n^");
  });

  it("inserts a table with its first heading ready to type over", () => {
    expect(apply("table", "^")).toBe("| {Heading} | Heading |\n| --- | --- |\n| Cell | Cell |\n");
  });
});
