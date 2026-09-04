import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders headings, emphasis and code", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** and `code`.");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("renders lists and blockquotes", () => {
    const html = renderMarkdown("- one\n- two\n\n> quoted");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<blockquote>");
  });

  it("renders fenced code blocks", () => {
    expect(renderMarkdown("```ts\nconst a = 1;\n```")).toContain("<pre>");
  });

  it("returns empty output for empty input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   ")).toBe("");
  });

  // Preview renders whatever is in the user's file, and a markdown file is untrusted input like any
  // other. These are the cases that turn a preview pane into script execution inside the app.
  it("strips script tags", () => {
    const html = renderMarkdown("Hello\n\n<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("Hello");
  });

  it("strips inline event handlers", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("strips javascript: URLs", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("keeps ordinary links and their text", () => {
    const html = renderMarkdown("[docs](https://example.com/a)");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain("docs");
  });

  it("keeps relative links, which address files in the workspace", () => {
    expect(renderMarkdown("[notes](./notes.md)")).toContain('href="./notes.md"');
  });

  // Every anchor this renderer emits is marked, and that mark is what the click handler matches on.
  // The alternative - matching on the container's class - would have to name each surface that
  // renders markdown, and the one added next would quietly navigate the window instead.
  describe("links", () => {
    it("marks the links it emits", () => {
      expect(renderMarkdown("[docs](https://example.com)")).toContain("data-md-link");
    });

    it("shows the target on hover", () => {
      expect(renderMarkdown("[docs](https://example.com/a)")).toContain(
        'title="https://example.com/a"',
      );
      expect(renderMarkdown("[notes](../notes.md)")).toContain('title="../notes.md"');
    });

    it("keeps a title the author wrote, which says more than the target does", () => {
      const html = renderMarkdown('[docs](https://example.com "The manual")');
      expect(html).toContain('title="The manual"');
    });

    it("renders the link text as markdown, as it did before", () => {
      expect(renderMarkdown("[**bold** link](https://example.com)")).toContain(
        "<strong>bold</strong>",
      );
    });

    it("marks an image's link without giving the image a title", () => {
      // An image is a different token and must not pick up the anchor treatment.
      const html = renderMarkdown("![alt](diagram.png)");
      expect(html).toContain("<img");
      expect(html).not.toContain("data-md-link");
    });
  });
});
