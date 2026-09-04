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

  const handler = (fromPath: string | null = null) =>
    markdownLinkHandler({ fromPath, openDocument, openExternal });

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
