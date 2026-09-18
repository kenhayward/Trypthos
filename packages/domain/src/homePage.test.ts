import { describe, expect, it } from "vitest";
import { HOME_PAGE_PREFIX, homePagePath, homePageWorkspaceId, isHomePagePath, readmeNameIn } from "./homePage";
import { splitQualified } from "./qualifiedPath";

/// A workspace's home page is a document identity like the markdown guide - a tab, never a file.
/// The `trypthos:` prefix is what keeps it away from every provider.

describe("a home page's path", () => {
  it("names the workspace it belongs to", () => {
    expect(homePagePath("Notes")).toBe("trypthos:home/Notes");
    expect(homePageWorkspaceId("trypthos:home/Notes")).toBe("Notes");
    expect(isHomePagePath("trypthos:home/Notes")).toBe(true);
  });

  it("is not any other path", () => {
    expect(homePageWorkspaceId("Notes/README.md")).toBe(null);
    expect(homePageWorkspaceId("trypthos:home/")).toBe(null);
    expect(homePageWorkspaceId("trypthos:markdown-guide")).toBe(null);
    expect(isHomePagePath("trypthos:graph/Notes")).toBe(false);
    expect(isHomePagePath("trypthos:repo/Notes")).toBe(false);
  });

  // Two workspaces are two pages, because two workspaces are two trees.
  it("gives two workspaces two different tabs", () => {
    expect(homePagePath("notes")).not.toBe(homePagePath("essays"));
  });

  // The property that keeps a page out of every provider: a qualified-path reader refuses it.
  it("is refused as a path into a workspace", () => {
    expect(HOME_PAGE_PREFIX.startsWith("trypthos:")).toBe(true);
    expect(splitQualified(homePagePath("Notes"))).toBe(null);
  });
});

describe("finding the README to show", () => {
  const node = (name: string) => ({ id: `Notes/${name}`, name, kind: "file" as const });

  it("finds README.md at the root", () => {
    expect(readmeNameIn([node("index.md"), node("README.md")])).toBe("README.md");
  });

  // Repositories spell it every way. GitHub itself matches case-insensitively, and a page that
  // showed nothing for `readme.md` would look broken rather than empty.
  it("does not care how it is spelled", () => {
    expect(readmeNameIn([node("readme.md")])).toBe("readme.md");
    expect(readmeNameIn([node("Readme.MD")])).toBe("Readme.MD");
    expect(readmeNameIn([node("README.markdown")])).toBe("README.markdown");
    expect(readmeNameIn([node("README")])).toBe("README");
  });

  // A markdown editor renders markdown. Anything else would be shown as source, which is worse than
  // saying there is nothing to show.
  it("ignores a README this app cannot render as prose", () => {
    expect(readmeNameIn([node("README.rst")])).toBe(null);
  });

  it("answers null when there is not one", () => {
    expect(readmeNameIn([node("index.md"), node("LICENSE")])).toBe(null);
    expect(readmeNameIn([])).toBe(null);
  });

  // A directory called `readme` is not a document, and reading it would fail rather than render.
  it("ignores a directory of that name", () => {
    expect(readmeNameIn([{ name: "readme", kind: "directory" }])).toBe(null);
  });

  // Deterministic when a repository somehow holds two: the shortest, then alphabetical - so the
  // page shows the same file every time rather than whichever the listing happened to put first.
  it("picks the same one every time when there are several", () => {
    const one = readmeNameIn([node("README.markdown"), node("README.md")]);
    const other = readmeNameIn([node("README.md"), node("README.markdown")]);
    expect(one).toBe("README.md");
    expect(other).toBe("README.md");
  });
});
