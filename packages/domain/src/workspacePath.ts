/// The workspace boundary check, in one place.
///
/// Every path the folder browser or an AI tool resolves goes through this - local and cloud alike.
/// It is deliberately the only implementation: a per-provider copy is how one of them ends up subtly
/// weaker than the rest.
///
/// IMPORTANT - what this does NOT do. This is a *lexical* check. It cannot see symlinks, junctions
/// or bind mounts, because the domain package has no filesystem access by design. The main process
/// must resolve a candidate to its real path FIRST and pass that to `contains`. A lexical check
/// alone is satisfied by `notes.md` even when `notes.md` is a symlink pointing at /etc/passwd.

export type PathResolution =
  | { ok: true; path: string }
  | { ok: false; reason: PathRejection };

export type PathRejection =
  /// Nothing, or only whitespace.
  | "empty"
  /// A NUL byte or other character that cannot appear in a path.
  | "invalid-characters"
  /// Absolute, drive-qualified or UNC - anything not interpreted relative to the workspace root.
  | "not-relative"
  /// Lexically well-formed, but `..` walks above the root.
  | "escapes-workspace";

export interface PathGuardOptions {
  /// Absolute path to the workspace root. Either separator is accepted.
  root: string;
  /// Whether the underlying filesystem compares names case-insensitively. Windows and default macOS
  /// volumes do; Linux does not. The shell knows which; the domain does not, so it is passed in.
  caseInsensitive: boolean;
}

export interface PathGuard {
  /// Resolves a workspace-relative candidate to an absolute path inside the root, or explains why not.
  resolve(candidate: string): PathResolution;
  /// Whether an already-resolved absolute path lies at or under the root.
  contains(absolutePath: string): boolean;
}

/// Separators are unified so a backslash cannot smuggle traversal past a slash-only check.
function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 && value.endsWith("/") ? value.replace(/\/+$/, "") : value;
}

/// Absolute in any of the three senses that matter on Windows: rooted (`/x`, `\x`), drive-absolute
/// (`C:/x`), and drive-relative (`C:x`) - the last resolves against the drive's own working
/// directory, so it is not workspace-relative even though it carries no separator.
function isNotRelative(candidate: string): boolean {
  return /^[/\\]/.test(candidate) || /^[A-Za-z]:/.test(candidate);
}

export function createPathGuard({ root, caseInsensitive }: PathGuardOptions): PathGuard {
  const normalizedRoot = stripTrailingSlash(normalizeSeparators(root));
  const fold = (value: string): string => (caseInsensitive ? value.toLowerCase() : value);
  const foldedRoot = fold(normalizedRoot);

  return {
    resolve(candidate: string): PathResolution {
      if (candidate.trim() === "") return { ok: false, reason: "empty" };
      if (candidate.includes("\u0000")) return { ok: false, reason: "invalid-characters" };
      if (isNotRelative(candidate)) return { ok: false, reason: "not-relative" };

      const segments: string[] = [];
      for (const segment of normalizeSeparators(candidate).split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") {
          // Popping past the root is the escape, and it is caught here rather than by inspecting the
          // joined string afterwards - by then "/ws/../ws-other" looks like an ordinary path.
          if (segments.length === 0) return { ok: false, reason: "escapes-workspace" };
          segments.pop();
          continue;
        }
        segments.push(segment);
      }

      return { ok: true, path: [normalizedRoot, ...segments].join("/") };
    },

    contains(absolutePath: string): boolean {
      const target = fold(stripTrailingSlash(normalizeSeparators(absolutePath)));
      // The separator in the prefix test is load-bearing: without it "/ws-other" passes as inside "/ws".
      return target === foldedRoot || target.startsWith(`${foldedRoot}/`);
    },
  };
}
