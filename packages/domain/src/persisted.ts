/// Reading anything the app previously wrote to disk.
///
/// Two rules this exists to enforce, both of which are quiet when broken:
///
///  1. Every persisted document carries a `schemaVersion`, and a reader NEVER guesses one. An
///     unversioned document is refused, because a reader cannot distinguish "written before we
///     versioned" from "half-written" from "not ours" - and tolerating it writes the guess back.
///  2. The shape is validated by a schema at the boundary, not asserted by a type annotation.
///     `JSON.parse(...) as Chat` is a claim; `Chat.parse(...)` is a check.

export interface Migration {
  /// The version this migration produces. Migrations are applied in ascending order.
  to: number;
  migrate: (input: Record<string, unknown>) => Record<string, unknown>;
}

export type LoadFailure =
  /// Not a JSON object at all.
  | "not-an-object"
  /// No `schemaVersion` field. Refused rather than assumed - see rule 1 above.
  | "missing-version"
  /// Written by a newer build than this one. Refusing protects the user's data from a downgrade.
  | "from-the-future"
  /// Its version is older than current, but no chain of migrations reaches current from it.
  | "no-migration-path"
  /// Migrated cleanly but does not satisfy the schema.
  | "invalid";

export type LoadResult<T> =
  | { ok: true; value: T; migrated: boolean }
  | { ok: false; reason: LoadFailure };

export interface LoadOptions<T> {
  currentVersion: number;
  migrations: Migration[];
  /// Throws when the input does not match. A zod schema's `parse` satisfies this directly.
  parse: (input: unknown) => T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadPersisted<T>(raw: unknown, options: LoadOptions<T>): LoadResult<T> {
  const { currentVersion, migrations, parse } = options;

  if (!isRecord(raw)) return { ok: false, reason: "not-an-object" };

  const version = raw["schemaVersion"];
  if (typeof version !== "number") return { ok: false, reason: "missing-version" };
  if (version > currentVersion) return { ok: false, reason: "from-the-future" };

  let document = raw;
  let at = version;

  if (at < currentVersion) {
    const pending = migrations
      .filter((migration) => migration.to > at)
      .sort((a, b) => a.to - b.to);

    for (const migration of pending) {
      // Each migration must land on exactly the next version it claims. A gap means some earlier
      // shape would be fed to a migration that never expected it, which is worse than refusing.
      if (migration.to !== at + 1) return { ok: false, reason: "no-migration-path" };
      document = { ...migration.migrate(document), schemaVersion: migration.to };
      at = migration.to;
    }

    if (at !== currentVersion) return { ok: false, reason: "no-migration-path" };
  }

  try {
    return { ok: true, value: parse(document), migrated: version !== currentVersion };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
