import { describe, expect, it } from "vitest";
import {
  GITHUB_API,
  GitHubRepoDetailSchema,
  GitHubRepoListSchema,
  GitHubTreeSchema,
  blobEntryFor,
  blobUrl,
  branchUrl,
  githubErrorFor,
  isSafeRef,
  matchRepos,
  ownedRepos,
  repoRefFor,
  repoStats,
  repoUrl,
  reposUrl,
  treeNodesAt,
  treeUrl,
} from "./github";

/// A tree as the API hands one over: every path in the repository, flat, with `tree` entries for the
/// directories. The fixture is invented - see the rule about real data in the repo.
const TREE = GitHubTreeSchema.parse({
  sha: "c0ffee",
  truncated: false,
  // In path order, which is the order GitHub answers in - and so the order a listing comes back in.
  tree: [
    { path: "README.md", mode: "100644", type: "blob", sha: "b1", size: 42 },
    { path: "docs", mode: "040000", type: "tree", sha: "t1" },
    { path: "docs/deep", mode: "040000", type: "tree", sha: "t2" },
    { path: "docs/deep/notes.md", mode: "100644", type: "blob", sha: "b3", size: 7 },
    { path: "docs/guide.md", mode: "100644", type: "blob", sha: "b2", size: 120 },
    { path: "link.md", mode: "120000", type: "blob", sha: "b4", size: 9 },
    { path: "vendor", mode: "160000", type: "commit", sha: "s1" },
  ],
});

describe("reading a repository's tree", () => {
  it("lists the root's own children and nothing deeper", () => {
    expect(treeNodesAt(TREE.tree, "")).toEqual([
      { id: "README.md", name: "README.md", kind: "file" },
      { id: "docs", name: "docs", kind: "directory" },
    ]);
  });

  it("lists one folder's children, with ids that name the whole path", () => {
    expect(treeNodesAt(TREE.tree, "docs")).toEqual([
      { id: "docs/deep", name: "deep", kind: "directory" },
      { id: "docs/guide.md", name: "guide.md", kind: "file" },
    ]);
  });

  // A symlink in a repository is a blob holding the path it points at. Listing it as a document
  // would open that path as if it were prose - and the local backend already refuses to follow one,
  // so the two providers have to agree.
  it("leaves symlinks out", () => {
    const names = treeNodesAt(TREE.tree, "").map((node) => node.name);
    expect(names).not.toContain("link.md");
  });

  // A submodule is another repository. It is not in this tree, so a folder row that expanded to
  // nothing would be a folder that looks empty rather than one that is elsewhere.
  it("leaves submodules out", () => {
    const names = treeNodesAt(TREE.tree, "").map((node) => node.name);
    expect(names).not.toContain("vendor");
  });

  it("answers with nothing for a folder that is not in the tree", () => {
    expect(treeNodesAt(TREE.tree, "nowhere")).toEqual([]);
  });

  // "docs" must not list the children of "docs-old". Without the separator the prefix test passes
  // for any folder whose name merely starts the same way.
  it("does not mistake a folder for one whose name it prefixes", () => {
    const tree = GitHubTreeSchema.parse({
      sha: "c0ffee",
      truncated: false,
      tree: [
        { path: "docs-old", mode: "040000", type: "tree", sha: "t1" },
        { path: "docs-old/gone.md", mode: "100644", type: "blob", sha: "b1" },
      ],
    });
    expect(treeNodesAt(tree.tree, "docs")).toEqual([]);
  });

  // GitHub truncates a very large tree, and a directory whose own entry fell off the end still has
  // files under it. Inferring folders from the paths means the row is there either way.
  it("infers a folder from the paths beneath it when its own entry is missing", () => {
    const tree = GitHubTreeSchema.parse({
      sha: "c0ffee",
      truncated: true,
      tree: [{ path: "docs/guide.md", mode: "100644", type: "blob", sha: "b1" }],
    });
    expect(treeNodesAt(tree.tree, "")).toEqual([
      { id: "docs", name: "docs", kind: "directory" },
    ]);
  });

  it("finds the blob behind a path, and answers null for one that is not a file", () => {
    expect(blobEntryFor(TREE.tree, "docs/guide.md")).toEqual({ sha: "b2", size: 120 });
    expect(blobEntryFor(TREE.tree, "docs")).toBe(null);
    expect(blobEntryFor(TREE.tree, "missing.md")).toBe(null);
    // A symlink is not a document, and it is not offered as one.
    expect(blobEntryFor(TREE.tree, "link.md")).toBe(null);
  });
});

describe("the repositories a user owns", () => {
  const REPOS = GitHubRepoListSchema.parse([
    {
      name: "notes",
      full_name: "ada/notes",
      owner: { login: "ada" },
      private: true,
      default_branch: "main",
      description: "A private notebook",
      pushed_at: "2026-01-02T00:00:00Z",
    },
    {
      name: "essays",
      full_name: "ada/essays",
      owner: { login: "ada" },
      private: false,
      default_branch: "trunk",
      description: null,
      pushed_at: "2026-01-01T00:00:00Z",
    },
    {
      name: "notes",
      full_name: "acme/notes",
      owner: { login: "acme" },
      private: false,
      default_branch: "main",
      description: null,
      pushed_at: "2026-01-03T00:00:00Z",
    },
  ]);

  // The API is asked for owned repositories, and the answer is checked as well. A default that
  // quietly included an organisation's thousand repositories is not the list the user asked for.
  it("keeps only the ones the signed-in account owns", () => {
    expect(ownedRepos(REPOS, "ada").map((repo) => repo.fullName)).toEqual([
      "ada/notes",
      "ada/essays",
    ]);
  });

  it("compares the owner without regard to case", () => {
    expect(ownedRepos(REPOS, "ADA")).toHaveLength(2);
  });

  it("carries what the picker draws", () => {
    expect(ownedRepos(REPOS, "ada")[0]).toEqual({
      owner: "ada",
      name: "notes",
      fullName: "ada/notes",
      private: true,
      defaultBranch: "main",
      description: "A private notebook",
      pushedAt: "2026-01-02T00:00:00Z",
    });
  });

  it("turns one into the reference that opens it", () => {
    expect(repoRefFor(ownedRepos(REPOS, "ada")[0]!)).toEqual({
      kind: "github",
      owner: "ada",
      repo: "notes",
    });
  });
});

describe("searching the repository list", () => {
  const summaries = [
    { owner: "ada", name: "notes", fullName: "ada/notes", private: false, defaultBranch: "main", description: "Daily journal", pushedAt: null },
    { owner: "ada", name: "essays", fullName: "ada/essays", private: false, defaultBranch: "main", description: null, pushedAt: null },
    { owner: "ada", name: "Notation", fullName: "ada/Notation", private: false, defaultBranch: "main", description: null, pushedAt: null },
  ];

  it("answers with everything for an empty query", () => {
    expect(matchRepos(summaries, "")).toHaveLength(3);
    expect(matchRepos(summaries, "   ")).toHaveLength(3);
  });

  it("matches part of a name, whatever case it was typed in", () => {
    expect(matchRepos(summaries, "NOT").map((repo) => repo.name)).toEqual(["notes", "Notation"]);
  });

  it("matches the owner and repository together", () => {
    expect(matchRepos(summaries, "ada/ess").map((repo) => repo.name)).toEqual(["essays"]);
  });

  // The description is what tells two similarly named repositories apart.
  it("matches the description", () => {
    expect(matchRepos(summaries, "journal").map((repo) => repo.name)).toEqual(["notes"]);
  });

  // The list arrives newest-pushed first, and a search is a filter rather than a re-ranking: a
  // result order that differed from the list's would read as a different set of repositories.
  it("keeps the order it was given", () => {
    expect(matchRepos(summaries, "a").map((repo) => repo.name)).toEqual([
      "notes",
      "essays",
      "Notation",
    ]);
  });
});

describe("the addresses these calls are made to", () => {
  it("asks for the repositories the account owns, newest first", () => {
    const url = new URL(reposUrl(2));
    expect(url.origin + url.pathname).toBe(`${GITHUB_API}/user/repos`);
    expect(url.searchParams.get("affiliation")).toBe("owner");
    expect(url.searchParams.get("sort")).toBe("pushed");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("names a repository, a branch, its tree and one of its blobs", () => {
    expect(repoUrl("ada", "notes")).toBe(`${GITHUB_API}/repos/ada/notes`);
    expect(branchUrl("ada", "notes", "main")).toBe(`${GITHUB_API}/repos/ada/notes/branches/main`);
    expect(treeUrl("ada", "notes", "c0ffee")).toBe(
      `${GITHUB_API}/repos/ada/notes/git/trees/c0ffee?recursive=1`,
    );
    expect(blobUrl("ada", "notes", "b2")).toBe(`${GITHUB_API}/repos/ada/notes/git/blobs/b2`);
  });

  // A branch really can have a slash in it, and the endpoint takes one - so the separators inside a
  // branch name are kept while everything else about it is encoded.
  it("keeps the separators inside a branch name", () => {
    expect(branchUrl("ada", "notes", "feature/live-mode")).toBe(
      `${GITHUB_API}/repos/ada/notes/branches/feature/live-mode`,
    );
  });

  // Owner, repository, branch and sha all arrive from outside this process - a settings file, or a
  // listing. The property that matters is that none of them can ADD a path segment, which is how a
  // name would address an endpoint nobody asked for.
  it("cannot be walked out of by a name with a separator in it", () => {
    const cases: [string, number][] = [
      [repoUrl("../../users/grace", "x"), 4],
      [repoUrl("ada", "../../users/grace"), 4],
      [treeUrl("ada", "notes", "../../../x"), 7],
      [blobUrl("ada", "notes", "../.."), 7],
    ];

    for (const [url, segments] of cases) {
      const { pathname } = new URL(url);
      expect(pathname.startsWith("/repos/")).toBe(true);
      expect(pathname.split("/")).toHaveLength(segments);
    }
  });

  // A ref that could walk is refused before a URL is built at all, rather than encoded and sent.
  // Git will not create one of these, so anything that looks like it did not come from a listing.
  it("refuses a branch name git could not have made", () => {
    expect(isSafeRef("main")).toBe(true);
    expect(isSafeRef("feature/live-mode")).toBe(true);
    expect(isSafeRef("..")).toBe(false);
    expect(isSafeRef("feature/../../x")).toBe(false);
    expect(isSafeRef("")).toBe(false);
    expect(isSafeRef("feature//x")).toBe(false);
  });
});

describe("what a failing response means", () => {
  it("reads a missing repository as not found", () => {
    expect(githubErrorFor(404, null)).toBe("not-found");
  });

  it("reads a rejected token as permission denied", () => {
    expect(githubErrorFor(401, null)).toBe("permission-denied");
  });

  // The same status means two different things, and only the header tells them apart: a 403 with
  // nothing left in the budget is "come back in an hour", and a 403 with budget left is "this token
  // may not read that". Telling the user the wrong one sends them to fix the wrong thing.
  it("tells a spent rate limit from a refused scope, both of which are 403", () => {
    expect(githubErrorFor(403, "0")).toBe("rate-limited");
    expect(githubErrorFor(403, "4998")).toBe("permission-denied");
  });

  it("reads a secondary limit as rate limited", () => {
    expect(githubErrorFor(429, null)).toBe("rate-limited");
  });

  it("reads anything the app cannot act on as not having reached GitHub", () => {
    expect(githubErrorFor(500, null)).toBe("offline");
    expect(githubErrorFor(502, null)).toBe("offline");
    expect(githubErrorFor(418, null)).toBe("offline");
  });
});

describe("the statistics a repository page shows", () => {
  const DETAIL = {
    name: "notes",
    full_name: "ada/notes",
    owner: { login: "ada" },
    private: true,
    default_branch: "main",
    description: "A private notebook",
    pushed_at: "2026-01-02T00:00:00Z",
    stargazers_count: 1234,
    forks_count: 56,
    open_issues_count: 7,
    language: "TypeScript",
    license: { spdx_id: "MIT", name: "MIT License" },
    topics: ["notes", "markdown"],
    archived: false,
    html_url: "https://github.com/ada/notes",
    homepage: "https://example.com",
  };

  it("carries what the six cards draw", () => {
    expect(repoStats(GitHubRepoDetailSchema.parse(DETAIL))).toEqual({
      fullName: "ada/notes",
      description: "A private notebook",
      private: true,
      archived: false,
      topics: ["notes", "markdown"],
      defaultBranch: "main",
      url: "https://github.com/ada/notes",
      homepage: "https://example.com",
      stars: 1234,
      forks: 56,
      // GitHub counts pull requests in this number as well as issues. The card says so, because a
      // figure labelled "issues" that silently includes pull requests is a wrong answer.
      issuesAndPullRequests: 7,
      language: "TypeScript",
      license: "MIT",
      pushedAt: "2026-01-02T00:00:00Z",
    });
  });

  // A repository with no licence, no language and no description is ordinary, and every one of
  // these is absent rather than zero - the card says so rather than drawing a blank.
  it("reads an absent licence, language and description as absent", () => {
    const bare = repoStats(
      GitHubRepoDetailSchema.parse({
        ...DETAIL,
        description: null,
        language: null,
        license: null,
        topics: [],
        homepage: null,
      }),
    );

    expect(bare.license).toBe(null);
    expect(bare.language).toBe(null);
    expect(bare.description).toBe(null);
    expect(bare.homepage).toBe(null);
    expect(bare.topics).toEqual([]);
  });

  // A licence GitHub cannot identify comes back with the spdx id "NOASSERTION", which is not
  // something to print on a card.
  it("treats an unidentified licence as none", () => {
    const parsed = GitHubRepoDetailSchema.parse({
      ...DETAIL,
      license: { spdx_id: "NOASSERTION", name: "Other" },
    });
    expect(repoStats(parsed).license).toBe(null);
  });

  /// The trap in GitHub's API.
  ///
  /// `watchers_count` is a legacy alias for the STAR count - it is not the number of people
  /// watching. Real watchers are `subscribers_count`. A page showing `watchers_count` beside stars
  /// would print the same number twice under two different labels, which is why neither the schema
  /// nor the statistics carry it.
  it("does not mistake the legacy watchers field for anything", () => {
    const parsed = GitHubRepoDetailSchema.parse({ ...DETAIL, watchers_count: 1234, subscribers_count: 9 });
    const stats = repoStats(parsed);
    expect(Object.keys(stats)).not.toContain("watchers");
    expect(JSON.stringify(stats)).not.toContain("9");
  });

  // Someone else's JSON: fields we do not read are dropped, and fields that grow do not break it.
  it("tolerates a response that has grown fields", () => {
    expect(() =>
      GitHubRepoDetailSchema.parse({ ...DETAIL, some_new_field: { of: "any shape" } }),
    ).not.toThrow();
  });
});
