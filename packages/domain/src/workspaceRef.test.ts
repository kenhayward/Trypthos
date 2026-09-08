import { describe, expect, it } from "vitest";
import {
  PROVIDER_KINDS,
  WorkspaceRefSchema,
  sameWorkspaceRef,
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefName,
} from "./workspaceRef";

describe("a workspace reference", () => {
  it("accepts a local folder", () => {
    const parsed = WorkspaceRefSchema.parse({ kind: "local", root: "D:\\Notes" });
    expect(parsed).toEqual({ kind: "local", root: "D:\\Notes" });
  });

  it("accepts a GitHub repository", () => {
    const parsed = WorkspaceRefSchema.parse({ kind: "github", owner: "ada", repo: "notes" });
    expect(parsed).toEqual({ kind: "github", owner: "ada", repo: "notes" });
  });

  it("refuses a kind it has never heard of", () => {
    expect(WorkspaceRefSchema.safeParse({ kind: "dropbox", id: "1" }).success).toBe(false);
  });

  // Strict, like every other IPC schema: an extra field means the two sides disagree about the
  // contract, and dropping it silently is how they diverge further.
  it("refuses a field it does not know", () => {
    const extra = { kind: "local", root: "D:\\Notes", branch: "main" };
    expect(WorkspaceRefSchema.safeParse(extra).success).toBe(false);
  });

  it("refuses a GitHub repository named by half a name", () => {
    expect(WorkspaceRefSchema.safeParse({ kind: "github", owner: "ada", repo: "" }).success).toBe(
      false,
    );
  });
});

describe("the key a reference is deduplicated by", () => {
  it("tells two providers apart even when they spell the same thing", () => {
    const local = workspaceRefKey({ kind: "local", root: "ada/notes" });
    const remote = workspaceRefKey({ kind: "github", owner: "ada", repo: "notes" });
    expect(local).not.toEqual(remote);
  });

  // Owner and repo are case-insensitive at GitHub, so "Ada/Notes" and "ada/notes" are one repo.
  // Opening it twice would be two trees over one place, each with its own idea of what is in it.
  it("folds case for a GitHub repository", () => {
    expect(workspaceRefKey({ kind: "github", owner: "Ada", repo: "Notes" })).toEqual(
      workspaceRefKey({ kind: "github", owner: "ada", repo: "notes" }),
    );
  });

  // NOT folded for a local root. Linux tells "/ws" and "/WS" apart, and a key that did not would
  // refuse to open the second of two real folders.
  it("leaves a local root exactly as it was given", () => {
    expect(workspaceRefKey({ kind: "local", root: "/ws" })).not.toEqual(
      workspaceRefKey({ kind: "local", root: "/WS" }),
    );
  });

  it("is what sameWorkspaceRef compares", () => {
    const one = { kind: "github", owner: "Ada", repo: "notes" } as const;
    const other = { kind: "github", owner: "ada", repo: "NOTES" } as const;
    expect(sameWorkspaceRef(one, other)).toBe(true);
    expect(sameWorkspaceRef(one, { kind: "github", owner: "grace", repo: "notes" })).toBe(false);
  });
});

describe("what a reference is called", () => {
  it("names a local folder by its last segment, whichever separator wrote it", () => {
    expect(workspaceRefName({ kind: "local", root: "D:\\Work\\Notes" })).toBe("Notes");
    expect(workspaceRefName({ kind: "local", root: "/home/ada/Notes" })).toBe("Notes");
  });

  // A trailing separator is a folder spelled with one, not a folder with no name.
  it("ignores a trailing separator", () => {
    expect(workspaceRefName({ kind: "local", root: "/home/ada/Notes/" })).toBe("Notes");
  });

  // A drive root's only segment is the drive itself, which is the best name it has. What matters is
  // that SOMETHING comes back: an empty name would give the workspace an id of "Folder", which names
  // nothing a person could recognise.
  it("names a drive root by its drive", () => {
    expect(workspaceRefName({ kind: "local", root: "D:\\" })).toBe("D:");
  });

  it("never answers with nothing at all", () => {
    for (const root of ["/", "\\", "D:\\", "//server/share"]) {
      expect(workspaceRefName({ kind: "local", root })).not.toBe("");
    }
  });

  // The repo alone, not "owner/repo": the id becomes the front of every path in the workspace, and
  // a slash in it would make one path look like two.
  it("names a GitHub repository by the repository", () => {
    expect(workspaceRefName({ kind: "github", owner: "ada", repo: "notes" })).toBe("notes");
  });
});

describe("the list of provider kinds", () => {
  // The registry in the shell and the picker in the interface both walk this, so a provider added
  // to one and not the other is a row that can be chosen and never opened.
  it("covers every kind the schema accepts", () => {
    for (const kind of PROVIDER_KINDS) {
      expect(typeof kind).toBe("string");
    }
    expect(PROVIDER_KINDS).toContain("local");
    expect(PROVIDER_KINDS).toContain("github");
  });
});

describe("the line under a workspace's name", () => {
  // Two folders can share a name, and the tree shows only the name - so the tooltip has to say the
  // one thing that tells them apart.
  it("names a local folder by its whole path", () => {
    expect(workspaceRefLabel({ kind: "local", root: "D:/Work/Notes" })).toBe("D:/Work/Notes");
  });

  // The owner as well as the repository, which is exactly what the id cannot carry: an id may not
  // contain a separator, and two owners can each have a repository called `notes`.
  it("names a GitHub repository by its owner and repository together", () => {
    expect(workspaceRefLabel({ kind: "github", owner: "ada", repo: "notes" })).toBe("ada/notes");
  });
});
