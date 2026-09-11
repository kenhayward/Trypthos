import { describe, expect, it } from "vitest";
import {
  GITHUB_API,
  GitHubBranchSchema,
  GitHubCommitPullsSchema,
  GitHubCommitSchema,
  GitHubComparisonSchema,
  arrivalOf,
  commitCompareUrl,
  commitPullsUrl,
  commitSummary,
  commitUrl,
  GitHubRefListSchema,
  GitHubRepoDetailSchema,
  GitHubRepoListSchema,
  GitHubTreeSchema,
  GitHubUserSchema,
  blobEntryFor,
  blobUrl,
  branchCountUrl,
  branchListUrl,
  branchNameFor,
  branchUrl,
  commitMessageFor,
  compareUrl,
  contentsUrl,
  countFromLink,
  githubErrorFor,
  githubWriteErrorFor,
  isValidBranchName,
  refsUrl,
  isSafeRef,
  matchRepos,
  ownedRepos,
  repoRefFor,
  repoStats,
  repoUrl,
  reposUrl,
  tagCountUrl,
  treeNodesAt,
  treeUrl,
  userUrl,
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
    owner: { login: "ada", avatar_url: "https://avatars.example/ada.png" },
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

  it("carries what the cards draw", () => {
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
      owner: { login: "ada", name: null, avatarUrl: "https://avatars.example/ada.png" },
      parent: null,
      branches: null,
      tags: null,
      divergence: null,
    });
  });

  /// The four figures that are NOT in the repository response.
  ///
  /// A display name, a branch count, a tag count and a comparison with the upstream are four more
  /// requests, and every one of them can fail on its own. They arrive here rather than being read
  /// out of the detail, so the page can draw a repository whose branch count never came back.
  it("takes the figures that need their own requests as extras", () => {
    const stats = repoStats(GitHubRepoDetailSchema.parse(DETAIL), {
      ownerName: "Ada Lovelace",
      branches: 9,
      tags: 3,
      divergence: { ahead: 2, behind: 5 },
    });

    expect(stats.owner).toEqual({
      login: "ada",
      name: "Ada Lovelace",
      avatarUrl: "https://avatars.example/ada.png",
    });
    expect(stats.branches).toBe(9);
    expect(stats.tags).toBe(3);
    expect(stats.divergence).toEqual({ ahead: 2, behind: 5 });
  });

  // An account with no display name set, and an avatar the response did not carry. Both are absent
  // rather than empty, so the page shows a login on its own rather than a blank line and a broken
  // picture where a face should be.
  it("reads a missing display name and avatar as absent", () => {
    const stats = repoStats(
      GitHubRepoDetailSchema.parse({ ...DETAIL, owner: { login: "ada" } }),
      { ownerName: null },
    );

    expect(stats.owner).toEqual({ login: "ada", name: null, avatarUrl: null });
  });

  it("carries where a fork came from", () => {
    const stats = repoStats(
      GitHubRepoDetailSchema.parse({
        ...DETAIL,
        fork: true,
        parent: {
          name: "notes",
          full_name: "grace/notes",
          owner: { login: "grace" },
          default_branch: "trunk",
        },
      }),
    );

    // Owner and name separately as well as the full name: the full name is what a reader sees, and
    // the two halves are what opening it in the app needs.
    expect(stats.parent).toEqual({ fullName: "grace/notes", owner: "grace", name: "notes" });
  });

  // GitHub sends `parent` only for a fork, and only on the single-repository response. A repository
  // that is nobody's fork simply has no such field, which is not a missing one.
  it("has no parent for a repository that is not a fork", () => {
    expect(repoStats(GitHubRepoDetailSchema.parse(DETAIL)).parent).toBe(null);
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

/// How many branches, and how many tags.
///
/// **GitHub does not answer either question.** There is no count field on a repository and no
/// endpoint that returns one - the only way to ask is to page a listing and see where it ends. With
/// one item per page the number of the LAST page is the number of items, which turns an unbounded
/// walk into a single request.
describe("counting a paged listing from its Link header", () => {
  const LINK =
    '<https://api.github.com/repositories/1/branches?per_page=1&page=2>; rel="next", ' +
    '<https://api.github.com/repositories/1/branches?per_page=1&page=7>; rel="last"';

  it("reads the last page number as the count", () => {
    expect(countFromLink(LINK, 1)).toBe(7);
  });

  // No Link header means there is no page after this one, so what came back is all there is. One
  // branch is the ordinary case and it must not read as unknown.
  it("counts what arrived when there is no next page", () => {
    expect(countFromLink(null, 1)).toBe(1);
    expect(countFromLink(null, 0)).toBe(0);
  });

  // A header in a shape this does not recognise is UNKNOWN, never zero. A repository drawn as
  // having no branches at all would be a wrong answer given confidently.
  it("gives up rather than guessing at a header it cannot read", () => {
    expect(countFromLink("something else entirely", 1)).toBe(null);
    expect(countFromLink('<https://api.github.com/x>; rel="last"', 1)).toBe(null);
    expect(countFromLink('<https://api.github.com/x?page=nine>; rel="last"', 1)).toBe(null);
  });

  // `rel="next"` alone is a page in the middle of a listing with no last page named, which happens
  // when a listing is walked by cursor. Nothing here can turn that into a total.
  it("does not mistake the next page for the last one", () => {
    expect(countFromLink('<https://api.github.com/x?page=2>; rel="next"', 1)).toBe(null);
  });

  // The rel value can be single-quoted or unquoted, and the parts can be spaced differently. It is
  // one header written by one server, but nothing here should hang on its whitespace.
  it("reads the header however it is spaced", () => {
    expect(countFromLink('<https://api.github.com/x?page=4>;rel=last', 1)).toBe(4);
  });
});

describe("the addresses the repository page asks for", () => {
  it("asks for one branch and one tag at a time, which is what makes the count a page number", () => {
    expect(branchCountUrl("ada", "notes")).toBe(`${GITHUB_API}/repos/ada/notes/branches?per_page=1`);
    expect(tagCountUrl("ada", "notes")).toBe(`${GITHUB_API}/repos/ada/notes/tags?per_page=1`);
  });

  it("names a profile by login", () => {
    expect(userUrl("ada")).toBe(`${GITHUB_API}/users/ada`);
  });

  // The fork is the head and the upstream is the base, so `ahead` counts commits this repository
  // has that the upstream does not. The other way round would report the two numbers swapped.
  it("compares the upstream against the fork", () => {
    expect(
      compareUrl("ada", "notes", { owner: "grace", ref: "trunk" }, { owner: "ada", ref: "main" }),
    ).toBe(`${GITHUB_API}/repos/ada/notes/compare/grace:trunk...ada:main`);
  });

  // A branch is the one name here that legitimately contains separators, so its slashes are kept
  // while everything else about it is encoded - exactly as `branchUrl` does it.
  it("keeps a branch's own separators and encodes the rest", () => {
    expect(
      compareUrl("ada", "notes", { owner: "grace", ref: "release/2" }, { owner: "ada", ref: "a b" }),
    ).toBe(`${GITHUB_API}/repos/ada/notes/compare/grace:release/2...ada:a%20b`);
  });
});

describe("the schemas the extra requests are read through", () => {
  it("reads a branch listing as names", () => {
    expect(GitHubRefListSchema.parse([{ name: "main", commit: { sha: "c0ffee" } }])).toEqual([
      { name: "main" },
    ]);
  });

  it("reads a comparison as two counts", () => {
    const parsed = GitHubComparisonSchema.parse({ ahead_by: 2, behind_by: 5, status: "diverged" });
    expect(parsed.ahead_by).toBe(2);
    expect(parsed.behind_by).toBe(5);
  });

  // An account that has never set a display name answers with null, and that is not a failure.
  it("reads a profile with no display name", () => {
    const parsed = GitHubUserSchema.parse({ login: "ada", name: null });
    expect(parsed.login).toBe("ada");
    expect(parsed.name).toBe(null);
  });

});

/// Writing back.
///
/// A save to GitHub is a commit on a branch. There is no separate push: the Contents API commits on
/// the server, so one request is the write, the commit and the push together. What is here is
/// everything that is not that request - the addresses, the names, and what a refusal means.

describe("the addresses a write is made to", () => {
  it("names a file's contents, with and without a branch", () => {
    expect(contentsUrl("ada", "notes", "docs/guide.md")).toBe(
      `${GITHUB_API}/repos/ada/notes/contents/docs/guide.md`,
    );
    expect(contentsUrl("ada", "notes", "docs/guide.md", "trunk")).toBe(
      `${GITHUB_API}/repos/ada/notes/contents/docs/guide.md?ref=trunk`,
    );
  });

  // A path keeps its own separators - it names a place in the tree - while everything else about it
  // is encoded. The same rule a branch gets, and for the same reason.
  it("keeps a path's separators and encodes the rest", () => {
    expect(contentsUrl("ada", "notes", "my docs/a+b.md")).toBe(
      `${GITHUB_API}/repos/ada/notes/contents/my%20docs/a%2Bb.md`,
    );
  });

  it("names where a branch is created, and where they are listed", () => {
    expect(refsUrl("ada", "notes")).toBe(`${GITHUB_API}/repos/ada/notes/git/refs`);
    expect(branchListUrl("ada", "notes", 1)).toBe(
      `${GITHUB_API}/repos/ada/notes/branches?per_page=100&page=1`,
    );
  });
});

describe("what a failing write means", () => {
  // The one that matters. A 409 from the Contents API is the sha not matching: somebody else
  // committed to that path since it was read. It is a RESULT, never an exception - the editor must
  // not report a save it did not make, and which version wins is the user's decision.
  it("reads a stale sha as a conflict", () => {
    expect(githubWriteErrorFor(409, null)).toBe("conflict");
  });

  // A branch that is already there. Its own reason, because the answer is "commit to it instead"
  // rather than anything the user has done wrong.
  it("reads a branch that already exists as exactly that", () => {
    expect(githubWriteErrorFor(422, null)).toBe("branch-exists");
  });

  /// The refusal that will actually happen.
  ///
  /// Every token connected before writing existed can read and not write, so this is the FIRST
  /// thing a user meets. Answered as its own reason rather than "permission denied", because the
  /// two send someone to different places: one to make a new token, the other to wonder whether
  /// they still have access to the repository at all.
  it("reads a token that may not write as exactly that", () => {
    expect(githubWriteErrorFor(403, "4999")).toBe("read-only-token");
    // A spent budget is still a spent budget, and it comes back on its own.
    expect(githubWriteErrorFor(403, "0")).toBe("rate-limited");
  });

  // Everything else means what it means on a read. One mapping, extended - not a second one that
  // could come to disagree with the first about what a 404 is.
  it("reads everything else the way a read does", () => {
    expect(githubWriteErrorFor(404, null)).toBe("not-found");
    expect(githubWriteErrorFor(401, null)).toBe("permission-denied");
    expect(githubWriteErrorFor(500, null)).toBe("offline");
  });
});

describe("naming a branch", () => {
  it("suggests one from the file being edited", () => {
    expect(branchNameFor("README.md")).toBe("trypthos/update-readme");
    expect(branchNameFor("docs/Getting Started.md")).toBe("trypthos/update-getting-started");
  });

  // A name git could not accept is a request that fails at the API rather than in the dialog, which
  // is the wrong place to find out. Every one of these is something git refuses outright.
  it("refuses a name git would not accept", () => {
    for (const bad of [
      "",
      "   ",
      "has space",
      "ends/",
      "/starts",
      "double//slash",
      "dot..dot",
      "tilde~",
      "caret^",
      "colon:",
      "question?",
      "star*",
      "bracket[",
      "back\\slash",
      // A control character. Git forbids these outright, and no dialog would show you one.
      "bell\u0007",
      "ends.",
      "ends.lock",
      ".hidden",
      "under/.hidden",
      "@",
      "-leading",
    ]) {
      expect(isValidBranchName(bad), `${bad} should be refused`).toBe(false);
    }
  });

  it("accepts the names people actually use", () => {
    for (const good of ["main", "trypthos/update-readme", "feature/ABC-123_v2", "v1.2.x", "a"]) {
      expect(isValidBranchName(good), `${good} should be accepted`).toBe(true);
    }
  });

  // A suggestion that its own validator refuses would be a dialog that opens refusing itself.
  it("suggests names that pass its own check", () => {
    for (const file of ["README.md", "a b/c d.md", "...md", "docs/-weird-.md"]) {
      expect(isValidBranchName(branchNameFor(file)), file).toBe(true);
    }
  });
});

describe("the message on a commit", () => {
  it("says what was done, and to which file", () => {
    expect(commitMessageFor("docs/guide.md", { creating: false })).toBe("Update guide.md");
    expect(commitMessageFor("notes.md", { creating: true })).toBe("Add notes.md");
  });
});

/// A commit as the repository page names it: which one, what it said, who made it, and when.
describe("a commit, as the repository page names it", () => {
  const COMMIT = GitHubCommitSchema.parse({
    sha: "abc1234def5678",
    html_url: "https://github.com/ada/notes/commit/abc1234def5678",
    commit: {
      message: "Tidy the guide\n\nA longer explanation nobody reads in a list.",
      author: { name: "Ada Lovelace", date: "2026-09-01T10:00:00Z" },
      committer: { name: "GitHub", date: "2026-09-02T12:00:00Z" },
    },
    author: { login: "ada" },
  });

  it("keeps the first line of the message, who made it, and where to see it", () => {
    expect(commitSummary(COMMIT)).toEqual({
      sha: "abc1234def5678",
      headline: "Tidy the guide",
      author: "ada",
      date: "2026-09-02T12:00:00Z",
      url: "https://github.com/ada/notes/commit/abc1234def5678",
    });
  });

  // The COMMITTER's date, not the author's. A pull request written on the first and merged on the
  // second reached the branch on the second, and "when did this land" is the question the page asks.
  it("dates a commit by when it reached the branch, not when it was written", () => {
    expect(commitSummary(COMMIT).date).toBe("2026-09-02T12:00:00Z");
  });

  // An email git recorded that matches no GitHub account comes back with no `author` object at all.
  it("falls back to the name git recorded when GitHub has no account for the author", () => {
    const parsed = GitHubCommitSchema.parse({ ...COMMIT, author: null });
    expect(commitSummary(parsed).author).toBe("Ada Lovelace");
  });

  // What a branch LISTING carries for its head is a sha and nothing else. It still names a commit.
  it("describes a commit that arrived as nothing but its sha", () => {
    const branch = GitHubBranchSchema.parse({ commit: { sha: "c0ffee" } });
    expect(commitSummary(branch.commit)).toEqual({
      sha: "c0ffee",
      headline: "",
      author: null,
      date: null,
      url: null,
    });
  });
});

/// How the newest commit on a branch got there: somebody pushed it, or a pull request was merged.
describe("how a commit reached its branch", () => {
  const pull = (overrides: Record<string, unknown> = {}) => ({
    number: 42,
    title: "Tidy the guide",
    html_url: "https://github.com/ada/notes/pull/42",
    merged_at: "2026-09-02T12:00:00Z",
    merge_commit_sha: "abc",
    ...overrides,
  });

  it("is a merge when a merged pull request produced exactly this commit", () => {
    const pulls = GitHubCommitPullsSchema.parse([pull()]);
    expect(arrivalOf("abc", pulls)).toEqual({
      kind: "merge",
      number: 42,
      title: "Tidy the guide",
      url: "https://github.com/ada/notes/pull/42",
    });
  });

  it("is a push when no pull request is associated with it", () => {
    expect(arrivalOf("abc", [])).toEqual({ kind: "push" });
  });

  // GitHub associates a commit with every pull request that CONTAINS it, open ones included. Only a
  // merge that produced this very commit means it arrived by one.
  it("is a push when the pull requests that contain it did not merge it", () => {
    const pulls = GitHubCommitPullsSchema.parse([
      pull({ merged_at: null, merge_commit_sha: null }),
      pull({ number: 7, merge_commit_sha: "somewhere-else" }),
    ]);
    expect(arrivalOf("abc", pulls)).toEqual({ kind: "push" });
  });
});

describe("the addresses for one commit", () => {
  it("names a commit, the pull requests behind it, and the distance between two", () => {
    expect(commitUrl("ada", "notes", "abc")).toBe(`${GITHUB_API}/repos/ada/notes/commits/abc`);
    expect(commitPullsUrl("ada", "notes", "abc")).toBe(
      `${GITHUB_API}/repos/ada/notes/commits/abc/pulls`,
    );
    expect(commitCompareUrl("ada", "notes", "old", "new")).toBe(
      `${GITHUB_API}/repos/ada/notes/compare/old...new`,
    );
  });

  // A sha arrives from GitHub, but it is still somebody else's string on its way into a URL.
  it("keeps a sha to one segment", () => {
    expect(commitUrl("ada", "notes", "a/../b")).toBe(`${GITHUB_API}/repos/ada/notes/commits/a%2F..%2Fb`);
  });
});
