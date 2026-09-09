"use strict";

const {
  API_VERSION,
  GITHUB_API,
  GitHubBlobSchema,
  GitHubBranchSchema,
  GitHubComparisonSchema,
  GitHubRefListSchema,
  GitHubRepoDetailSchema,
  GitHubRepoListSchema,
  GitHubRepoSchema,
  GitHubTreeSchema,
  GitHubUserSchema,
  RATE_LIMIT_HEADER,
  USER_AGENT,
  blobUrl,
  branchCountUrl,
  branchUrl,
  compareUrl,
  countFromLink,
  githubErrorFor,
  isSafeRef,
  ownedRepos,
  repoStats,
  repoUrl,
  reposUrl,
  tagCountUrl,
  treeUrl,
  userUrl,
} = require("@trypthos/domain");

/// The calls to GitHub, and nothing else.
///
/// **This lives in the main process and cannot move.** The token is read here and never leaves: a
/// renderer that could make these calls would hold the token, and a token in a renderer is a token
/// in devtools, in the network panel, and in a renderer crash dump. That is the same rule the chat
/// provider follows, and for the same reason.
///
/// Everything that is not the fetch itself - the addresses, the schemas, what a status means - is in
/// the domain, so it is tested without a network. What is here is the request, the token, and the
/// turning of exceptions into results.
///
/// **Nothing here throws outward.** A network that is not there rejects rather than answering, and
/// an unhandled rejection in the main process reaches the renderer as an opaque string rather than
/// as anything anyone could act on. Every path answers with `{ ok: false, reason }` instead.

/// How many pages of repositories to ask for before stopping.
///
/// A bound about EFFORT rather than a belief about how many anyone has. Each page is a round trip
/// against an hourly budget, and a thousand repositories is already more than a picker can be
/// scrolled through - the search box is the answer to a list that long, not more requests.
const MAX_REPO_PAGES = 10;

const PER_PAGE = 100;

/// How long to wait for GitHub before giving up on a request.
///
/// **A request with nothing to give up on it can hang for ever**, and this one is awaited by an IPC
/// handler the interface is waiting on - so a proxy that swallows the connection, a firewall, or a
/// dropped link leaves a dialog spinning with nothing to say. Generous rather than tight: a tree for
/// a large repository is a real amount of data, and giving up on a slow answer is its own bug.
const DEFAULT_TIMEOUT_MS = 30_000;

function failure(reason) {
  return { ok: false, reason };
}

function createGitHubApi({
  getToken,
  fetch = globalThis.fetch,
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  /// One request, with the token on it, parsed by the schema the caller names.
  ///
  /// The schema is not optional and there is no raw variant: someone else's JSON annotated with a
  /// shape is a claim, and a listing built from a claim is a listing built from whatever arrived.
  async function request(url, schema) {
    const token = await getToken();
    // Not a network failure, and it must not be reported as one: "you are not connected" and
    // "GitHub could not be reached" send the user to different places.
    if (typeof token !== "string" || token === "") return failure("not-connected");

    // Every request is abortable, and every request is given up on. Without this a hung connection
    // is awaited for ever by a handler the interface is waiting on - which reaches the user as a
    // dialog that spins with no error and no way out, rather than as anything they can act on.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timed out")), timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": API_VERSION,
          "User-Agent": USER_AGENT,
        },
      });
    } catch (error) {
      // Deliberately not logging the URL with the message: a repository name is the user's, and a
      // log is not where it belongs. The message alone says what happened.
      logger.error?.(`A request to GitHub did not complete: ${error.message}`);
      return failure("offline");
    } finally {
      // Cleared whichever way this went. A timer left running would abort nothing useful and keep
      // the process awake for its duration.
      clearTimeout(timer);
    }

    if (!response.ok) {
      return failure(githubErrorFor(response.status, response.headers.get(RATE_LIMIT_HEADER)));
    }

    let body;
    try {
      body = await response.json();
    } catch {
      logger.error?.("GitHub answered with something that is not JSON.");
      return failure("offline");
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // Reported as a failure rather than worked around. An answer whose shape we do not recognise
      // is one we cannot read, and reading it anyway is how a malformed response becomes a listing.
      logger.error?.("GitHub answered in a shape this build does not recognise.");
      return failure("offline");
    }

    // The headers come back with the body because one caller needs them: a branch count is read off
    // the `Link` header rather than out of the JSON, and GitHub has no field anywhere that carries
    // it. Nothing else looks at them.
    return { ok: true, value: parsed.data, headers: response.headers };
  }

  /// How many items a listing holds, asked as one request.
  ///
  /// **Null for anything that did not work.** A count is a decoration on a page that is worth
  /// reading without it, so a spent rate limit or a repository whose branches this token may not
  /// list takes the number away rather than the page - and null says "unknown", which is a
  /// different thing from a repository with no branches.
  async function countOf(url) {
    const result = await request(url, GitHubRefListSchema);
    if (!result.ok) return null;
    return countFromLink(result.headers.get("link"), result.value.length);
  }

  /// The display name on an account, or null.
  ///
  /// A separate request because a repository does not carry one: it names its owner's login and
  /// serves their picture, and the name they go by lives only on the profile. Null when the profile
  /// could not be read, which leaves the page showing a login on its own.
  async function displayName(login) {
    const result = await request(userUrl(login), GitHubUserSchema);
    return result.ok ? result.value.name : null;
  }

  /// How far a fork has moved from what it was forked from, or null.
  ///
  /// Null for a repository that is nobody's fork, which is most of them - and the request is not
  /// made at all in that case, because a comparison against an upstream that is not there is a
  /// round trip spent on an hourly budget for no answer.
  ///
  /// Null too when the comparison cannot be made: two histories with no common ancestor, or a
  /// difference too large for GitHub to compute, both of which are ordinary rather than broken.
  async function aheadBehind(owner, repo, detail) {
    const parent = detail.parent;
    if (parent === null || parent === undefined) return null;

    const base = parent.default_branch;
    const head = detail.default_branch;
    // A ref git could not have made did not come from GitHub, and is not turned into a URL.
    if (!isSafeRef(base) || !isSafeRef(head)) return null;

    const url = compareUrl(
      owner,
      repo,
      { owner: parent.owner.login, ref: base },
      { owner: detail.owner.login, ref: head },
    );
    const result = await request(url, GitHubComparisonSchema);
    return result.ok ? { ahead: result.value.ahead_by, behind: result.value.behind_by } : null;
  }

  /// Who the stored token belongs to.
  ///
  /// This is also how a token is verified: there is no way to check one but to use it, and asking
  /// GitHub gets the account name and the verdict in a single request.
  async function whoami() {
    const result = await request(`${GITHUB_API}/user`, GitHubUserSchema);
    return result.ok ? { ok: true, login: result.value.login } : result;
  }

  /// Every repository the connected account owns, public and private, newest push first.
  ///
  /// Paged until a short page arrives, which is how the API says there is no next one - a request
  /// for the page after that would be a wasted round trip against an hourly budget.
  async function ownedRepositories() {
    const who = await whoami();
    if (!who.ok) return who;

    const collected = [];
    for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
      const result = await request(reposUrl(page), GitHubRepoListSchema);
      if (!result.ok) return result;

      collected.push(...result.value);
      if (result.value.length < PER_PAGE) break;
    }

    // Filtered as well as requested. `affiliation=owner` is what we asked for; this is what we
    // show, and the two being separate is what keeps an organisation's repositories out of a list
    // labelled as the user's own.
    return { ok: true, repos: ownedRepos(collected, who.login) };
  }

  /// The repository's default branch, and the commit at the head of it.
  ///
  /// Two requests rather than one, and the second is what pins the workspace to a COMMIT. A branch
  /// name would move under the user while they read - somebody pushes, and the tree they are
  /// browsing stops matching the files they open.
  async function defaultBranchHead(owner, repo) {
    const found = await request(repoUrl(owner, repo), GitHubRepoSchema);
    if (!found.ok) return found;

    const branch = found.value.default_branch;
    // A branch git could not have made did not come from GitHub, and is not turned into a URL.
    if (!isSafeRef(branch)) return failure("unsupported");

    const head = await request(branchUrl(owner, repo, branch), GitHubBranchSchema);
    if (!head.ok) return head;

    return { ok: true, branch, sha: head.value.commit.sha };
  }

  /// One repository in full, for its own page.
  ///
  /// A separate call from the picker's listing rather than something carried on it: the listing
  /// fetches a hundred repositories at a time and needs a name, and this needs everything about
  /// exactly one. Made when the page opens, so a user who never opens one never asks for it.
  /// **Five requests, and only the first of them can fail the page.** The repository itself is what
  /// the page IS; the display name, the two counts and the comparison with an upstream are figures
  /// GitHub keeps nowhere else, and every one of them is a decoration on a page that is worth
  /// reading without it. So they are gathered together - they do not depend on each other, and a
  /// page that waited for each in turn would take four times as long for no reason - and each one
  /// answers null rather than throwing.
  async function repoStatistics(owner, repo) {
    const result = await request(repoUrl(owner, repo), GitHubRepoDetailSchema);
    if (!result.ok) return result;

    const detail = result.value;
    const [ownerName, branches, tags, divergence] = await Promise.all([
      displayName(detail.owner.login),
      countOf(branchCountUrl(owner, repo)),
      countOf(tagCountUrl(owner, repo)),
      aheadBehind(owner, repo, detail),
    ]);

    return { ok: true, stats: repoStats(detail, { ownerName, branches, tags, divergence }) };
  }

  /// Every path in the repository at one commit, in a single request.
  ///
  /// `recursive=1` is the difference between opening a repository in one request and opening it in
  /// one per folder - and it is what lets the filter box and Find in Files walk a repository at
  /// all, since every listing after this is a read of memory.
  async function tree(owner, repo, sha) {
    const result = await request(treeUrl(owner, repo, sha), GitHubTreeSchema);
    if (!result.ok) return result;

    return { ok: true, entries: result.value.tree, truncated: result.value.truncated };
  }

  /// One file's bytes.
  ///
  /// Bytes rather than text, like the local backend's `readBytes`: whether these are a document or a
  /// picture is the caller's question, and decoding here would answer it wrongly for one of them.
  async function blob(owner, repo, sha) {
    const result = await request(blobUrl(owner, repo, sha), GitHubBlobSchema);
    if (!result.ok) return result;

    // A blob too big to inline comes back with no content and an encoding saying so. Reading that
    // as an empty document would show the user an empty file and then offer to save it back.
    if (result.value.encoding !== "base64") return failure("unsupported");

    return { ok: true, bytes: Buffer.from(result.value.content, "base64") };
  }

  return { whoami, ownedRepositories, defaultBranchHead, repoStatistics, tree, blob };
}

module.exports = { createGitHubApi, MAX_REPO_PAGES };
