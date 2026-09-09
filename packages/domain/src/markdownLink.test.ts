import { describe, expect, it } from "vitest";
import { isExternalUrl, isUnsupportedScheme, linkAction , imageSource} from "./markdownLink";

/// Most of these cases are about schemes, traversal and encoding, and have nothing to say about file
/// types - so they run against the types a fresh installation has, named once here. The cases that
/// ARE about file types pass their own list.
/// Every path names the workspace it is in. The fixtures below stay unqualified so they read as
/// paths rather than as plumbing; the helper puts the workspace on, exactly as the app does.
const WORKSPACE = "Notes";

const link = (href: string, fromPath: string | null, enabled: readonly string[] = ["markdown"]) =>
  linkAction(
    href,
    fromPath === null ? null : `${WORKSPACE}/${fromPath}`,
    enabled,
    WORKSPACE,
  );

/// What the helper above expects back: the same path, in that workspace.
const inWorkspace = (path: string) => `${WORKSPACE}/${path}`;

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
        path: inWorkspace("book/chapter-2.md"),
      });
    });

    it("resolves an explicit ./ the same way", () => {
      expect(link("./chapter-2.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: inWorkspace("book/chapter-2.md"),
      });
    });

    it("walks up with ..", () => {
      expect(link("../index.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: inWorkspace("index.md"),
      });
    });

    it("treats a leading slash as the workspace root", () => {
      expect(link("/index.md", "book/deep/chapter-1.md")).toEqual({
        kind: "document",
        path: inWorkspace("index.md"),
      });
    });

    it("resolves against the root when no file is open", () => {
      expect(link("notes.md", null)).toEqual({ kind: "document", path: inWorkspace("notes.md") });
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
        path: inWorkspace("my notes.md"),
      });
    });

    it("keeps the path when the link carries a fragment or a query", () => {
      expect(link("notes.md#heading", null)).toEqual({
        kind: "document",
        path: inWorkspace("notes.md"),
      });
      expect(link("notes.md?v=2", null)).toEqual({ kind: "document", path: inWorkspace("notes.md") });
    });

    it("accepts a backslash as a separator, as a Windows author would write it", () => {
      expect(link("sub\\notes.md", "book/chapter-1.md")).toEqual({
        kind: "document",
        path: inWorkspace("book/sub/notes.md"),
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
        path: inWorkspace("notes.txt"),
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

/// Links, now that every path names the workspace it is in.
///
/// A relative link resolves inside the document's own workspace for free - the workspace is the
/// first segment of the document's path, so climbing out of it runs out of segments and is refused
/// by the same check that always refused climbing out of the workspace. The two cases that need
/// telling are the ones where the document cannot answer.
describe("linkAction across several workspaces", () => {
  const enabled = ["markdown"];

  it("keeps a relative link inside the workspace its document is in", () => {
    expect(linkAction("../plan.md", "Notes/docs/a.md", enabled)).toEqual({
      kind: "document",
      path: "Notes/plan.md",
    });
  });

  // The workspace is part of the depth now, so a link that climbs past it is refused by the check
  // that always refused climbing past the root - there is no extra rule to get wrong.
  it("refuses a link that climbs out of its workspace", () => {
    expect(linkAction("../../elsewhere.md", "Notes/docs/a.md", enabled)).toEqual({
      kind: "none",
      reason: "escapes-workspace",
    });
  });

  // "The root" has to be told which root.
  it("resolves a root-relative link against the workspace it is told about", () => {
    expect(linkAction("/plan.md", "Notes/docs/a.md", enabled, "Notes")).toEqual({
      kind: "document",
      path: "Notes/plan.md",
    });
  });

  // A reply in the chat panel, and the scratch buffer: neither is in a workspace, so neither has a
  // folder for a relative link to start from.
  it("resolves a link with no document behind it against the workspace it is told about", () => {
    expect(linkAction("plan.md", null, enabled, "Notes")).toEqual({
      kind: "document",
      path: "Notes/plan.md",
    });
  });

  // Not a link at all, rather than one that resolves nowhere. There is no folder for it to be
  // relative to, so there is no file it could name.
  it("makes such a link nothing when there is no workspace to name", () => {
    expect(linkAction("plan.md", null, enabled)).toEqual({
      kind: "none",
      reason: "no-workspace",
    });
  });
});

describe("resolving an image's source", () => {
  const IMAGES = ["notes/orb.png"];

  it("resolves one written beside the document", () => {
    expect(imageSource("orb.png", "Notes/README.md")).toEqual({
      kind: "image",
      path: "Notes/orb.png",
    });
  });

  it("resolves one in a folder below the document", () => {
    expect(imageSource("docs/orb.png", "Notes/README.md")).toEqual({
      kind: "image",
      path: "Notes/docs/orb.png",
    });
  });

  // The same walk links get: `..` is counted against the folders inside the workspace, so a source
  // that climbs past the root is refused rather than becoming a plausible-looking path.
  it("refuses one that climbs out of the workspace", () => {
    expect(imageSource("../../secret.png", "Notes/docs/README.md")).toEqual({
      kind: "none",
      reason: "escapes-workspace",
    });
  });

  it("reads a leading separator as the workspace root", () => {
    expect(imageSource("/logo.png", "Notes/docs/README.md")).toEqual({
      kind: "image",
      path: "Notes/logo.png",
    });
  });

  /// The difference from a link, and the reason this is not `linkAction`.
  ///
  /// A picture is not a file type the editor opens, so `isOpenable` answers no for every one of
  /// them - a link to `orb.png` does nothing, and an image with the same source must still be drawn.
  it("accepts a picture, which is not a file type the editor opens", () => {
    for (const name of ["orb.png", "shot.JPEG", "anim.gif", "icon.webp"]) {
      expect(imageSource(name, "Notes/README.md").kind).toBe("image");
    }
  });

  // Anything that is not a picture is not one. A source naming a markdown file would be a request to
  // read a document as bytes and draw it, which is not what an image tag means.
  it("refuses a source that is not a picture", () => {
    expect(imageSource("notes.md", "Notes/README.md")).toEqual({
      kind: "none",
      reason: "not-openable",
    });
  });

  // A remote image is left to the browser, exactly as a remote link is left to it. Badges in a
  // README are the common case.
  it("passes a web address straight through", () => {
    expect(imageSource("https://example.com/badge.svg", "Notes/README.md")).toEqual({
      kind: "external",
      url: "https://example.com/badge.svg",
    });
  });

  // The same allow-list links get. `javascript:` in an image source is inert, but a scheme the app
  // refuses for a link is one it refuses here.
  it("refuses a scheme the app does not hand to anything", () => {
    expect(imageSource("javascript:alert(1)", "Notes/README.md").kind).toBe("none");
    expect(imageSource("file:///etc/passwd", "Notes/README.md").kind).toBe("none");
  });

  // A document that is in no workspace - the scratch buffer, the built-in guide, a chat reply - has
  // nothing to resolve against, and a guess would be a read of somebody else's folder.
  it("answers nothing for a document that is in no workspace", () => {
    expect(imageSource("orb.png", null).kind).toBe("none");
    expect(imageSource("orb.png", "trypthos:markdown-guide").kind).toBe("none");
  });

  // Which workspace a source with no folder of its own belongs to, when the document cannot say.
  it("takes the workspace it is given when the document has none", () => {
    expect(imageSource("/logo.png", null, "Notes")).toEqual({
      kind: "image",
      path: "Notes/logo.png",
    });
  });

  it("ignores an empty source", () => {
    expect(imageSource("   ", "Notes/README.md").kind).toBe("none");
    expect(IMAGES).toHaveLength(1);
  });
});
