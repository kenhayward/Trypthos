import { describe, expect, it } from "vitest";
import { imageSourcesIn, withResolvedImages } from "./markdownImages";
import { renderMarkdown } from "./markdown";

/// Finding the pictures in rendered markdown, and putting the read ones back.
///
/// Parsed rather than matched with a regular expression. The HTML is generated and sanitised by the
/// app, so a pattern would work for a while - and then meet an `alt` containing `src="` and rewrite
/// the wrong thing, silently, in somebody's document.

describe("finding the pictures", () => {
  it("finds an image's source", () => {
    expect(imageSourcesIn('<p><img src="orb.png" alt="An orb"></p>')).toEqual(["orb.png"]);
  });

  it("finds several, in order", () => {
    const html = '<img src="one.png"><p>text</p><img src="docs/two.jpg">';
    expect(imageSourcesIn(html)).toEqual(["one.png", "docs/two.jpg"]);
  });

  // The same picture twice is one source to resolve, not two.
  it("reports each source once", () => {
    expect(imageSourcesIn('<img src="orb.png"><img src="orb.png">')).toEqual(["orb.png"]);
  });

  it("finds nothing in a document with no pictures", () => {
    expect(imageSourcesIn("<p>Just prose, and a <a href=\"x.md\">link</a>.</p>")).toEqual([]);
  });

  // An image with no source is not a picture to look for.
  it("ignores an image with no source", () => {
    expect(imageSourcesIn('<img alt="nothing">')).toEqual([]);
  });

  /// The trap a regular expression falls into.
  ///
  /// `alt` is author text, and an author who writes `src="` in it would have a pattern rewriting
  /// their alt text as though it were a source.
  it("is not fooled by text that looks like an attribute", () => {
    expect(imageSourcesIn('<img src="orb.png" alt=\'write src="x.png" to embed\'>')).toEqual([
      "orb.png",
    ]);
  });
});

describe("putting the read pictures back", () => {
  it("replaces a source with what was read for it", () => {
    const html = withResolvedImages('<img src="orb.png">', { "orb.png": "data:image/png;base64,AA" });
    expect(html).toContain('src="data:image/png;base64,AA"');
    expect(html).not.toContain('src="orb.png"');
  });

  // A picture that could not be read keeps what the author wrote. A broken image is better than a
  // wrong one, and blanking the source would lose the alt text with it.
  it("leaves a source that was not read alone", () => {
    const html = withResolvedImages('<img src="orb.png" alt="An orb">', {});
    expect(html).toContain('src="orb.png"');
    expect(html).toContain('alt="An orb"');
  });

  it("leaves everything that is not an image alone", () => {
    const html = withResolvedImages('<p>Prose</p><a href="notes.md">A link</a>', {});
    expect(html).toContain("Prose");
    expect(html).toContain('href="notes.md"');
  });

  it("replaces every appearance of the same picture", () => {
    const html = withResolvedImages('<img src="orb.png"><img src="orb.png">', {
      "orb.png": "data:image/png;base64,AA",
    });
    expect(html.match(/data:image\/png;base64,AA/g)).toHaveLength(2);
  });

  // Nothing to do is the common case - most documents have no pictures - and it must not cost a
  // parse and a re-serialise on every render.
  it("hands back the same string when there is nothing to replace", () => {
    const html = "<p>Prose only.</p>";
    expect(withResolvedImages(html, {})).toBe(html);
  });

  /// The property that matters most.
  ///
  /// This runs over already-sanitised HTML and hands the result to `dangerouslySetInnerHTML`. A data
  /// URL is written into an attribute, so it is escaped on the way in - and the parse-and-serialise
  /// round trip is what guarantees that rather than a hand-rolled escape.
  it("escapes what it writes into the attribute", () => {
    const html = withResolvedImages('<img src="orb.png">', {
      "orb.png": 'data:image/png;base64,AA" onerror="alert(1)',
    });
    expect(html).not.toContain('onerror="alert(1)"');
  });
});

/// Against what the renderer actually emits, rather than hand-written markup.
///
/// The unit tests above use HTML written for the purpose, which is exactly the shape that can drift
/// from what `renderMarkdown` produces. This is the pair meeting.
describe("against real rendered markdown", () => {
  it("finds the source marked wrote, and puts the read picture back", () => {
    const html = renderMarkdown("# Title\n\n![An orb](docs/orb.png)");

    expect(imageSourcesIn(html)).toEqual(["docs/orb.png"]);

    const resolved = withResolvedImages(html, { "docs/orb.png": "data:image/png;base64,AA" });
    expect(resolved).toContain('src="data:image/png;base64,AA"');
    expect(resolved).toContain('alt="An orb"');
  });
});
