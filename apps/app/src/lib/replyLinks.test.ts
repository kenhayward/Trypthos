import { describe, expect, it } from "vitest";
import { linkifyPaths } from "./replyLinks";
import { renderMarkdown } from "./markdown";

/// Making the file paths in a reply clickable.
///
/// A model names files in backticks - it is how every model writes a path - and until now those were
/// text you had to go and find in the tree yourself. This turns the ones the app could actually open
/// into links, and leaves everything else exactly as it was.
///
/// Replies only. A user's own document says what it says, and quietly turning its code spans into
/// links would change how their prose reads.

const TYPES = ["markdown", "typescript", "javascript", "python"];

function rendered(source: string, fileTypes: readonly string[] = TYPES) {
  const container = document.createElement("div");
  container.innerHTML = renderMarkdown(source);
  linkifyPaths(container, fileTypes);
  return container;
}

const links = (container: HTMLElement) =>
  [...container.querySelectorAll("a[data-md-link]")].map((a) => a.getAttribute("href"));

describe("linkifyPaths", () => {
  it("makes a file path in backticks a link", () => {
    expect(links(rendered("Look at `notes/plan.md` for that."))).toEqual(["notes/plan.md"]);
  });

  it("makes a bare file name a link", () => {
    expect(links(rendered("It is in `README.md`."))).toEqual(["README.md"]);
  });

  // The click handler is the one that already exists, and it matches on this attribute. Reusing it
  // is the whole point: a path in a reply then opens exactly as a markdown link to it would.
  it("marks them so the app's own link handler picks them up", () => {
    const anchor = rendered("See `notes/plan.md`.").querySelector("a")!;
    expect(anchor.hasAttribute("data-md-link")).toBe(true);
    expect(anchor.querySelector("code")?.textContent).toBe("notes/plan.md");
  });

  // What stops this turning prose into links. None of these is a file, and `linkAction` - the same
  // rule the rest of the app follows - says so.
  it("leaves anything that is not an openable file alone", () => {
    for (const code of ["npm run build", "and/or", "x = 1", "--force", "1/2"]) {
      expect(links(rendered(`Try \`${code}\` first.`))).toEqual([]);
    }
  });

  // The file-types setting decides here as it does everywhere else, or the reply and the tree would
  // disagree about the same file.
  it("leaves a path alone when its type is turned off", () => {
    expect(links(rendered("Look at `main.py`.", ["markdown"]))).toEqual([]);
    expect(links(rendered("Look at `main.py`.", ["markdown", "python"]))).toEqual(["main.py"]);
  });

  // A fenced block is code being shown, not a file being named. Linkifying inside one would also
  // fight the syntax colouring, which has already taken the block apart into spans.
  it("leaves a fenced code block alone", () => {
    const container = rendered("```\nnotes/plan.md\n```\n");
    expect(links(container)).toEqual([]);
  });

  it("leaves a path that is already a link alone", () => {
    const container = rendered("See [the plan](notes/plan.md).");
    expect(links(container)).toEqual(["notes/plan.md"]);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  // Run again on the same reply - which happens on every streamed token - and nothing doubles up.
  it("can be run twice over the same reply", () => {
    const container = rendered("See `notes/plan.md`.");
    linkifyPaths(container, TYPES);

    expect(links(container)).toEqual(["notes/plan.md"]);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  // The text is the model's, and it must survive exactly. Wrapped, never rewritten.
  it("changes not one character of the reply", () => {
    const source = "Look at `notes/plan.md` and `main.py` for that.";
    // Trimmed only for the newline the markdown renderer puts after a paragraph, which was there
    // before this ran and is nothing to do with it.
    expect(rendered(source).textContent?.trim()).toBe(
      "Look at notes/plan.md and main.py for that.",
    );
  });

  // A path is not markup, and the place somebody would accidentally unescape it is exactly here.
  it("keeps markup in a code span as text", () => {
    const container = rendered("Try `<script>alert(1)</script>` no.");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  // A web address in backticks is a link too - the same question, answered by the same rule.
  it("makes a web address in backticks a link", () => {
    expect(links(rendered("See `https://example.com/docs`."))).toEqual([
      "https://example.com/docs",
    ]);
  });

  // The rule that keeps a reply from reaching outside the workspace is `linkAction`'s, and it is
  // the same one every other surface uses.
  it("refuses a path that climbs out of the workspace", () => {
    expect(links(rendered("Look at `../../etc/passwd.md`."))).toEqual([]);
  });
});
