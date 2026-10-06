import { describe, expect, it } from "vitest";
import {
  PROVIDER_KINDS,
  WorkspaceRefSchema,
  identicalWorkspaceRefs,
  sameWorkspaceRef,
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefMark,
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

  // A folder chosen from Obsidian's vault list is still a local folder - it is read and saved
  // exactly as one - but it remembers where it was chosen from, which is what draws its mark.
  it("accepts a local folder that was opened as an Obsidian vault", () => {
    const parsed = WorkspaceRefSchema.parse({ kind: "local", root: "D:\\Garden", origin: "obsidian" });
    expect(parsed).toEqual({ kind: "local", root: "D:\\Garden", origin: "obsidian" });
  });

  it("refuses an origin it has never heard of", () => {
    const other = { kind: "local", root: "D:\\Garden", origin: "logseq" };
    expect(WorkspaceRefSchema.safeParse(other).success).toBe(false);
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

  // One folder is one workspace however it was chosen. Opening a vault that is already open as a
  // plain folder selects that folder rather than drawing a second tree over the same files.
  it("ignores where a local folder was chosen from", () => {
    expect(workspaceRefKey({ kind: "local", root: "/v/Garden", origin: "obsidian" })).toEqual(
      workspaceRefKey({ kind: "local", root: "/v/Garden" }),
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

describe("the mark a workspace is drawn with", () => {
  it("is the provider's for a folder and a repository", () => {
    expect(workspaceRefMark({ kind: "local", root: "/v/Notes" })).toBe("local");
    expect(workspaceRefMark({ kind: "github", owner: "ada", repo: "notes" })).toBe("github");
  });

  it("is Obsidian's for a folder opened as a vault", () => {
    expect(workspaceRefMark({ kind: "local", root: "/v/Garden", origin: "obsidian" })).toBe("obsidian");
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

describe("a Google Drive folder", () => {
  const ref = { kind: "google-drive" as const, folderId: "1H60yEnI5d4", name: "Notes" };

  it("parses, with or without the Shared Drive it lives in", () => {
    expect(WorkspaceRefSchema.parse(ref)).toEqual(ref);
    expect(WorkspaceRefSchema.parse({ ...ref, driveId: "0AbcDEF" })).toEqual({ ...ref, driveId: "0AbcDEF" });
  });

  // Ids reach a Drive query string; the schema is the boundary that keeps them ids.
  it("refuses an id that is not a Drive id, and an unknown field", () => {
    expect(WorkspaceRefSchema.safeParse({ ...ref, folderId: "a' or 'b" }).success).toBe(false);
    expect(WorkspaceRefSchema.safeParse({ ...ref, driveId: "../x" }).success).toBe(false);
    expect(WorkspaceRefSchema.safeParse({ ...ref, name: "" }).success).toBe(false);
    expect(WorkspaceRefSchema.safeParse({ ...ref, extra: 1 }).success).toBe(false);
  });

  it("is named, keyed, labelled and marked as a Drive folder", () => {
    expect(workspaceRefName(ref)).toBe("Notes");
    expect(workspaceRefKey(ref)).toBe("google-drive:1H60yEnI5d4");
    expect(workspaceRefLabel(ref)).toBe("Google Drive / Notes");
    expect(workspaceRefMark(ref)).toBe("google-drive");
    expect(PROVIDER_KINDS).toContain("google-drive");
  });

  // The id is the folder; the name is only what it was called. A rename in Drive is the same folder.
  it("is the same workspace whatever it was called when chosen", () => {
    expect(sameWorkspaceRef(ref, { ...ref, name: "Renamed" })).toBe(true);
    expect(sameWorkspaceRef(ref, { ...ref, folderId: "1H60yEnI5d5" })).toBe(false);
  });

  it("remembers My Drive's real id beside the alias, and is still one workspace", () => {
    const pinned = { kind: "google-drive" as const, folderId: "root", rootId: "0ARealRootId", name: "My Drive" };
    expect(WorkspaceRefSchema.parse(pinned)).toEqual(pinned);
    expect(WorkspaceRefSchema.safeParse({ ...pinned, rootId: "a' or 'b" }).success).toBe(false);
    expect(sameWorkspaceRef(pinned, { kind: "google-drive", folderId: "root", name: "My Drive" })).toBe(true);
  });
});

// "The same place" is not "nothing to write": a ref that gained a field is the same place with
// something new to remember, and a key comparison would never let it reach the settings file.
describe("identicalWorkspaceRefs", () => {
  const stored = { kind: "google-drive" as const, folderId: "root", name: "My Drive" };

  it("is true for the same list, whatever order the fields were written in", () => {
    expect(
      identicalWorkspaceRefs(
        [{ kind: "local", root: "D:/Notes" }, stored],
        [{ root: "D:/Notes", kind: "local" }, { name: "My Drive", folderId: "root", kind: "google-drive" }],
      ),
    ).toBe(true);
  });

  it("is false when a ref gained a field the key ignores", () => {
    expect(identicalWorkspaceRefs([stored], [{ ...stored, rootId: "0ARealRootId" }])).toBe(false);
  });

  it("is false when the name changed, or the lists differ in length or order", () => {
    expect(identicalWorkspaceRefs([stored], [{ ...stored, name: "Renamed" }])).toBe(false);
    expect(identicalWorkspaceRefs([stored], [])).toBe(false);
    const local = { kind: "local" as const, root: "D:/Notes" };
    expect(identicalWorkspaceRefs([local, stored], [stored, local])).toBe(false);
  });
});
