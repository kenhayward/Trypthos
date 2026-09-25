import { afterEach, describe, expect, it, vi } from "vitest";
import { clipboardMarkdown, htmlToMarkdown, readSystemClipboard } from "./pasteMarkdown";

/// Paste as markdown turns what was copied from a rendered page - a chat reply, a web page - back
/// into markdown source. Rendered text copied as plain text has lost its structure: headings are
/// ordinary lines, list markers are gone, and paragraphs run together. The HTML on the clipboard
/// still has all of it, so that is what is read.
describe("htmlToMarkdown", () => {
  it("keeps headings, paragraphs and emphasis", () => {
    const html =
      "<h2>Plan</h2><p>First <strong>bold</strong> and <em>italic</em>.</p><p>Second paragraph.</p>";

    expect(htmlToMarkdown(html)).toBe(
      "## Plan\n\nFirst **bold** and *italic*.\n\nSecond paragraph.",
    );
  });

  it("keeps bulleted and numbered lists", () => {
    const html = "<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>";

    expect(htmlToMarkdown(html)).toBe("- one\n- two\n\n1. first\n2. second");
  });

  it("nests a list inside a list", () => {
    const html = "<ul><li>outer<ul><li>inner</li></ul></li><li>next</li></ul>";

    expect(htmlToMarkdown(html)).toBe("- outer\n  - inner\n- next");
  });

  // The list spacing is a rule about list items, not a pass over the output: the same characters
  // inside a code block are the user's text and must arrive exactly as they were.
  it("leaves list-like lines inside a code block alone", () => {
    const html = "<pre><code>-   spaced\n1.  also</code></pre>";

    expect(htmlToMarkdown(html)).toBe("```\n-   spaced\n1.  also\n```");
  });

  it("writes code blocks fenced, with their language", () => {
    const html =
      '<pre><code class="language-ts">const a = 1;\nconst b = 2;\n</code></pre><p>After <code>a</code>.</p>';

    expect(htmlToMarkdown(html)).toBe(
      "```ts\nconst a = 1;\nconst b = 2;\n```\n\nAfter `a`.",
    );
  });

  it("keeps links and tables", () => {
    const html =
      '<p><a href="https://example.com">Example</a></p>' +
      "<table><thead><tr><th>Name</th><th>Role</th></tr></thead>" +
      "<tbody><tr><td>Ada</td><td>Author</td></tr></tbody></table>";

    expect(htmlToMarkdown(html)).toBe(
      "[Example](https://example.com)\n\n| Name | Role |\n| --- | --- |\n| Ada | Author |",
    );
  });

  // A rendered code block usually carries a Copy button, and a page can carry script and style. None
  // of that is content, and every one of them would otherwise arrive as stray words in the document.
  it("drops buttons, scripts and styles", () => {
    const html =
      "<style>p { color: red }</style><div><button>Copy</button><pre><code>x</code></pre></div>" +
      "<script>alert(1)</script>";

    expect(htmlToMarkdown(html)).toBe("```\nx\n```");
  });
});

describe("clipboardMarkdown", () => {
  it("prefers the HTML, which still has the structure", () => {
    expect(clipboardMarkdown({ html: "<h1>Title</h1><p>Body</p>", text: "Title Body" })).toBe(
      "# Title\n\nBody",
    );
  });

  // The Copy button on a chat reply puts the markdown itself on the clipboard, as text only - which
  // is already what the user wants, so it goes in as it came.
  it("uses the text when there is no HTML", () => {
    expect(clipboardMarkdown({ html: null, text: "# Title\n\n- item" })).toBe("# Title\n\n- item");
  });

  it("uses the text when the HTML has nothing in it", () => {
    expect(clipboardMarkdown({ html: "<meta charset='utf-8'>", text: "plain" })).toBe("plain");
  });

  // Unicode's own line and paragraph separators are not line breaks to CodeMirror, so text that uses
  // them arrives as one long line - exactly the symptom this feature exists to cure.
  it("turns Unicode line separators into line breaks", () => {
    expect(clipboardMarkdown({ html: null, text: "one\u2028two\u2029three" })).toBe(
      "one\ntwo\n\nthree",
    );
  });

  // What a spreadsheet puts on the clipboard as text: cells split by tabs, rows by line breaks, and a
  // cell holding a tab, a quote or a line break quoted. Some programs offer nothing else.
  it("turns tab-separated text into a table", () => {
    const text = 'Item\tQty\tNote\r\nApples\t12\t"Line one\nline two"\r\nPears\t3\t"Say ""hi"""\r\n';

    expect(clipboardMarkdown({ html: null, text })).toBe(
      '| Item | Qty | Note |\n| --- | --- | --- |\n| Apples | 12 | Line one<br>line two |\n| Pears | 3 | Say "hi" |',
    );
  });

  // Code indented with tabs has tabs on every line too. A table needs a cell before the first tab.
  it("leaves tab-indented text, and a single line, as text", () => {
    expect(clipboardMarkdown({ html: null, text: "\tone();\n\ttwo();" })).toBe("\tone();\n\ttwo();");
    expect(clipboardMarkdown({ html: null, text: "just\tone line" })).toBe("just\tone line");
    expect(clipboardMarkdown({ html: null, text: "a\tb\nc" })).toBe("a\tb\nc");
  });

  it("answers null when there is nothing to paste", () => {
    expect(clipboardMarkdown({ html: null, text: null })).toBeNull();
    expect(clipboardMarkdown({ html: "", text: "" })).toBeNull();
  });
});

describe("readSystemClipboard", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  });

  function clipboard(read: (options?: unknown) => Promise<unknown>) {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: vi.fn(read) } });
    return (navigator.clipboard as unknown as { read: ReturnType<typeof vi.fn> }).read;
  }

  const item = (types: Record<string, string>) => ({
    types: Object.keys(types),
    getType: async (type: string) => ({ text: async () => types[type]! }),
  });

  // The browser sanitises clipboard HTML by default, and its sanitiser rewrites the markup - Word's
  // list and style information does not survive it. The HTML is only ever parsed into an inert
  // document here, so the original is safe to ask for.
  it("asks for the HTML as the copying program wrote it", async () => {
    const read = clipboard(async () => [item({ "text/html": "<p>x</p>", "text/plain": "x" })]);

    expect(await readSystemClipboard()).toEqual({ html: "<p>x</p>", text: "x" });
    expect(read).toHaveBeenCalledWith({ unsanitized: ["text/html"] });
  });

  it("falls back to an ordinary read where that is refused", async () => {
    const read = clipboard(async (options) => {
      if (options !== undefined) throw new TypeError("unsupported");
      return [item({ "text/plain": "plain" })];
    });

    expect(await readSystemClipboard()).toEqual({ html: null, text: "plain" });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
