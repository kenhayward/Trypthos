import { describe, expect, it } from "vitest";
import {
  REPO_PAGE_PREFIX,
  isRepoPagePath,
  readmeNameIn,
  repoPagePath,
  repoPageWorkspaceId,
} from "./repoPage";

describe("the path a repository page is a tab under", () => {
  // A reserved path, like the markdown guide's. It names a tab and nothing else: no read, no write
  // and no workspace lookup is ever attempted against it - `splitQualified` refuses the whole
  // `trypthos:` prefix, which is what keeps it out of every path that touches a provider.
  it("is built from the workspace it belongs to", () => {
    expect(repoPagePath("notes")).toBe(`${REPO_PAGE_PREFIX}notes`);
  });

  it("says which workspace it belongs to", () => {
    expect(repoPageWorkspaceId(repoPagePath("notes"))).toBe("notes");
  });

  it("answers null for anything that is not one", () => {
    expect(repoPageWorkspaceId("Notes/docs/plan.md")).toBe(null);
    expect(repoPageWorkspaceId("trypthos:markdown-guide")).toBe(null);
    expect(repoPageWorkspaceId(REPO_PAGE_PREFIX)).toBe(null);
  });

  it("recognises one, and nothing else", () => {
    expect(isRepoPagePath(repoPagePath("notes"))).toBe(true);
    expect(isRepoPagePath("trypthos:markdown-guide")).toBe(false);
    expect(isRepoPagePath("Notes/readme.md")).toBe(false);
  });

  // Two repositories are two pages, because two workspaces are two trees.
  it("gives two repositories two different tabs", () => {
    expect(repoPagePath("notes")).not.toBe(repoPagePath("essays"));
  });

  // The last segment is what the tab strip shows, and it should read as the repository's name
  // rather than as an identifier.
  it("ends with the workspace's name, which is what a tab shows", () => {
    expect(repoPagePath("notes").split("/").at(-1)).toBe("notes");
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
