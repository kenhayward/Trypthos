import { z } from "zod";

/// Which place a workspace is, named in a way both processes and the settings file can carry.
///
/// A workspace used to be an absolute path and nothing else. It cannot stay one: a GitHub repository
/// has no path, and the next three providers have an account and an opaque node id rather than a
/// root. So a workspace is named by a REFERENCE - a small discriminated union whose `kind` says
/// which provider answers for it.
///
/// **Why a union and not a string with a prefix.** `github:ada/notes` beside `D:\Notes` in one array
/// is a format nothing validates: the split rule lives at every call site, a Windows root already
/// contains a colon, and a folder called `github:` is a path a person can really make. The union is
/// parsed once, at the boundary, like every other thing this app persists.
///
/// **This is the one place a new provider is added.** A kind here, a row in the shell's registry, and
/// a case in the interface's picker - and `PROVIDER_KINDS` below is what a test uses to catch the
/// second and third being forgotten.

export const LocalWorkspaceRefSchema = z
  .object({
    kind: z.literal("local"),
    /// Absolute path to the folder. Chosen by the user through the native dialog, never named by
    /// the renderer - see the note at the top of `preload.js`.
    root: z.string().min(1),
  })
  .strict();

export const GitHubWorkspaceRefSchema = z
  .object({
    kind: z.literal("github"),
    /// The account or organisation the repository belongs to.
    owner: z.string().min(1),
    /// The repository's own name, without the owner on the front.
    ///
    /// Two fields rather than one `full_name`, because every call to the API wants them apart and a
    /// string that had to be split again at each one is a split rule per call site.
    repo: z.string().min(1),
  })
  .strict();

export const WorkspaceRefSchema = z.discriminatedUnion("kind", [
  LocalWorkspaceRefSchema,
  GitHubWorkspaceRefSchema,
]);

export type WorkspaceRef = z.infer<typeof WorkspaceRefSchema>;
export type ProviderKind = WorkspaceRef["kind"];

/// Every provider this build knows how to open.
///
/// Walked by the shell's registry test and by the interface's source picker, so a kind added to the
/// schema and forgotten in either shows up as a failing test rather than as a row that can be
/// chosen and never opened.
export const PROVIDER_KINDS = ["local", "github"] as const satisfies readonly ProviderKind[];

/// The last segment of a path, whichever separator wrote it. "" when there is none to take.
function lastSegment(value: string): string {
  const segments = value.replace(/\\/g, "/").split("/");
  return segments.filter((segment) => segment !== "").at(-1) ?? "";
}

/// What this workspace is called: the folder's name, or the repository's.
///
/// The name becomes the workspace's id, which is the front of every path inside it - so it is the
/// repository alone rather than `owner/repo`, because a slash in an id would make one path look like
/// two. Two repositories with the same name from different owners are deduplicated by
/// `workspaceIdFor` exactly as two folders with the same name already are.
export function workspaceRefName(ref: WorkspaceRef): string {
  if (ref.kind === "github") return ref.repo;
  // A drive root has no segment to take, and an empty name would leave the workspace called
  // "Folder" - which says less than "D:\" does.
  return lastSegment(ref.root) || ref.root;
}

/// A string that is the same for two references naming the same place, and different otherwise.
///
/// Opening one place twice must be one workspace, not two: two trees over one repository would be
/// two sets of tabs for the same files, each with its own idea of what is in them.
///
/// **Case is folded for GitHub and not for a local root**, because that is what is true of each.
/// Owner and repository names are case-insensitive at GitHub, so `Ada/Notes` and `ada/notes` are one
/// repository; Linux tells `/ws` and `/WS` apart, and folding there would refuse to open the second
/// of two folders that really do both exist.
export function workspaceRefKey(ref: WorkspaceRef): string {
  return ref.kind === "github"
    ? `github:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`
    : `local:${ref.root}`;
}

/// Whether two references name the same place. The comparison is the key above and nothing else, so
/// there is one rule rather than one per call site.
export function sameWorkspaceRef(one: WorkspaceRef, other: WorkspaceRef): boolean {
  return workspaceRefKey(one) === workspaceRefKey(other);
}

/// The whole of what a workspace is, in one line.
///
/// What the browser puts under - or beside - the name. The name alone is ambiguous by design: it is
/// the last segment of a path or a bare repository name, and two of either can be identical. This is
/// the line that tells them apart, and it is the only place the owner of a repository appears, since
/// a workspace id may not contain a separator.
export function workspaceRefLabel(ref: WorkspaceRef): string {
  return ref.kind === "github" ? `${ref.owner}/${ref.repo}` : ref.root;
}
