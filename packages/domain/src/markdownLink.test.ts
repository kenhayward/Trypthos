import { describe, expect, it } from "vitest";
import { isExternalUrl, isUnsupportedScheme, linkAction } from "./markdownLink";

/// Most of these cases are about schemes, traversal and encoding, and have nothing to say about file
/// types - so they run against the types a fresh installation has, named once here. The cases that
/// ARE about file types pass their own list.
const link = (href: string, fromPath: string | null, enabled: readonly string[] = ["markdown"]) =>
  linkAction(href, fromPath, enabled);

describe("linkAction", () => {
  describe("web addresses", () => {
    it("sends http and https to the browser", () => {
      expect(link("https://example.com/a", null)).toEqual({
        kind: "external",
        url: "https://example.com/a",
      });
      expect(link("http://example.com", null)).toEqual({
        kind: "external",
        url: "http://example.com",
      });
    });

    it("sends mailto to the browser, which hands it to the mail client", () => {
      expect(link("mailto:ada@example.com", null)).toEqual({
        kind: "external",
        url: "mailto:ada@example.com",
      });
    });

    it("is case-insensitive about the scheme", () => {
      expect(link("HTTPS://example.com", null).kind).toBe("external");
    });

    it("trims surrounding whitespace before deciding", () => {
      expect(link("  https://example.com  ", null)).toEqual({
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
        expect(link(href, null)).toEqual({ kind: "none", reason: "unsupported-scheme" });
      }
    });

    it("refuses file:, which is a way out of the workspace", () => {
      expect(link("file:///etc/passwd", null)).toEqual({
        kind: "none",
        reason: "unsupported-scheme",
      });
    });

    // A Windows drive letter parses as a scheme, which is the right answer here for the wrong-looking
    // reason: `C:\notes.md` is not workspace-relative and must not be resolved as though it were.
    it("refuses a drive-qualified Windows path", () => {
      expect(link("C:\\notes.md", null)).toEqual({
        kind: "none",
        reason: "unsupported-scheme",
      });
      expect(link("C:notes.md", null)).toEqual({
        kind: "none",
        reason: "unsupported-scheme",
      });
    });

    // Unifying separators would turn this into `//server/share/notes.md`, and a leading slash means
    // the workspace root - so without this the network share silently becomes a folder called
    // `server` inside the user's workspace.
    it("refuses a UNC path", () => {
      expect(link("\\\\server\\share\\notes.md", null)).toEqual({
        kind: "none",
        reason: "unsupported-scheme",
      });
    });

    it("refuses a protocol-relative URL, whose scheme is not written down", () => {
      expect(link("//example.com/a.md", null)).toEqual({
        kind: "none",
        reason: "unsupported-scheme",
      });
    });
  });

  describe("documents in the workspace", () => {
    it("resolves a sibling against the open file's folder", () => {
      expect(link("chapter-2.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: "book/chapter-2.md",
      });
    });

    it("resolves an explicit ./ the same way", () => {
      expect(link("./chapter-2.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: "book/chapter-2.md",
      });
    });

    it("walks up with ..", () => {
      expect(link("../index.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: "index.md",
      });
    });

    it("treats a leading slash as the workspace root", () => {
      expect(link("/index.md", "book/deep/chapter-1.md")).toEqual({
        kind: "document",
        path: "index.md",
      });
    });

    it("resolves against the root when no file is open", () => {
      expect(link("notes.md", null)).toEqual({ kind: "document", path: "notes.md" });
    });

    it("accepts every extension the folder browser calls markdown", () => {
      for (const name of ["a.md", "a.markdown", "a.mdown", "a.mkd", "a.MD"]) {
        expect(link(name, null).kind).toBe("document");
      }
    });

    // A link is a URL, so its spaces arrive percent-encoded. Opening the file needs the name the
    // filesystem has, not the one the link spelled.
    it("decodes percent-encoding in the path", () => {
      expect(link("my%20notes.md", null)).toEqual({
        kind: "document",
        path: "my notes.md",
      });
    });

    it("keeps the path when the link carries a fragment or a query", () => {
      expect(link("notes.md#heading", null)).toEqual({
        kind: "document",
        path: "notes.md",
      });
      expect(link("notes.md?v=2", null)).toEqual({ kind: "document", path: "notes.md" });
    });

    it("accepts a backslash as a separator, as a Windows author would write it", () => {
      expect(link("sub\\notes.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: "book/sub/notes.md",
      });
    });
  });

  describe("refusals", () => {
    it("refuses a path that walks above the workspace root", () => {
      expect(link("../../secrets.md", "book/chapter-1.md")).toEqual({
        kind: "none",
        reason: "escapes-workspace",
      });
    });

    // Not a security check - the main process guards the boundary regardless. This is about not
    // pretending: a link to a PDF has nowhere to go, so nothing should happen when it is clicked.
    it("refuses a relative link to a file no enabled type claims", () => {
      expect(link("diagram.png", null)).toEqual({ kind: "none", reason: "not-openable" });
      expect(link("report.pdf", null)).toEqual({ kind: "none", reason: "not-openable" });
    });

    // The same rule the folder browser uses, from the same catalogue. A link the tree would not
    // show is a link the editor cannot honour, and the two must not disagree about which those are.
    it("follows a link only to a type that is turned on", () => {
      expect(link("notes.txt", null)).toEqual({ kind: "none", reason: "not-openable" });
      expect(link("notes.txt", null, ["markdown", "text"])).toEqual({
        kind: "document",
        path: "notes.txt",
      });
    });

    it("refuses an empty href", () => {
      expect(link("", null)).toEqual({ kind: "none", reason: "empty" });
      expect(link("   ", null)).toEqual({ kind: "none", reason: "empty" });
    });

    it("refuses malformed percent-encoding rather than throwing", () => {
      expect(link("%E0%A4%A.md", null)).toEqual({
        kind: "none",
        reason: "invalid-characters",
      });
    });

    it("refuses a NUL byte", () => {
      expect(link("notes\u0000.md", null)).toEqual({
        kind: "none",
        reason: "invalid-characters",
      });
    });
  });

  describe("in-page anchors", () => {
    it("reports a bare fragment as an anchor, which stays on the page", () => {
      expect(link("#a-heading", "book/chapter-1.md")).toEqual({
        kind: "anchor",
        fragment: "a-heading",
      });
    });

    it("refuses a bare # with nothing after it", () => {
      expect(link("#", null)).toEqual({ kind: "none", reason: "empty" });
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

describe("isUnsupportedScheme", () => {
  // Asked on its own by the markdown renderer, which decides whether to put a link's target in its
  // hover text. That surface renders the same markdown in Preview, in chat replies and in the About
  // box, so it does not know which document is open - and must not be made to answer a question
  // about file types that has no answer there.
  it("refuses a scheme the app will not hand anywhere", () => {
    for (const href of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "C:/notes.md"]) {
      expect(isUnsupportedScheme(href)).toBe(true);
    }
  });

  // Two leading separators are a host, not a path: `//example.com/a` inherits the page's scheme and
  // a network share is a Windows path with two leading backslashes. Neither is in the workspace.
  it("refuses a protocol-relative address and a network share", () => {
    expect(isUnsupportedScheme("//example.com/a")).toBe(true);
    expect(isUnsupportedScheme("\\\\server\\share")).toBe(true);
  });

  it("permits the schemes the browser gets, and anything workspace-relative", () => {
    for (const href of ["https://example.com", "mailto:ada@example.com", "notes.md", "a/b.md", ""]) {
      expect(isUnsupportedScheme(href)).toBe(false);
    }
  });
});
