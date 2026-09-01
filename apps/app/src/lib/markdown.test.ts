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
});
