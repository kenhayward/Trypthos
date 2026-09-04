import { describe, expect, it } from "vitest";
import { isExternalUrl, linkAction } from "./markdownLink";

describe("linkAction", () => {
  describe("web addresses", () => {
    it("sends http and https to the browser", () => {
      expect(linkAction("https://example.com/a", null)).toEqual({
        kind: "external",
        url: "https://example.com/a",
      });
      expect(linkAction("http://example.com", null)).toEqual({
        kind: "external",
        url: "http://example.com",
      });
    });

    it("sends mailto to the browser, which hands it to the mail client", () => {
      expect(linkAction("mailto:ada@example.com", null)).toEqual({
        kind: "external",
        url: "mailto:ada@example.com",
      });
    });

    it("is case-insensitive about the scheme", () => {
      expect(linkAction("HTTPS://example.com", null).kind).toBe("external");
    });

    it("trims surrounding whitespace before deciding", () => {
      expect(linkAction("  https://example.com  ", null)).toEqual({
        kind: "external",
        url: "https://example.com",
      });
    });
  });

  describe("schemes that go nowhere", () => {
    // The renderer strips these before they reach a click, but this is the second line and the one
    // that does not depend on the sanitiser's configuration staying as it is.
    it("refuses javascript:, data: and vbscript:", () => {
      for (const href of ["javascript:alert(1)", "data:text/html,x", "vbscript:msgbox"]) {
        expect(linkAction(href, null)).toEqual({ kind: "none", reason: "unsupported-scheme" });
      }
    });

    it("refuses file:, which is a way out of the workspace", () => {
      expect(linkAction("file:///etc/passwd", null)).toEqual({
        kind: "none",
        reason: "unsupported-scheme",
      });
    });

    // A Windows drive letter parses as a scheme, which is the right answer here for the wrong-looking
    // reason: `C:\notes.md` is not workspace-relative and must not be resolved as though it were.
    it("refuses a drive-qualified Windows path", () => {
      expect(linkAction("C:\\notes.md", null)).toEqual({
        kind: "none",
        reason: "unsupported-scheme",
      });
      expect(linkAction("C:notes.md", null)).toEqual({
        kind: "none",
        reason: "unsupported-scheme",
      });
    });

    // Unifying separators would turn this into `//server/share/notes.md`, and a leading slash means
    // the workspace root - so without this the network share silently becomes a folder called
    // `server` inside the user's workspace.
    it("refuses a UNC path", () => {
      expect(linkAction("\\\\server\\share\\notes.md", null)).toEqual({
        kind: "none",
        reason: "unsupported-scheme",
      });
    });

    it("refuses a protocol-relative URL, whose scheme is not written down", () => {
      expect(linkAction("//example.com/a.md", null)).toEqual({
        kind: "none",
        reason: "unsupported-scheme",
      });
    });
  });

  describe("documents in the workspace", () => {
    it("resolves a sibling against the open file's folder", () => {
      expect(linkAction("chapter-2.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: "book/chapter-2.md",
      });
    });

    it("resolves an explicit ./ the same way", () => {
      expect(linkAction("./chapter-2.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: "book/chapter-2.md",
      });
    });

    it("walks up with ..", () => {
      expect(linkAction("../index.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: "index.md",
      });
    });

    it("treats a leading slash as the workspace root", () => {
      expect(linkAction("/index.md", "book/deep/chapter-1.md")).toEqual({
        kind: "document",
        path: "index.md",
      });
    });

    it("resolves against the root when no file is open", () => {
      expect(linkAction("notes.md", null)).toEqual({ kind: "document", path: "notes.md" });
    });

    it("accepts every extension the folder browser calls markdown", () => {
      for (const name of ["a.md", "a.markdown", "a.mdown", "a.mkd", "a.MD"]) {
        expect(linkAction(name, null).kind).toBe("document");
      }
    });

    // A link is a URL, so its spaces arrive percent-encoded. Opening the file needs the name the
    // filesystem has, not the one the link spelled.
    it("decodes percent-encoding in the path", () => {
      expect(linkAction("my%20notes.md", null)).toEqual({
        kind: "document",
        path: "my notes.md",
      });
    });

    it("keeps the path when the link carries a fragment or a query", () => {
      expect(linkAction("notes.md#heading", null)).toEqual({
        kind: "document",
        path: "notes.md",
      });
      expect(linkAction("notes.md?v=2", null)).toEqual({ kind: "document", path: "notes.md" });
    });

    it("accepts a backslash as a separator, as a Windows author would write it", () => {
      expect(linkAction("sub\\notes.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: "book/sub/notes.md",
      });
    });
  });

  describe("refusals", () => {
    it("refuses a path that walks above the workspace root", () => {
      expect(linkAction("../../secrets.md", "book/chapter-1.md")).toEqual({
        kind: "none",
        reason: "escapes-workspace",
      });
    });

    // Not a security check - the main process guards the boundary regardless. This is about not
    // pretending: the editor opens markdown, so a link to a PDF has nowhere to go.
    it("refuses a relative link to something that is not markdown", () => {
      expect(linkAction("diagram.png", null)).toEqual({ kind: "none", reason: "not-markdown" });
      expect(linkAction("report.pdf", null)).toEqual({ kind: "none", reason: "not-markdown" });
    });

    it("refuses an empty href", () => {
      expect(linkAction("", null)).toEqual({ kind: "none", reason: "empty" });
      expect(linkAction("   ", null)).toEqual({ kind: "none", reason: "empty" });
    });

    it("refuses malformed percent-encoding rather than throwing", () => {
      expect(linkAction("%E0%A4%A.md", null)).toEqual({
        kind: "none",
        reason: "invalid-characters",
      });
    });

    it("refuses a NUL byte", () => {
      expect(linkAction("notes\u0000.md", null)).toEqual({
        kind: "none",
        reason: "invalid-characters",
      });
    });
  });

  describe("in-page anchors", () => {
    it("reports a bare fragment as an anchor, which stays on the page", () => {
      expect(linkAction("#a-heading", "book/chapter-1.md")).toEqual({
        kind: "anchor",
        fragment: "a-heading",
      });
    });

    it("refuses a bare # with nothing after it", () => {
      expect(linkAction("#", null)).toEqual({ kind: "none", reason: "empty" });
    });
  });
});

describe("isExternalUrl", () => {
  // The main process asks this before handing anything to the OS. It has to agree with `linkAction`,
  // which is why it is the same function rather than a second list of schemes.
  it("accepts exactly the schemes the browser is asked to open", () => {
    expect(isExternalUrl("https://example.com")).toBe(true);
    expect(isExternalUrl("http://example.com")).toBe(true);
    expect(isExternalUrl("mailto:ada@example.com")).toBe(true);
  });

  it("refuses everything else, including schemes the OS would act on", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,x",
      "ms-msdt:/id",
      "notes.md",
      "",
    ]) {
      expect(isExternalUrl(url)).toBe(false);
    }
  });
});
