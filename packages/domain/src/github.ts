import { z } from "zod";
import type { ProviderError } from "./provider";
import type { WorkspaceRef } from "./workspaceRef";

/// GitHub, as far as anything pure can describe it.
///
/// The requests are made in the main process - a token must never reach the renderer - so what lives
/// here is everything that is not the fetch itself: the addresses, the schemas someone else's JSON is
/// checked against, the reading of a flat tree as a folder listing, and what a failing status means.
/// That split is what makes the awkward parts testable without a network, and it is the shape the
/// next three providers should copy.
///
/// **GitHub is not like the ones that follow.** There is no mutable file at a path: a save is a
/// commit on a branch, with history and merge conflicts rather than overwrite. Reading is the whole
/// of what this build does, so nothing here writes - and the provider interface already returns a
/// revision from a write, which is where a commit id will go when it does.

export const GITHUB_API = "https://api.github.com";

/// The header GitHub answers every request with, saying how much of the hourly budget is left.
export const RATE_LIMIT_HEADER = "x-ratelimit-remaining";

/// What the app asks to be, so a rate-limit complaint at GitHub's end can name it.
export const USER_AGENT = "Trypthos";

/// The API version this build is written against. Pinned rather than left to default, so GitHub
/// changing its default does not change what these schemas are parsing.
export const API_VERSION = "2022-11-28";

/// Someone else's JSON, so the schemas below are deliberately NOT strict: GitHub adds fields to
/// these responses regularly, and refusing a response because it grew a key would break the app on
/// a day nothing here changed. What is named is what is read; the rest is dropped.

/// One account, as `/user` and `/users/{login}` both answer.
///
/// The same shape for both, because they are the same endpoint with a different subject: one is the
/// connected account and the other is whoever owns the repository on screen. `name` is the display
/// name, which an account need never have set, and `avatar_url` is a picture GitHub serves publicly
/// - neither is a credential, and neither is required for the app to work.
export const GitHubUserSchema = z.object({
  login: z.string().min(1),
  name: z.string().nullable().catch(null),
  avatar_url: z.string().nullable().catch(null),
});

/// A repository's owner, as it appears on the repository itself.
///
/// The avatar is here because a repository already carries it - asking `/users/{login}` for a
/// picture that arrived with the repository would be a second request for something already in
/// hand. The display name is the only part that needs one.
const GitHubRepoOwnerSchema = z.object({
  login: z.string().min(1),
  avatar_url: z.string().nullable().catch(null),
});

export const GitHubRepoSchema = z.object({
  name: z.string().min(1),
  full_name: z.string().min(1),
  owner: GitHubRepoOwnerSchema,
  private: z.boolean(),
  default_branch: z.string().min(1),
  description: z.string().nullable().catch(null),
  pushed_at: z.string().nullable().catch(null),
});

export const GitHubRepoListSchema = z.array(GitHubRepoSchema);

/// One repository in full, as its own page shows it.
///
/// A separate schema from `GitHubRepoSchema` rather than more optional fields on it: the picker
/// needs a name and an owner for a hundred repositories at a time, and this needs everything about
/// exactly one. Two shapes say which call each belongs to.
///
/// **`watchers_count` is deliberately absent.** It is a legacy alias for the STAR count, not the
/// number of people watching - real watchers are `subscribers_count`. A page drawing it beside stars
/// would print the same number twice under two different labels.
/// The repository a fork was made from.
///
/// GitHub sends `parent` only on the single-repository response, and only for a fork - so its
/// absence is ordinary rather than a field that failed to arrive. The default branch is here
/// because it is the base of the comparison that says how far the fork has moved.
const GitHubRepoParentSchema = z.object({
  name: z.string().min(1),
  full_name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
  default_branch: z.string().min(1),
});

export const GitHubRepoDetailSchema = GitHubRepoSchema.extend({
  stargazers_count: z.number().catch(0),
  forks_count: z.number().catch(0),
  /// **Issues AND pull requests.** GitHub counts both here, and there is no field that separates
  /// them without a second request - so the card is labelled for what this actually is.
  open_issues_count: z.number().catch(0),
  language: z.string().nullable().catch(null),
  license: z.object({ spdx_id: z.string(), name: z.string() }).nullable().catch(null),
  topics: z.array(z.string()).catch([]),
  archived: z.boolean().catch(false),
  html_url: z.string().catch(""),
  homepage: z.string().nullable().catch(null),
  /// Absent for a repository that is nobody's fork, and absent from the LISTING even for one that
  /// is. `nullish` rather than `nullable` for exactly that reason: a field that is not there is not
  /// a field that failed.
  parent: GitHubRepoParentSchema.nullish().catch(null),
});

/// A branch listing, or a tag listing - only far enough to know one arrived.
///
/// Nothing here reads a name. The listing is fetched one item per page purely so the LAST page
/// number is the count, so what is wanted from the body is that it was the listing it claimed to
/// be. Named rather than `z.array(z.unknown())`, because a response that is not a list of refs is
/// a response this is not counting.
export const GitHubRefListSchema = z.array(z.object({ name: z.string().min(1) }));

/// How far two branches have moved apart, as `/compare` answers.
export const GitHubComparisonSchema = z.object({
  ahead_by: z.number(),
  behind_by: z.number(),
});

/// Who a repository belongs to, as its page names them.
///
/// The login is the only part that is always there. A display name is something an account may
/// never have set, and an avatar can be missing from a response - so both are absent rather than
/// empty, and the page draws a login on its own rather than a blank line under a broken picture.
export interface RepoOwner {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

/// The repository a fork was made from.
///
/// Owner and name as well as the full name: the full name is what a reader sees, and the two halves
/// are what opening it in the app needs - a `WorkspaceRef` is built from them.
export interface RepoParent {
  fullName: string;
  owner: string;
  name: string;
}

/// How far a fork has moved from what it was forked from, in commits.
export interface RepoDivergence {
  /// Commits this repository has that the upstream does not.
  ahead: number;
  /// Commits the upstream has that this repository does not.
  behind: number;
}

/// The figures that are not on the repository response, and so need requests of their own.
///
/// Every one of them is optional and every one of them can be null, because every one of them is a
/// separate request that can fail on its own. A branch count that never arrived must not take the
/// rest of the page with it - see `repoStatistics`, which is where they are gathered.
export interface RepoExtras {
  ownerName?: string | null;
  branches?: number | null;
  tags?: number | null;
  divergence?: RepoDivergence | null;
}

/// What a repository's page draws. Our shape, not GitHub's - see `RepoSummary` for why.
export interface RepoStats {
  owner: RepoOwner;
  /// Where this was forked from, or null for a repository that is nobody's fork.
  parent: RepoParent | null;
  /// How many branches and how many tags, or null when the count could not be established.
  ///
  /// **Null is not zero.** GitHub has no count field for either, so both are read off the end of a
  /// paged listing - and a listing that did not arrive says nothing about how many there are. A
  /// repository drawn as having no branches would be a wrong answer given confidently.
  branches: number | null;
  tags: number | null;
  /// Null for anything that is not a fork, and for a fork whose comparison could not be made.
  divergence: RepoDivergence | null;
  fullName: string;
  description: string | null;
  private: boolean;
  archived: boolean;
  topics: readonly string[];
  defaultBranch: string;
  url: string;
  homepage: string | null;
  stars: number;
  forks: number;
  /// GitHub counts pull requests in this as well as issues, and the card says so. A figure labelled
  /// "issues" that silently included pull requests would be a wrong answer given confidently.
  issuesAndPullRequests: number;
  language: string | null;
  license: string | null;
  pushedAt: string | null;
}

/// The identifier GitHub uses for a licence it could not recognise. Not something to print.
const UNIDENTIFIED_LICENCE = "NOASSERTION";

/// Nothing, or only whitespace, read as absent. One rule, so a blank homepage and a blank avatar
/// are not answered differently by two pieces of code that had the same question.
function blankToNull(value: string | null | undefined): string | null {
  return value === null || value === undefined || value.trim() === "" ? null : value;
}

export function repoStats(
  detail: z.infer<typeof GitHubRepoDetailSchema>,
  extras: RepoExtras = {},
): RepoStats {
  const spdx = detail.license?.spdx_id ?? null;
  const parent = detail.parent ?? null;

  return {
    owner: {
      login: detail.owner.login,
      name: extras.ownerName ?? null,
      // An empty string is how a response spells "no picture" as readily as a missing field, and a
      // blank source draws a broken image rather than nothing.
      avatarUrl: blankToNull(detail.owner.avatar_url),
    },
    parent:
      parent === null
        ? null
        : { fullName: parent.full_name, owner: parent.owner.login, name: parent.name },
    branches: extras.branches ?? null,
    tags: extras.tags ?? null,
    divergence: extras.divergence ?? null,
    fullName: detail.full_name,
    description: detail.description,
    private: detail.private,
    archived: detail.archived,
    topics: detail.topics,
    defaultBranch: detail.default_branch,
    url: detail.html_url,
    // An empty homepage is how GitHub spells "none" as often as null, and a blank link is not a link.
    homepage: blankToNull(detail.homepage),
    stars: detail.stargazers_count,
    forks: detail.forks_count,
    issuesAndPullRequests: detail.open_issues_count,
    language: detail.language,
    license: spdx === null || spdx === UNIDENTIFIED_LICENCE ? null : spdx,
    pushedAt: detail.pushed_at,
  };
}

/// One entry of a git tree. `mode` matters as much as `type`: a symlink and a document are both
/// blobs, and only the mode tells them apart.
export const GitHubTreeEntrySchema = z.object({
  path: z.string().min(1),
  mode: z.string().min(1),
  type: z.string().min(1),
  sha: z.string().min(1),
  size: z.number().optional(),
});

export const GitHubTreeSchema = z.object({
  sha: z.string().min(1),
  /// True when the repository was too big to describe in one answer. Carried rather than hidden -
  /// a tree cut short is a tree with folders missing from it, and the browser has to be able to say
  /// so rather than quietly showing less than the repository holds.
  truncated: z.boolean().catch(false),
  tree: z.array(GitHubTreeEntrySchema),
});

/// One branch, of which only the commit at its head is read. That commit is what a workspace is
/// pinned to: a branch name would move under the user while they read it.
export const GitHubBranchSchema = z.object({
  commit: z.object({ sha: z.string().min(1) }),
});

export const GitHubBlobSchema = z.object({
  sha: z.string().min(1),
  size: z.number(),
  content: z.string(),
  encoding: z.string(),
});

export type GitHubTreeEntry = z.infer<typeof GitHubTreeEntrySchema>;

/// A repository as the picker draws it. Our shape, not GitHub's: the API's names are snake_case and
/// half of what it sends is not read, and a summary that was simply the response would put both in
/// every component that touches one.
export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  pushedAt: string | null;
}

/// The file mode git gives a symlink. The blob holds the path it points at rather than a document.
const SYMLINK_MODE = "120000";

/// Whether a tree entry is a file this app will open.
///
/// Blobs only, and not symlinks. A submodule arrives as a `commit` entry whose contents are in
/// another repository entirely, so it is neither a file here nor a folder that could be expanded.
function isFileEntry(entry: GitHubTreeEntry): boolean {
  return entry.type === "blob" && entry.mode !== SYMLINK_MODE;
}

/// The children of one directory, as the folder browser lists them.
///
/// The tree arrives flat and complete - every path in the repository in one answer - so a listing is
/// a read of memory rather than a request, which is what lets the filter box and Find in Files walk
/// a repository at all.
///
/// **Folders are inferred from the paths rather than taken only from the `tree` entries.** GitHub
/// truncates a very large tree, and the entry for a directory can fall off the end while the files
/// under it remain. A folder built from the paths is there either way.
export function treeNodesAt(
  entries: readonly GitHubTreeEntry[],
  directory: string,
): { id: string; name: string; kind: "file" | "directory" }[] {
  // The separator is load-bearing, exactly as it is in the workspace guard: without it "docs"
  // would list the children of "docs-old".
  const prefix = directory === "" ? "" : `${directory}/`;

  // One map, keyed by name, so the answer comes back in the order the tree was written in - which
  // GitHub sorts by path. Nothing downstream depends on that order (the browser sorts, and so does
  // every walk), but a listing that came back in a different order each time would make two reads
  // of one folder look like two different folders.
  const children = new Map<string, { id: string; name: string; kind: "file" | "directory" }>();

  for (const entry of entries) {
    if (entry.type !== "blob" && entry.type !== "tree") continue;
    if (!entry.path.startsWith(prefix)) continue;

    const rest = entry.path.slice(prefix.length);
    if (rest === "") continue;

    const cut = rest.indexOf("/");
    const name = cut === -1 ? rest : rest.slice(0, cut);
    const id = `${prefix}${name}`;

    // Deeper than this folder means its first segment is a folder OF this one, whether or not that
    // folder has an entry of its own. A directory beats a file of the same name: git will not make
    // one, and if something did, a folder can be expanded and found empty where a file would open.
    const kind = cut === -1 && entry.type === "blob" ? "file" : "directory";

    if (kind === "file") {
      if (!isFileEntry(entry)) continue;
      if (!children.has(name)) children.set(name, { id, name, kind });
      continue;
    }

    children.set(name, { id, name, kind });
  }

  return [...children.values()];
}

/// The blob behind a path, or null when the path names no file this app opens.
///
/// Null for a directory, for a path that is not in the tree, and for a symlink - the same three
/// things `treeNodesAt` declines to list, so what can be clicked and what can be read agree.
export function blobEntryFor(
  entries: readonly GitHubTreeEntry[],
  path: string,
): { sha: string; size: number | null } | null {
  const entry = entries.find((candidate) => candidate.path === path);
  if (entry === undefined || !isFileEntry(entry)) return null;
  return { sha: entry.sha, size: entry.size ?? null };
}

/// The repositories the signed-in account owns, as summaries.
///
/// The API is asked for owned repositories AND the answer is filtered, because the two are different
/// promises: the parameter is what we requested, and this is what we show. A default list that
/// quietly included an organisation's thousand repositories is not the list the user asked for.
export function ownedRepos(
  repos: readonly z.infer<typeof GitHubRepoSchema>[],
  login: string,
): RepoSummary[] {
  const mine = login.toLowerCase();
  return repos
    .filter((repo) => repo.owner.login.toLowerCase() === mine)
    .map((repo) => ({
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      description: repo.description,
      pushedAt: repo.pushed_at,
    }));
}

/// The reference that opens a repository as a workspace.
export function repoRefFor(repo: RepoSummary): WorkspaceRef {
  return { kind: "github", owner: repo.owner, repo: repo.name };
}

/// The repositories matching what was typed in the search box.
///
/// A filter over the list already fetched rather than a call to GitHub's search endpoint: the list
/// is the user's own repositories and it is already here, so searching it is instant, works with no
/// network, and cannot be rate-limited. Searching all of GitHub is a different feature.
///
/// **The order is the order it was given.** The list arrives newest-pushed first, and a search that
/// re-ranked would read as a different set of repositories rather than fewer of the same ones.
export function matchRepos(repos: readonly RepoSummary[], query: string): RepoSummary[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return [...repos];

  return repos.filter((repo) =>
    [repo.fullName, repo.name, repo.description ?? ""].some((field) =>
      field.toLowerCase().includes(wanted),
    ),
  );
}

/// One path segment, safe to put in a URL.
///
/// Every one of these comes from outside this process - a settings file, or a listing - so a `/` in
/// one would address an endpoint nobody asked for. Encoding rather than validating, because a
/// repository name really can contain characters a URL cannot.
function segment(value: string): string {
  return encodeURIComponent(value);
}

/// Whether a ref is one git could have made.
///
/// Refused before a URL is built rather than encoded and sent, because a branch is the one name here
/// that legitimately contains separators - so it cannot be flattened into a single segment the way
/// an owner or a sha is. Git forbids `..` and an empty component in a ref name, so anything carrying
/// one did not come from a listing.
export function isSafeRef(ref: string): boolean {
  if (ref === "") return false;
  return ref.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/// A ref, with its own separators kept and everything else encoded.
///
/// `isSafeRef` is what makes this safe, and it is the caller's to ask - a ref that failed it must
/// never reach here.
function refPath(ref: string): string {
  return ref.split("/").map(segment).join("/");
}

/// One page of the repositories the account owns, newest push first.
///
/// `affiliation=owner` is what makes the default list the user's own rather than every repository
/// they can see through an organisation.
export function reposUrl(page: number): string {
  return `${GITHUB_API}/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=100&page=${page}`;
}

export function repoUrl(owner: string, repo: string): string {
  return `${GITHUB_API}/repos/${segment(owner)}/${segment(repo)}`;
}

/// One branch, which is how the commit a workspace is pinned to is found.
///
/// A branch name can contain separators, so this is the one address built from `refPath` rather than
/// a single segment. Ask `isSafeRef` first.
export function branchUrl(owner: string, repo: string, branch: string): string {
  return `${repoUrl(owner, repo)}/branches/${refPath(branch)}`;
}

/// The whole tree at a commit, in one answer. `recursive=1` is the difference between opening a
/// repository in one request and opening it in one request per folder.
///
/// A commit SHA rather than a branch name, deliberately: it is one segment with no separators to
/// worry about, and it pins the workspace to a commit that cannot move under the user while they
/// read it.
export function treeUrl(owner: string, repo: string, sha: string): string {
  return `${repoUrl(owner, repo)}/git/trees/${segment(sha)}?recursive=1`;
}

export function blobUrl(owner: string, repo: string, sha: string): string {
  return `${repoUrl(owner, repo)}/git/blobs/${segment(sha)}`;
}

/// One account's public profile, which is the only place a display name lives.
export function userUrl(login: string): string {
  return `${GITHUB_API}/users/${segment(login)}`;
}

/// The branch listing, one branch per page.
///
/// **`per_page=1` is the whole trick.** GitHub has no field anywhere that says how many branches a
/// repository has, and the only way to find out is to walk the listing to its end. Asking for one
/// item per page makes the number of the LAST page - which GitHub names in the `Link` header of the
/// first response - the number of branches, so the walk is a single request. See `countFromLink`.
export function branchCountUrl(owner: string, repo: string): string {
  return `${repoUrl(owner, repo)}/branches?per_page=1`;
}

/// The tag listing, one tag per page. The same trick, for the same reason.
export function tagCountUrl(owner: string, repo: string): string {
  return `${repoUrl(owner, repo)}/tags?per_page=1`;
}

/// How far a fork has moved from what it was forked from.
///
/// `base...head` is directional and the direction is the whole answer: the upstream is the base and
/// the fork is the head, so `ahead_by` counts what this repository has that the upstream does not.
/// Swapped, the page would report the two numbers the wrong way round and look entirely plausible.
///
/// A ref is the one name here that legitimately contains separators, so its own are kept and
/// everything else about it is encoded - the same rule `branchUrl` follows. Ask `isSafeRef` first.
export function compareUrl(
  owner: string,
  repo: string,
  base: { owner: string; ref: string },
  head: { owner: string; ref: string },
): string {
  const side = (end: { owner: string; ref: string }) => `${segment(end.owner)}:${refPath(end.ref)}`;
  return `${repoUrl(owner, repo)}/compare/${side(base)}...${side(head)}`;
}

/// The last page named in a `Link` header, which for a one-item page is a count.
///
/// GitHub answers a paged listing with a header naming the next, previous, first and last pages.
/// With one item per page the last page number IS the number of items, which is what makes a count
/// a single request instead of a walk.
///
/// **Null when it cannot be read, never zero.** No header at all means there is no page after this
/// one, so what arrived is all there is - that is a real answer. A header in a shape this does not
/// recognise is not: a repository drawn as having no branches because a header changed would be a
/// wrong answer given confidently.
export function countFromLink(link: string | null, returned: number): number | null {
  // Nothing to page through. The first page was the last page, so what came back is the whole of it.
  if (link === null || link.trim() === "") return returned;

  for (const part of link.split(",")) {
    const relation = /;\s*rel\s*=\s*"?'?last'?"?/i.exec(part);
    if (relation === null) continue;

    const address = /<([^>]*)>/.exec(part);
    if (address === null) return null;

    const page = /[?&]page=(\d+)(?:&|$)/.exec(address[1] ?? "");
    return page === null ? null : Number(page[1]);
  }

  // A header that named other pages but not a last one. Common when a listing is walked by cursor,
  // and nothing here can turn it into a total.
  return null;
}

/// What a failing response means, in the provider's vocabulary.
///
/// `rateLimitRemaining` is the `x-ratelimit-remaining` header, or null when there was not one. It is
/// the only thing that tells the two meanings of 403 apart - a spent budget is "come back later" and
/// a refused scope is "this token may not read that", and sending the user to fix the wrong one
/// costs them an hour either way.
///
/// Anything unrecognised reads as `offline`. That is the honest summary from the app's side: it
/// asked GitHub for something and has no answer it can act on.
export function githubErrorFor(status: number, rateLimitRemaining: string | null): ProviderError {
  if (status === 404) return "not-found";
  if (status === 401) return "permission-denied";
  if (status === 403) return rateLimitRemaining === "0" ? "rate-limited" : "permission-denied";
  if (status === 429) return "rate-limited";
  return "offline";
}
