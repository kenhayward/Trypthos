"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGitHubApi } = require("../src/githubApi");

/// The GitHub half of the shell, with the network replaced.
///
/// Every request is recorded so the tests can assert on the HEADERS as well as the answers: the
/// token goes in one, and a request that forgot it would still succeed against a public repository
/// and then fail against the private one the user actually opened.

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function apiWith(routes, { token = "ghp_invented" } = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, headers: options?.headers ?? {} });
    const answer = routes[url];
    if (answer === undefined) throw new Error(`no route for ${url}`);
    return typeof answer === "function" ? answer() : answer;
  };

  const api = createGitHubApi({
    getToken: async () => token,
    fetch,
    logger: { warn: () => {}, error: () => {} },
  });
  return { api, calls };
}

const USER = "https://api.github.com/user";
const REPOS_1 = "https://api.github.com/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=100&page=1";
const REPOS_2 = "https://api.github.com/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=100&page=2";

test("asks GitHub who the token belongs to", async () => {
  const { api, calls } = apiWith({ [USER]: jsonResponse({ login: "ada" }) });

  assert.deepEqual(await api.whoami(), { ok: true, login: "ada" });
  assert.equal(calls[0].headers.Authorization, "Bearer ghp_invented");
  // Without this GitHub answers with whatever its default version happens to be that week.
  assert.equal(calls[0].headers["X-GitHub-Api-Version"], "2022-11-28");
});

// The token never leaves the main process, so "is it any good" cannot be answered in the renderer.
// A missing token is not a network failure and must not be reported as one.
test("says it is not connected rather than calling with no token", async () => {
  const { api, calls } = apiWith({}, { token: null });

  assert.deepEqual(await api.whoami(), { ok: false, reason: "not-connected" });
  assert.equal(calls.length, 0);
});

test("reads a rejected token as permission denied", async () => {
  const { api } = apiWith({ [USER]: jsonResponse({ message: "Bad credentials" }, { status: 401 }) });
  assert.deepEqual(await api.whoami(), { ok: false, reason: "permission-denied" });
});

// A network that is not there throws rather than answering, and an unhandled rejection in the main
// process reaches the renderer as an opaque string rather than as anything anyone could act on.
test("reads a connection that never happened as offline", async () => {
  const api = createGitHubApi({
    getToken: async () => "ghp_invented",
    fetch: async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    },
    logger: { warn: () => {}, error: () => {} },
  });

  assert.deepEqual(await api.whoami(), { ok: false, reason: "offline" });
});

// GitHub answers a response the schema does not recognise the same way it answers nothing at all.
// Trusting a shape that failed to parse is how a malformed answer becomes a listing.
test("reads an answer of the wrong shape as offline rather than trusting it", async () => {
  const { api } = apiWith({ [USER]: jsonResponse({ name: "ada" }) });
  assert.deepEqual(await api.whoami(), { ok: false, reason: "offline" });
});

test("collects every page of the repositories the account owns", async () => {
  const page = (name) => ({
    name,
    full_name: `ada/${name}`,
    owner: { login: "ada" },
    private: false,
    default_branch: "main",
    description: null,
    pushed_at: null,
  });
  const first = Array.from({ length: 100 }, (_, at) => page(`repo-${at}`));

  const { api, calls } = apiWith({
    [USER]: jsonResponse({ login: "ada" }),
    [REPOS_1]: jsonResponse(first),
    [REPOS_2]: jsonResponse([page("last")]),
  });

  const result = await api.ownedRepositories();
  assert.equal(result.ok, true);
  assert.equal(result.repos.length, 101);
  assert.equal(result.repos.at(-1).name, "last");
  // A short page means there is no next one, so a third request would be a wasted round trip
  // against an hourly budget.
  assert.equal(calls.filter((call) => call.url.includes("/user/repos")).length, 2);
});

// Repositories from an organisation the user merely belongs to are not "their own repos", however
// the API came to include them.
test("keeps only the repositories the signed-in account owns", async () => {
  const { api } = apiWith({
    [USER]: jsonResponse({ login: "ada" }),
    [REPOS_1]: jsonResponse([
      {
        name: "notes",
        full_name: "ada/notes",
        owner: { login: "ada" },
        private: true,
        default_branch: "main",
        description: null,
        pushed_at: null,
      },
      {
        name: "handbook",
        full_name: "acme/handbook",
        owner: { login: "acme" },
        private: false,
        default_branch: "main",
        description: null,
        pushed_at: null,
      },
    ]),
  });

  const result = await api.ownedRepositories();
  assert.deepEqual(
    result.repos.map((repo) => repo.fullName),
    ["ada/notes"],
  );
});

test("resolves a repository to the commit at the head of its default branch", async () => {
  const { api } = apiWith({
    "https://api.github.com/repos/ada/notes": jsonResponse({
      name: "notes",
      full_name: "ada/notes",
      owner: { login: "ada" },
      private: true,
      default_branch: "main",
      description: null,
      pushed_at: null,
    }),
    "https://api.github.com/repos/ada/notes/branches/main": jsonResponse({
      name: "main",
      commit: { sha: "c0ffee" },
    }),
  });

  assert.deepEqual(await api.defaultBranchHead("ada", "notes"), {
    ok: true,
    branch: "main",
    sha: "c0ffee",
  });
});

// The repository is real and the token cannot see it, or it is not there at all - and from here
// those are the same answer, which is what GitHub intends.
test("reads a repository it cannot see as not found", async () => {
  const { api } = apiWith({
    "https://api.github.com/repos/ada/secret": jsonResponse({}, { status: 404 }),
  });

  assert.deepEqual(await api.defaultBranchHead("ada", "secret"), {
    ok: false,
    reason: "not-found",
  });
});

test("fetches the whole tree at a commit in one request", async () => {
  const { api, calls } = apiWith({
    "https://api.github.com/repos/ada/notes/git/trees/c0ffee?recursive=1": jsonResponse({
      sha: "c0ffee",
      truncated: false,
      tree: [{ path: "README.md", mode: "100644", type: "blob", sha: "b1", size: 4 }],
    }),
  });

  const result = await api.tree("ada", "notes", "c0ffee");
  assert.equal(result.ok, true);
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.entries.map((entry) => entry.path),
    ["README.md"],
  );
  assert.ok(calls[0].url.includes("recursive=1"), "one request, not one per folder");
});

test("carries the truncation flag rather than hiding it", async () => {
  const { api } = apiWith({
    "https://api.github.com/repos/ada/notes/git/trees/c0ffee?recursive=1": jsonResponse({
      sha: "c0ffee",
      truncated: true,
      tree: [],
    }),
  });

  assert.equal((await api.tree("ada", "notes", "c0ffee")).truncated, true);
});

test("fetches a blob and hands back its bytes", async () => {
  const { api } = apiWith({
    "https://api.github.com/repos/ada/notes/git/blobs/b1": jsonResponse({
      sha: "b1",
      size: 5,
      // Base64 arrives wrapped across lines, which Buffer copes with - but the test is what says so.
      content: "aGVsbG8=\n",
      encoding: "base64",
    }),
  });

  const result = await api.blob("ada", "notes", "b1");
  assert.equal(result.ok, true);
  assert.equal(result.bytes.toString("utf8"), "hello");
});

// A blob too big for the API to inline comes back with no content and an encoding saying so.
// Reading that as an empty document would show the user an empty file and then offer to save it.
test("refuses a blob GitHub declined to inline rather than reading it as empty", async () => {
  const { api } = apiWith({
    "https://api.github.com/repos/ada/notes/git/blobs/b1": jsonResponse({
      sha: "b1",
      size: 104857600,
      content: "",
      encoding: "none",
    }),
  });

  assert.deepEqual(await api.blob("ada", "notes", "b1"), { ok: false, reason: "unsupported" });
});

// The two meanings of 403 send the user in opposite directions - wait an hour, or fix the token's
// scopes - so the header that tells them apart has to be read.
test("tells a spent rate limit from a refused scope", async () => {
  const spent = apiWith({
    [USER]: jsonResponse({}, { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
  });
  assert.deepEqual(await spent.api.whoami(), { ok: false, reason: "rate-limited" });

  const refused = apiWith({
    [USER]: jsonResponse({}, { status: 403, headers: { "x-ratelimit-remaining": "4998" } }),
  });
  assert.deepEqual(await refused.api.whoami(), { ok: false, reason: "permission-denied" });
});
