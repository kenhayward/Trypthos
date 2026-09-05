import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";
import { TOKEN_ROLES } from "./editorTheme";
import { highlightCodeBlocks } from "./codeHighlight";
import { renderMarkdown } from "./markdown";

const ALL = ["markdown", "python", "json", "javascript"];

/// Renders markdown the way a surface does, then highlights it the way the effect does.
async function rendered(source: string, fileTypes: readonly string[] = ALL) {
  const container = document.createElement("div");
  container.innerHTML = renderMarkdown(source);
  await highlightCodeBlocks(container, fileTypes, () => false);
  return container;
}

const block = (container: HTMLElement) => container.querySelector("pre > code")!;
const classesIn = (container: HTMLElement) =>
  new Set([...block(container).querySelectorAll("span")].map((span) => span.className));

const PYTHON = ["```python", "def greet(name):", '    return "hi"  # a comment', "```", ""].join("\n");

describe("highlightCodeBlocks", () => {
  // Preview renders through marked rather than CodeMirror, so this is the only thing that makes the
  // same document look the same in Source and in Preview.
  it("marks up a fenced block by role", async () => {
    const classes = classesIn(await rendered(PYTHON));

    expect(classes).toContain("tp-tok-keyword");
    expect(classes).toContain("tp-tok-string");
    expect(classes).toContain("tp-tok-comment");
  });

  // The whole point of doing this over the DOM rather than in the renderer: the text is the user's,
  // and it must survive a round trip through the highlighter exactly.
  it("changes not one character of the code", async () => {
    const container = await rendered(PYTHON);
    expect(block(container).textContent).toBe('def greet(name):\n    return "hi"  # a comment\n');
  });

  // Markup in a code block is TEXT. It arrives escaped from the renderer, and rebuilding the block
  // by hand is exactly where somebody would accidentally unescape it.
  //
  // The language must be one that is ON, or this passes for the wrong reason: a block nothing
  // colours is never taken apart, so it proves nothing about how it is put back together. The
  // markup therefore sits inside a Python comment, which the highlighter does wrap in a span.
  it("keeps markup inside a block as text, never as elements", async () => {
    const container = await rendered("```python\nx = 1  # <script>alert(1)</script>\n```\n");

    expect(block(container).querySelector("span")).not.toBeNull();
    expect(block(container).querySelector("script")).toBeNull();
    expect(block(container).textContent).toContain("<script>alert(1)</script>");
  });

  // The setting governs this as it governs everything else: a fence naming a language that is off
  // reads as a code block and nothing more.
  it("leaves a block alone when its language is turned off", async () => {
    const container = await rendered(PYTHON, ["markdown"]);
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });

  it("leaves a block alone when its fence names nothing", async () => {
    const container = await rendered("```\nplain\n```\n");
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });

  it("leaves a block alone when its fence names a language nobody has", async () => {
    const container = await rendered("```klingon\nnuqneH\n```\n");
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });

  it("handles several blocks in one document, in different languages", async () => {
    const container = await rendered(
      ["```python", "x = 1", "```", "", "```json", '{ "a": 1 }', "```", ""].join("\n"),
    );
    const blocks = [...container.querySelectorAll("pre > code")];

    expect(blocks).toHaveLength(2);
    for (const one of blocks) expect(one.querySelectorAll("span").length).toBeGreaterThan(0);
  });

  // A second pass must not double-wrap what the first already marked up. The surfaces re-render for
  // reasons that have nothing to do with the document - a streaming reply does it constantly.
  it("does nothing the second time it is asked", async () => {
    const container = await rendered(PYTHON);
    const before = block(container).innerHTML;

    await highlightCodeBlocks(container, ALL, () => false);
    expect(block(container).innerHTML).toBe(before);
  });

  // The document can be replaced while a grammar is still loading - a tab switch, or the next
  // token of a streaming reply. Writing into it then would paint one document's colouring onto
  // another's text.
  it("writes nothing once it has been cancelled", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown(PYTHON);

    await highlightCodeBlocks(container, ALL, () => true);
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });

  it("does not throw on a container holding no code at all", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown("Just prose.\n");
    await expect(highlightCodeBlocks(container, ALL, () => false)).resolves.toBeUndefined();
  });
});

/// Every role the highlighter can emit must have a rule that resolves it.
///
/// Invisible when broken, which is why it is asserted: a role added to `TOKEN_ROLES` without a
/// matching rule in `index.css` produces a span with a class nothing styles. The code renders, the
/// tests pass, and that one token is simply the inherited colour - in a block full of colours,
/// which is precisely where nobody notices.
describe("the token classes", () => {
  const css = readFileSync(repoPath("apps", "app", "src", "index.css"), "utf8");
  const styled = new Set([...css.matchAll(/\.tp-tok-([a-z]+)\s*\{/g)].map((match) => match[1]!));
  const roles = [...new Set(TOKEN_ROLES.map((entry) => entry.role))];

  it("has a rule for every role in the table", () => {
    expect(roles.filter((role) => !styled.has(role))).toEqual([]);
  });

  // The other direction: a rule left behind after a role was removed is a class nothing emits, and
  // the stylesheet stops being a reliable inventory of what the app can draw.
  it("has no rule for a role the table does not name", () => {
    const named = new Set<string>(roles);
    expect([...styled].filter((role) => !named.has(role))).toEqual([]);
  });
});
