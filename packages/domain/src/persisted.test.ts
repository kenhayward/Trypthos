import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadPersisted, type Migration } from "./persisted";

const Chat = z.object({
  schemaVersion: z.number(),
  title: z.string(),
  messages: z.array(z.string()),
});

const migrations: Migration[] = [
  // v1 stored a single `body` string; v2 splits it into a message list.
  { to: 2, migrate: (input) => ({ ...input, messages: [input.body], body: undefined }) },
  { to: 3, migrate: (input) => ({ ...input, title: input.title ?? "Untitled" }) },
];

const load = (raw: unknown) =>
  loadPersisted(raw, { currentVersion: 3, migrations, parse: (v) => Chat.parse(v) });

describe("loadPersisted", () => {
  it("accepts a document already at the current version", () => {
    const result = load({ schemaVersion: 3, title: "Notes", messages: ["hi"] });
    expect(result).toEqual({
      ok: true,
      migrated: false,
      value: { schemaVersion: 3, title: "Notes", messages: ["hi"] },
    });
  });

  it("migrates an older document up through every step", () => {
    const result = load({ schemaVersion: 1, title: "Notes", body: "hi" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.value).toEqual({ schemaVersion: 3, title: "Notes", messages: ["hi"] });
  });

  it("fills a field the newer schema added", () => {
    const result = load({ schemaVersion: 2, messages: ["hi"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Untitled");
  });

  // A reader that silently tolerates an unversioned document is how corruption becomes permanent:
  // it cannot tell "written before versioning" from "half-written" or "not ours".
  it("refuses a document with no schemaVersion rather than assuming one", () => {
    expect(load({ title: "Notes", messages: [] })).toEqual({
      ok: false,
      reason: "missing-version",
    });
  });

  it("refuses a document written by a newer version of the app", () => {
    expect(load({ schemaVersion: 99, title: "Notes", messages: [] })).toEqual({
      ok: false,
      reason: "from-the-future",
    });
  });

  it("refuses when the migration chain has a gap", () => {
    const result = loadPersisted(
      { schemaVersion: 1, title: "Notes" },
      { currentVersion: 3, migrations: [{ to: 3, migrate: (input) => input }], parse: (v) => Chat.parse(v) },
    );
    expect(result).toEqual({ ok: false, reason: "no-migration-path" });
  });

  it("refuses a non-object", () => {
    expect(load("just a string")).toEqual({ ok: false, reason: "not-an-object" });
    expect(load(null)).toEqual({ ok: false, reason: "not-an-object" });
  });

  it("refuses a document that does not match the schema after migrating", () => {
    const result = load({ schemaVersion: 3, title: 42, messages: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
  });
});
