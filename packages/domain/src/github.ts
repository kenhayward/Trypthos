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

export const GitHubUserSchema = z.object({ login: z.string().min(1) });

export const GitHubRepoSchema = z.object({
  name: z.string().min(1),
  full_name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
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
});

/// What a repository's page draws. Our shape, not GitHub's - see `RepoSummary` for why.
export interface RepoStats {
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

export function repoStats(detail: z.infer<typeof GitHubRepoDetailSchema>): RepoStats {
  const spdx = detail.license?.spdx_id ?? null;

  return {
    fullName: detail.full_name,
    description: detail.description,
    private: detail.private,
    archived: detail.archived,
    topics: detail.topics,
    defaultBranch: detail.default_branch,
    url: detail.html_url,
    // An empty homepage is how GitHub spells "none" as often as null, and a blank link is not a link.
    homepage: detail.homepage === null || detail.homepage.trim() === "" ? null : detail.homepage,
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
