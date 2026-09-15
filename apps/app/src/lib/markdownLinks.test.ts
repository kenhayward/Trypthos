import { beforeEach, describe, expect, it, vi } from "vitest";
import { markdownLinkHandler } from "./markdownLinks";

/// Builds a rendered-markdown container holding `html`, and returns a click on the first anchor.
function clickOn(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);

  const anchor = container.querySelector("a");
  if (anchor === null) throw new Error("the fixture has no anchor");

  const preventDefault = vi.fn();
  return { anchor, container, event: { target: anchor, preventDefault }, preventDefault };
}

describe("markdownLinkHandler", () => {
  const openDocument = vi.fn();
  const openExternal = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = "";
    openDocument.mockReset();
    openExternal.mockReset();
  });

  const handler = (fromPath: string | null = null, fileTypes: readonly string[] = ["markdown"]) =>
    markdownLinkHandler({ fromPath, fileTypes, openDocument, openExternal });

  it("sends a web address to the browser instead of navigating the window", () => {
    const { event, preventDefault } = clickOn(
      '<a href="https://example.com/a" data-md-link="">docs</a>',
    );

    handler()(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/a");
    expect(openDocument).not.toHaveBeenCalled();
  });

  it("opens a markdown file in the workspace, resolved against the open document", () => {
    const { event, preventDefault } = clickOn('<a href="./two.md" data-md-link="">two</a>');

    handler("book/one.md")(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(openDocument).toHaveBeenCalledWith("book/two.md");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("does nothing at all for a target it will not follow - but still does not navigate", () => {
    const { event, preventDefault } = clickOn('<a href="diagram.png" data-md-link="">picture</a>');

    handler()(event);

    // preventDefault is the whole point of the refusal. Without it the window loads the file, which
    // is the bug - a link that goes nowhere must go nowhere, not somewhere.
    expect(preventDefault).toHaveBeenCalled();
    expect(openDocument).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("refuses a link that walks out of the workspace", () => {
    const { event } = clickOn('<a href="../../secrets.md" data-md-link="">up</a>');

    handler("book/one.md")(event);

    expect(openDocument).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("matches a click on something inside the link", () => {
    const { container, preventDefault } = clickOn(
      '<a href="https://example.com" data-md-link=""><strong>docs</strong></a>',
    );
    const inner = container.querySelector("strong");

    handler()({ target: inner, preventDefault });

    expect(openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("ignores a click that is not on a link", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>ordinary prose</p>";
    const preventDefault = vi.fn();

    handler()({ target: container.querySelector("p"), preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  // Anchors the app draws itself - a button, a row in the folder browser - are not this handler's
  // business, and intercepting one would break it in a way nothing else would catch.
  it("ignores an anchor this renderer did not emit", () => {
    const { event, preventDefault } = clickOn('<a href="https://example.com">elsewhere</a>');

    handler()(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  describe("in-page fragments", () => {
    it("scrolls to the element it names", () => {
      const { container, event, preventDefault } = clickOn(
        '<a href="#part-two" data-md-link="">part two</a>',
      );
      const heading = document.createElement("h2");
      heading.id = "part-two";
      const scrollIntoView = vi.fn();
      heading.scrollIntoView = scrollIntoView;
      container.append(heading);

      handler()(event);

      expect(preventDefault).toHaveBeenCalled();
      expect(scrollIntoView).toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    });

    it("does nothing when nothing on the page has that id", () => {
      const { event, preventDefault } = clickOn('<a href="#nowhere" data-md-link="">go</a>');

      handler()(event);

      // Still prevented: the default would put the fragment in the window's own address, which in a
      // frameless window with no address bar is a state with no way back out of it.
      expect(preventDefault).toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    });
  });
});

/// Obsidian's wiki links name a note, not a path - so following one is a search of the workspace
/// for that name, and a choice among what it finds.
describe("following a wiki link", () => {
  const openDocument = vi.fn();
  const openExternal = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = "";
    openDocument.mockReset();
    openExternal.mockReset();
  });

  function handlerFinding(found: string[]) {
    const findByName = vi.fn(async () => found);
    const handle = markdownLinkHandler({
      fromPath: "Notes/projects/today.md",
      fileTypes: ["markdown"],
      openDocument,
      openExternal,
      findByName,
    });
    return { handle, findByName };
  }

  it("searches its workspace for the note's name and opens the nearest match", async () => {
    const { handle, findByName } = handlerFinding(["Notes/Plan.md", "Notes/projects/Plan.md"]);
    const { event, preventDefault } = clickOn('<a href="Plan.md" data-md-link="" data-wikilink="Plan">Plan</a>');

    handle(event);

    expect(preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(openDocument).toHaveBeenCalledWith("Notes/projects/Plan.md"));
    expect(findByName).toHaveBeenCalledWith("Plan.md", "Notes");
  });

  it("follows a link that names folders from the workspace", async () => {
    const { handle } = handlerFinding(["Notes/archive/Plan.md", "Notes/Plan.md"]);
    const { event } = clickOn('<a href="archive/Plan.md" data-md-link="" data-wikilink="archive/Plan#Goals">x</a>');

    handle(event);

    await vi.waitFor(() => expect(openDocument).toHaveBeenCalledWith("Notes/archive/Plan.md"));
  });

  // No note by that name: the link is tried as a path, which is what reports that it is not there.
  it("falls back to the path beside the note when the search finds nothing", async () => {
    const { handle } = handlerFinding([]);
    const { event } = clickOn('<a href="Missing.md" data-md-link="" data-wikilink="Missing">Missing</a>');

    handle(event);

    await vi.waitFor(() => expect(openDocument).toHaveBeenCalledWith("Notes/projects/Missing.md"));
  });

  it("opens nothing the folder browser would not, like a picture", async () => {
    const { handle, findByName } = handlerFinding(["Notes/diagram.png"]);
    const { event } = clickOn('<a href="diagram.png" data-md-link="" data-wikilink="diagram.png">d</a>');

    handle(event);
    await Promise.resolve();

    expect(findByName).not.toHaveBeenCalled();
    expect(openDocument).not.toHaveBeenCalled();
  });

  it("scrolls to a heading in the same note, by the id the renderer gave it", () => {
    const { handle, findByName } = handlerFinding([]);
    const { event, container } = clickOn('<a href="#goals--plans" data-md-link="" data-wikilink="#Goals &amp; plans">g</a>');
    const heading = document.createElement("h2");
    heading.id = "md-goals--plans";
    heading.scrollIntoView = vi.fn();
    container.append(heading);

    handle(event);

    expect(heading.scrollIntoView).toHaveBeenCalled();
    expect(findByName).not.toHaveBeenCalled();
  });
});

describe("an in-page link", () => {
  // Rendered headings and footnotes carry a prefixed id, so an author's `#section` still lands.
  it("finds the renderer's prefixed id", () => {
    document.body.innerHTML = "";
    const { event, container } = clickOn('<a href="#fn-1" data-md-link="">1</a>');
    const note = document.createElement("li");
    note.id = "md-fn-1";
    note.scrollIntoView = vi.fn();
    container.append(note);

    markdownLinkHandler({ fromPath: "a.md", fileTypes: ["markdown"], openDocument: vi.fn(), openExternal: vi.fn() })(event);

    expect(note.scrollIntoView).toHaveBeenCalled();
  });
});
