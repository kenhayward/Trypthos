import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GUIDE_PATH, MAX_TEXT_FILE_BYTES } from "@trypthos/domain";
import { failureKey, failureParams, parentOf, useWorkspace, withoutSubtree } from "./useWorkspace";
import type { CommitChoice, ConfirmDiscard, WorkspaceActions } from "./useWorkspace";
import type { ReadResult, WorkspaceClient, WriteResult } from "../lib/workspaceClient";

/// A hand-written fake, not a mocking library. It records what it was asked to do, which is what most
/// of these assertions are actually about - particularly that a save presents the revision the file
/// was read at.
function fakeClient(overrides: Partial<WorkspaceClient> = {}) {
  const writes: { path: string; content: string; revision: string | null; message: string | null }[] = [];
  const reads: string[] = [];
  const saveAsCalls: { workspaceId: string; path: string | null; content: string }[] = [];

  const client: WorkspaceClient = {
    // Chat's map of the folder. Nothing in this hook asks for it; it is here because the client is
    // one interface.
    workspaceOutline: async () => ({ ok: true, outline: { path: "", paths: [], truncated: false } }),
    // Find in Files, for the same reason: this hook never searches, and the client is one interface.
    findInFiles: async () => ({ ok: true, hits: [], capped: false }),
    // The browser's filter box, which is `useFileFilter`'s - here for the same reason again.
    filterFiles: async () => ({ ok: true, paths: [], truncated: false }),
    // The id the main process minted. It is the first segment of every path in this workspace,
    // which is what makes a path say which of the open folders it is in.
    openWorkspace: async () => ({
      ok: true,
      workspace: { id: "ws", name: "ws", ref: { kind: "local" as const, root: "/ws" }, truncated: false },
    }),
    // A reference in, a workspace out. The fake mints the id from the reference so a test can name
    // the folder it expects to see in the tree.
    openWorkspaceRef: async (ref) => ({
      ok: true,
      workspace:
        ref.kind === "github"
          ? { id: ref.repo, name: ref.repo, ref, truncated: false }
          : { id: ref.root.replace(/^\//, ""), name: "ws", ref, truncated: false },
    }),
    // Qualified ids, as the shell answers with - so the renderer never has to work out which
    // workspace a row belongs to.
    listDirectory: async (path) => ({
      ok: true,
      nodes: path.includes("/")
        ? [{ id: `${path}/inner.md`, name: "inner.md", kind: "file" }]
        : [
            { id: `${path}/b.md`, name: "b.md", kind: "file" },
            { id: `${path}/notes`, name: "notes", kind: "directory" },
            { id: `${path}/a.md`, name: "a.md", kind: "file" },
          ],
    }),
    readFile: async (path): Promise<ReadResult> => {
      reads.push(path);
      return { ok: true, content: "# On disk\n", revision: { id: "r1" } };
    },
    readImage: async (path) => {
      reads.push(path);
      return { ok: true as const, dataUrl: `data:image/png;base64,${path}` };
    },
    writeFile: async (path, content, expectedRevision, message = null): Promise<WriteResult> => {
      writes.push({ path, content, revision: expectedRevision?.id ?? null, message });
      return { ok: true, revision: { id: "r2" } };
    },
    // The dialog lives in the shell, so the fake stands in for the whole of it: what came back is
    // what the user picked. Note there is no destination to pass in - see `SaveAsRequest`.
    saveFileAs: async (workspaceId, path, content) => {
      saveAsCalls.push({ workspaceId, path, content });
      return { ok: true, path: `${workspaceId}/chosen.md`, revision: { id: "r-saved-as" } };
    },
    closeWorkspace: async () => ({ ok: true }),
    // Nothing moves for a local folder, so the shell answers with the workspace as it stands.
    refreshWorkspace: async (workspaceId) => ({
      ok: true,
      workspace: { id: workspaceId, name: "ws", ref: { kind: "local" as const, root: `/${workspaceId}` }, truncated: false },
    }),
    // A repository's branches. Overridden by the tests that commit; here so the fake is the whole
    // interface rather than most of it.
    repoBranches: async () => ({ ok: true as const, branches: ["main"], branch: null, readingBranch: "main" }),
    setRepoBranch: async (_workspaceId: string, branch: string) => ({ ok: true as const, branch }),
    ...overrides,
  };

  return { client, writes, reads, saveAsCalls };
}

/// The folder behind a workspace, or null when it has none.
///
/// A workspace carries its REFERENCE now rather than a root, because a GitHub repository has no
/// folder at all - so the tests that care about a local root ask for it the way the hook does.
function workspaceRoot(workspace: { ref: { kind: string; root?: string } } | undefined): string | null {
  return workspace?.ref.kind === "local" ? (workspace.ref.root ?? null) : null;
}

describe("parentOf", () => {
  it("walks up one level", () => {
    expect(parentOf("a/b/c")).toBe("a/b");
    expect(parentOf("a")).toBe("");
  });

  it("stops at the root rather than going above it", () => {
    expect(parentOf("")).toBe("");
  });
});

describe("withoutSubtree", () => {
  const folders = {
    "": { status: "loaded" as const },
    docs: { status: "loaded" as const },
    "docs/specs": { status: "loaded" as const },
    other: { status: "loaded" as const },
  };

  // Collapsing must forget descendants too. Keeping them would mean re-expanding shows the tree as it
  // was however long ago, including files that have since been deleted.
  it("removes the folder and everything beneath it", () => {
    expect(Object.keys(withoutSubtree(folders, "docs")).sort()).toEqual(["", "other"]);
  });

  // "docs" must not take "docs-archive" with it - the same prefix trap the path guard has.
  it("does not remove a sibling whose name merely starts the same", () => {
    const withSibling = { ...folders, "docs-archive": { status: "loaded" as const } };
    expect(Object.keys(withoutSubtree(withSibling, "docs"))).toContain("docs-archive");
  });
});

describe("failureKey", () => {
  it("maps each known reason to its own key", () => {
    expect(failureKey("conflict")).toBe("errors.conflict");
    expect(failureKey("not-desktop")).toBe("errors.notDesktop");
    expect(failureKey("not-found")).toBe("errors.notFound");
    expect(failureKey("permission-denied")).toBe("errors.permissionDenied");
  });

  // Cancelling a folder picker is not a failure and must not raise anything.
  it("has nothing to say about a cancelled dialog", () => {
    expect(failureKey("cancelled")).toBeNull();
  });

  // Each refusal from the read boundary has its own key. One shared "cannot open that" would tell a
  // user nothing about which of three different problems their file has, and two of the three are
  // fixable by them.
  it("maps each read refusal to its own key", () => {
    expect(failureKey("too-large")).toBe("errors.tooLarge");
    expect(failureKey("not-text")).toBe("errors.notText");
    expect(failureKey("unsupported-encoding")).toBe("errors.unsupportedEncoding");
  });

  // A cloud provider refuses in ways a local folder never does, and each sends the user somewhere
  // different: wait an hour, check the connection, connect an account, or accept that Trypthos
  // cannot do this to a repository yet. One shared key would send them all to the same wrong place.
  it("maps each provider refusal to its own key", () => {
    expect(failureKey("rate-limited")).toBe("errors.rateLimited");
    expect(failureKey("offline")).toBe("errors.offline");
    expect(failureKey("not-connected")).toBe("errors.notConnected");
    expect(failureKey("unsupported")).toBe("errors.unsupported");
    expect(failureKey("encryption-unavailable")).toBe("errors.encryptionUnavailable");
  });

  // An errno must never reach the interface, whether as wording or as a key that renders raw.
  it("maps anything unrecognised to the generic key", () => {
    expect(failureKey("EACCES")).toBe("errors.unknown");
    expect(failureKey("")).toBe("errors.unknown");
  });
});

describe("failureParams", () => {
  // Only one refusal carries numbers, and it is the one where a bare "too large" would leave the
  // user guessing at both halves: how big their file is, and what the app will take.
  it("names both sizes for a file over the cap", () => {
    expect(
      failureParams({
        reason: "too-large",
        sizeBytes: 431467151,
        limitBytes: MAX_TEXT_FILE_BYTES,
      }),
    ).toEqual({ size: "411.5 MB", limit: "16 MB" });
  });

  it("has nothing to interpolate for any other reason", () => {
    expect(failureParams({ reason: "not-text" })).toBeNull();
    expect(failureParams({ reason: "not-found" })).toBeNull();
  });
});

describe("useWorkspace", () => {
  it("starts with nothing open", () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    expect(result.current.state.workspaces).toEqual([]);
    expect(result.current.state.file).toBeNull();
  });

  it("lists the root after a folder is opened", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });

    expect(result.current.state.workspaces[0]?.name).toBe("ws");
    expect(result.current.state.folders["ws"]?.status).toBe("loaded");
    expect(result.current.state.folders["ws"]?.children?.map((n) => n.name)).toContain("notes");
  });

  it("expands a folder, then collapses it again", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.toggleFolder("ws/notes");
    });
    expect(result.current.state.folders["ws/notes"]?.status).toBe("loaded");

    await act(async () => {
      await result.current.actions.toggleFolder("ws/notes");
    });
    expect(result.current.state.folders["ws/notes"]).toBeUndefined();
  });

  // A failed folder is a fact about that row. Raising it as a banner would suggest the workspace is
  // broken when every other folder is fine.
  it("records a failed listing on the folder, not as a panel-wide error", async () => {
    const { client } = fakeClient({
      listDirectory: async (path) =>
        path === "ws/notes" ? { ok: false, reason: "permission-denied" } : { ok: true, nodes: [] },
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.toggleFolder("ws/notes");
    });

    expect(result.current.state.folders["ws/notes"]?.status).toBe("error");
    expect(result.current.state.errorKey).toBeNull();
  });

  it("retries a folder that failed", async () => {
    let attempt = 0;
    const { client } = fakeClient({
      listDirectory: async () => {
        attempt += 1;
        return attempt === 1 ? { ok: false, reason: "offline" } : { ok: true, nodes: [] };
      },
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.retryFolder("ws/notes");
    });
    expect(result.current.state.folders["ws/notes"]?.status).toBe("error");

    await act(async () => {
      await result.current.actions.retryFolder("ws/notes");
    });
    expect(result.current.state.folders["ws/notes"]?.status).toBe("loaded");
  });

  // A remembered folder that has since gone is not an error the user caused, and a warning about a
  // path they may not remember choosing is worse than simply opening with nothing.
  it("says nothing when a remembered folder can no longer be opened", async () => {
    const { client } = fakeClient({
      openWorkspaceRef: async () => ({ ok: false, reason: "not-found" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.reopen([{ kind: "local", root: "D:/Gone" }]);
    });

    expect(result.current.state.workspaces).toEqual([]);
    expect(result.current.state.errorKey).toBeNull();
  });

  it("reopens a remembered folder, collapsed", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.reopen([{ kind: "local", root: "D:/Notes" }]);
    });

    expect(workspaceRoot(result.current.state.workspaces[0])).toBe("D:/Notes");
    // Absent from the folder map is what collapsed means - see "reopening on launch" below for why
    // a workspace the user did not just choose comes back that way.
    expect(result.current.state.folders["D:/Notes"]).toBeUndefined();
  });

  it("opens a file, holding the revision it was read at", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile({ id: "a.md", name: "a.md", kind: "file" });
    });

    expect(result.current.state.content).toBe("# On disk\n");
    expect(result.current.state.file?.revision.id).toBe("r1");
    expect(result.current.state.dirty).toBe(false);
  });

  // Opening a file the user clicked in the folder browser and opening one they clicked a LINK to are
  // the same act, and share one implementation - the unsaved-changes prompt, the error banner and the
  // revision all have to behave identically, and two implementations would be two chances to differ.
  describe("openPath", () => {
    it("opens a file named by its workspace-relative path", async () => {
      const { client } = fakeClient();
      const { result } = renderHook(() => useWorkspace(client));

      await act(async () => {
        await result.current.actions.openPath("book/two.md");
      });

      expect(result.current.state.file).toEqual({
        path: "book/two.md",
        name: "two.md",
        revision: { id: "r1" },
      });
      expect(result.current.state.content).toBe("# On disk\n");
    });

    it("names a file at the root by its own name", async () => {
      const { client } = fakeClient();
      const { result } = renderHook(() => useWorkspace(client));

      await act(async () => {
        await result.current.actions.openPath("a.md");
      });

      expect(result.current.state.file?.name).toBe("a.md");
    });

    it("reports a link to a file that is not there", async () => {
      const { client } = fakeClient({
        readFile: async () => ({ ok: false, reason: "not-found" }),
      });
      const { result } = renderHook(() => useWorkspace(client));

      await act(async () => {
        await result.current.actions.openPath("gone.md");
      });

      expect(result.current.state.errorKey).toBe("errors.notFound");
      expect(result.current.state.file).toBeNull();
    });

    it("opens a second document without asking about the first", async () => {
      // The prompt used to live here because opening a file REPLACED the one on screen. Nothing is
      // discarded now, so there is nothing to ask about.
      const { client } = fakeClient();
      let asked = 0;
      const { result } = renderHook(() =>
        useWorkspace(client, "", async () => {
          asked += 1;
          return "cancel";
        }),
      );

      await act(async () => {
        await result.current.actions.openFile({ id: "a.md", name: "a.md", kind: "file" });
      });
      act(() => {
        result.current.actions.edit("# Edited\n");
      });
      await act(async () => {
        await result.current.actions.openPath("book/two.md");
      });

      expect(asked).toBe(0);
      expect(result.current.state.file?.path).toBe("book/two.md");
      expect(result.current.state.documents.map((document) => document.path)).toEqual([
        "a.md",
        "book/two.md",
      ]);
    });
  });

  it("marks the document dirty once edited", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile({ id: "a.md", name: "a.md", kind: "file" });
    });
    act(() => {
      result.current.actions.edit("# Edited\n");
    });

    expect(result.current.state.dirty).toBe(true);
  });

  // The revision is what makes a conflict detectable. Saving the current content against a stale or
  // absent revision is exactly the overwrite the whole mechanism exists to prevent.
  it("saves the edited content against the revision the file was read at", async () => {
    const { client, writes } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile({ id: "a.md", name: "a.md", kind: "file" });
    });
    act(() => {
      result.current.actions.edit("# Edited\n");
    });
    await act(async () => {
      await result.current.actions.save();
    });

    expect(writes).toEqual([{ path: "a.md", content: "# Edited\n", revision: "r1", message: null }]);
    expect(result.current.state.dirty).toBe(false);
    // The next save must compare against what was just written, not what was first read.
    expect(result.current.state.file?.revision.id).toBe("r2");
  });

  it("does nothing when asked to save with no file open", async () => {
    const { client, writes } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.save();
    });

    expect(writes).toEqual([]);
  });

  // The case where getting it wrong loses somebody's work.
  it("keeps the user's edits, and stays dirty, when a save conflicts", async () => {
    const { client } = fakeClient({
      writeFile: async () => ({ ok: false, reason: "conflict", theirs: { id: "r9" } }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile({ id: "a.md", name: "a.md", kind: "file" });
    });
    act(() => {
      result.current.actions.edit("# Mine\n");
    });
    await act(async () => {
      await result.current.actions.save();
    });

    expect(result.current.state.content).toBe("# Mine\n");
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.errorKey).toBe("errors.conflict");
    // The held revision must NOT advance: nothing was written, so nothing was agreed.
    expect(result.current.state.file?.revision.id).toBe("r1");
  });

  it("reports a file that has gone, without clearing what is on screen", async () => {
    const { client } = fakeClient({
      readFile: async () => ({ ok: false, reason: "not-found" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile({ id: "gone.md", name: "gone.md", kind: "file" });
    });

    await waitFor(() => expect(result.current.state.errorKey).toBe("errors.notFound"));
    expect(result.current.state.file).toBeNull();
  });

  // The numbers travel with the key, or the banner can only say "too large" about a file whose size
  // is the one thing the user needs to know.
  it("carries the sizes through when a file is refused for being too large", async () => {
    const { client } = fakeClient({
      readFile: async () => ({
        ok: false,
        reason: "too-large",
        sizeBytes: 431467151,
        limitBytes: MAX_TEXT_FILE_BYTES,
      }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile({ id: "huge.log", name: "huge.log", kind: "file" });
    });

    await waitFor(() => expect(result.current.state.errorKey).toBe("errors.tooLarge"));
    expect(result.current.state.errorParams).toEqual({ size: "411.5 MB", limit: "16 MB" });
    expect(result.current.state.file).toBeNull();
  });

  // A refusal that carries nothing must clear whatever the last one left behind, or the banner
  // interpolates one file's size into another file's message.
  it("clears the parameters of an earlier failure", async () => {
    let refusal: ReadResult = {
      ok: false,
      reason: "too-large",
      sizeBytes: 20 * 1024 * 1024,
      limitBytes: MAX_TEXT_FILE_BYTES,
    };
    const { client } = fakeClient({ readFile: async () => refusal });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile({ id: "huge.log", name: "huge.log", kind: "file" });
    });
    await waitFor(() => expect(result.current.state.errorParams).not.toBeNull());

    refusal = { ok: false, reason: "not-text" };
    await act(async () => {
      await result.current.actions.openFile({ id: "picture.md", name: "picture.md", kind: "file" });
    });

    await waitFor(() => expect(result.current.state.errorKey).toBe("errors.notText"));
    expect(result.current.state.errorParams).toBeNull();
  });

  it("explains that the browser preview cannot open folders", async () => {
    const { client } = fakeClient({
      openWorkspace: async () => ({ ok: false, reason: "not-desktop" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });

    expect(result.current.state.errorKey).toBe("errors.notDesktop");
    expect(result.current.state.workspaces).toEqual([]);
  });

  it("raises nothing when the folder picker is cancelled", async () => {
    const { client } = fakeClient({
      openWorkspace: async () => ({ ok: false, reason: "cancelled" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });

    expect(result.current.state.errorKey).toBeNull();
  });

  // The banner's Dismiss button. It wrote to a field this state does not have, so it did nothing at
  // all and the only way to clear a message about a failure was to do something else that succeeded.
  // Nothing caught it: an object literal with a spread in it turns off TypeScript's excess property
  // check, so the wrong name type-checked.
  it("clears the failure when it is dismissed", async () => {
    const { client } = fakeClient({
      readFile: async () => ({ ok: false, reason: "not-found" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openPath("gone.md");
    });
    expect(result.current.state.errorKey).toBe("errors.notFound");

    act(() => result.current.actions.dismissError());

    expect(result.current.state.errorKey).toBeNull();
  });

  it("leaves everything else alone when a failure is dismissed", async () => {
    const { client } = fakeClient({
      readFile: async (path) =>
        path === "gone.md"
          ? { ok: false, reason: "not-found" }
          : { ok: true, content: "# On disk\n", revision: { id: "r1" } },
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile({ id: "a.md", name: "a.md", kind: "file" });
    });
    act(() => result.current.actions.edit("# Mine\n"));
    await act(async () => {
      await result.current.actions.openPath("gone.md");
    });

    act(() => result.current.actions.dismissError());

    // Dismissing a message is not an undo: the document, its text and its unsaved state are the
    // user's, and none of them are what the banner was about.
    expect(result.current.state.file?.path).toBe("a.md");
    expect(result.current.state.content).toBe("# Mine\n");
    expect(result.current.state.dirty).toBe(true);
  });
});

/// Several documents open at once.
///
/// The tab strip is a view of this: what is open, which one is on screen, and which have unsaved
/// work. All of it is here rather than in the strip, so the awkward cases - a second click on a file
/// already open, closing the one being edited - are answerable without rendering anything.
describe("open documents", () => {
  const A = { id: "a.md", name: "a.md", kind: "file" as const };
  const B = { id: "b.md", name: "b.md", kind: "file" as const };

  it("keeps every opened document, with the newest active", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile(A);
    });
    await act(async () => {
      await result.current.actions.openFile(B);
    });

    expect(result.current.state.documents.map((document) => document.path)).toEqual([
      "a.md",
      "b.md",
    ]);
    expect(result.current.state.activePath).toBe("b.md");
  });

  // The requirement in one test: clicking a file in the tree either opens it or goes to it, and
  // going to it must not read the file - what is on disk would replace what the user has typed.
  it("switches to a document that is already open, without reading it again", async () => {
    const { client, reads } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile(A);
    });
    act(() => result.current.actions.edit("# Mine\n"));
    await act(async () => {
      await result.current.actions.openFile(B);
    });
    await act(async () => {
      await result.current.actions.openFile(A);
    });

    expect(reads).toEqual(["a.md", "b.md"]);
    expect(result.current.state.activePath).toBe("a.md");
    expect(result.current.state.content).toBe("# Mine\n");
    expect(result.current.state.dirty).toBe(true);
  });

  it("edits one document without touching another", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile(A);
    });
    act(() => result.current.actions.edit("# Mine\n"));
    await act(async () => {
      await result.current.actions.openFile(B);
    });

    expect(result.current.state.content).toBe("# On disk\n");
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.dirtyPaths).toEqual(["a.md"]);
    // The window's own flag is about the WINDOW: one unsaved tab is enough to interrupt a close,
    // whichever tab is on screen.
    expect(result.current.state.anyDirty).toBe(true);
  });

  it("goes to a document without opening or reading anything", async () => {
    const { client, reads } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile(A);
    });
    await act(async () => {
      await result.current.actions.openFile(B);
    });
    act(() => result.current.actions.activateFile("a.md"));

    expect(result.current.state.activePath).toBe("a.md");
    expect(reads).toHaveLength(2);
  });

  it("saves the document that was named, not the one on screen", async () => {
    const { client, writes } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile(A);
    });
    act(() => result.current.actions.edit("# Mine\n"));
    await act(async () => {
      await result.current.actions.openFile(B);
    });
    await act(async () => {
      await result.current.actions.save("a.md");
    });

    expect(writes).toEqual([{ path: "a.md", content: "# Mine\n", revision: "r1", message: null }]);
    expect(result.current.state.dirtyPaths).toEqual([]);
  });

  describe("closing a tab", () => {
    it("asks nothing about a document with no unsaved work", async () => {
      const { client } = fakeClient();
      let asked = 0;
      const { result } = renderHook(() =>
        useWorkspace(client, "", async () => {
          asked += 1;
          return "cancel";
        }),
      );

      await act(async () => {
        await result.current.actions.openFile(A);
      });
      await act(async () => {
        await result.current.actions.closeFile("a.md");
      });

      expect(asked).toBe(0);
      expect(result.current.state.documents).toHaveLength(0);
    });

    it("asks about the document by name before discarding it", async () => {
      const { client } = fakeClient();
      const asked: (string | null | undefined)[] = [];
      const { result } = renderHook(() =>
        useWorkspace(client, "", async (name) => {
          asked.push(name);
          return "discard";
        }),
      );

      await act(async () => {
        await result.current.actions.openFile(A);
      });
      act(() => result.current.actions.edit("# Mine\n"));
      await act(async () => {
        await result.current.actions.closeFile("a.md");
      });

      // Named, because several documents can have unsaved work at once and the answer decides which
      // one is thrown away.
      expect(asked).toEqual(["a.md"]);
      expect(result.current.state.documents).toHaveLength(0);
    });

    it("keeps the tab, and its text, on cancel", async () => {
      const { client, writes } = fakeClient();
      const { result } = renderHook(() => useWorkspace(client, "", async () => "cancel"));

      await act(async () => {
        await result.current.actions.openFile(A);
      });
      act(() => result.current.actions.edit("# Mine\n"));
      await act(async () => {
        await result.current.actions.closeFile("a.md");
      });

      expect(writes).toEqual([]);
      expect(result.current.state.documents).toHaveLength(1);
      expect(result.current.state.content).toBe("# Mine\n");
      expect(result.current.state.dirty).toBe(true);
    });

    it("saves before closing when asked to", async () => {
      const { client, writes } = fakeClient();
      const { result } = renderHook(() => useWorkspace(client, "", async () => "save"));

      await act(async () => {
        await result.current.actions.openFile(A);
      });
      act(() => result.current.actions.edit("# Mine\n"));
      await act(async () => {
        await result.current.actions.closeFile("a.md");
      });

      expect(writes).toEqual([{ path: "a.md", content: "# Mine\n", revision: "r1", message: null }]);
      expect(result.current.state.documents).toHaveLength(0);
    });

    // The case that loses work if it is wrong: the save was refused, so the text only exists here.
    it("keeps the tab open when the save it was asked for fails", async () => {
      const { client } = fakeClient({
        writeFile: async () => ({ ok: false, reason: "conflict", theirs: { id: "r9" } }),
      });
      const { result } = renderHook(() => useWorkspace(client, "", async () => "save"));

      await act(async () => {
        await result.current.actions.openFile(A);
      });
      act(() => result.current.actions.edit("# Mine\n"));
      await act(async () => {
        await result.current.actions.closeFile("a.md");
      });

      expect(result.current.state.documents).toHaveLength(1);
      expect(result.current.state.content).toBe("# Mine\n");
      expect(result.current.state.errorKey).toBe("errors.conflict");
    });

    it("closes a tab that is not the one on screen, leaving the selection alone", async () => {
      const { client } = fakeClient();
      const { result } = renderHook(() => useWorkspace(client));

      await act(async () => {
        await result.current.actions.openFile(A);
      });
      await act(async () => {
        await result.current.actions.openFile(B);
      });
      await act(async () => {
        await result.current.actions.closeFile("a.md");
      });

      expect(result.current.state.activePath).toBe("b.md");
    });

    it("returns to the scratch buffer when the last tab closes", async () => {
      const { client } = fakeClient();
      const { result } = renderHook(() => useWorkspace(client, "# Scratch\n"));

      await act(async () => {
        await result.current.actions.openFile(A);
      });
      await act(async () => {
        await result.current.actions.closeFile("a.md");
      });

      expect(result.current.state.file).toBeNull();
      expect(result.current.state.content).toBe("# Scratch\n");
      expect(result.current.state.dirty).toBe(false);
    });

    it("keeps what was typed into the scratch buffer while files were open", async () => {
      const { client } = fakeClient();
      const { result } = renderHook(() => useWorkspace(client, "# Scratch\n"));

      act(() => result.current.actions.edit("# Notes to self\n"));
      await act(async () => {
        await result.current.actions.openFile(A);
      });
      await act(async () => {
        await result.current.actions.closeFile("a.md");
      });

      expect(result.current.state.content).toBe("# Notes to self\n");
    });
  });
});

/// Being handed a folder or a file from outside the app - a right-click in File Explorer.
///
/// The same two acts the user already has, in one call: open this folder, then open this document in
/// it. A file names both, because every path the app handles is relative to one open folder.
describe("opening what the app was launched with", () => {
  it("opens the folder and the document within it", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openTarget({ root: "D:/Notes", file: "a.md" });
    });

    expect(workspaceRoot(result.current.state.workspaces[0])).toBe("D:/Notes");
    // Keyed by the workspace's own id, which the fake mints from the root it was handed.
    expect(result.current.state.folders["D:/Notes"]?.status).toBe("loaded");
    // Qualified on the way in: the file arrived relative to a ROOT, and this is the side that knows
    // which workspace that root turned out to be.
    expect(result.current.state.file?.path).toBe("D:/Notes/a.md");
  });

  it("opens a folder on its own", async () => {
    const { client, reads } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openTarget({ root: "D:/Notes", file: null });
    });

    expect(workspaceRoot(result.current.state.workspaces[0])).toBe("D:/Notes");
    expect(reads).toEqual([]);
  });

  // A second file from Explorer, in the folder already open: another tab, and the folder is not
  // reopened underneath the documents that are already there.
  it("adds a tab when the folder is already the one open", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openTarget({ root: "/ws", file: "a.md" });
    });
    act(() => result.current.actions.edit("# Mine\n"));
    await act(async () => {
      await result.current.actions.openTarget({ root: "/ws", file: "b.md" });
    });

    expect(result.current.state.documents.map((document) => document.path)).toEqual([
      "ws/a.md",
      "ws/b.md",
    ]);
    // The first document was not disturbed by a folder being reopened around it.
    expect(result.current.state.documents[0]?.content).toBe("# Mine\n");
  });

  /// Another folder is ADDED, not swapped in.
  ///
  /// This is what 0.57.0 changed, and it is why there is nothing to ask about here: every path names
  /// the folder it is in, so a second folder cannot make the documents from the first ambiguous.
  /// Before, opening one discarded every open document and had to ask first.
  it("adds another folder without disturbing the documents already open", async () => {
    const { client } = fakeClient();
    const asked: (string | null | undefined)[] = [];
    const { result } = renderHook(() =>
      useWorkspace(client, "", async (name) => {
        asked.push(name);
        return "cancel";
      }),
    );

    await act(async () => {
      await result.current.actions.openTarget({ root: "/ws", file: "a.md" });
    });
    act(() => result.current.actions.edit("# Mine\n"));
    await act(async () => {
      await result.current.actions.openTarget({ root: "D:/Other", file: "b.md" });
    });

    // Nothing was asked, because nothing was going to be discarded.
    expect(asked).toEqual([]);
    expect(result.current.state.workspaces.map(workspaceRoot)).toEqual([
      "/ws",
      "D:/Other",
    ]);
    expect(result.current.state.documents.map((document) => document.path)).toEqual([
      "ws/a.md",
      "D:/Other/b.md",
    ]);
    // And the unsaved work in the first folder's document is exactly where it was.
    expect(result.current.state.documents[0]?.content).toBe("# Mine\n");
  });


  it("says so when the folder is no longer there", async () => {
    const { client } = fakeClient({
      openWorkspaceRef: async () => ({ ok: false, reason: "not-found" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openTarget({ root: "D:/Gone", file: null });
    });

    expect(result.current.state.errorKey).toBe("errors.notFound");
  });
});

/// Unsaved work, and everything that would throw it away.
///
/// With one document there was one question to ask. With several there is one PER document, and the
/// two paths that ask are the two that discard everything: opening another folder, and closing the
/// window. Switching tabs is not one of them, which is the point of tabs.
describe("guarding unsaved changes", () => {
  const NODE = { id: "ws/b.md", name: "b.md", kind: "file" as const };
  const OTHER = { id: "ws/a.md", name: "a.md", kind: "file" as const };

  /// Records what it was asked about, and answers what the test tells it to.
  function asker(answer: "save" | "discard" | "cancel") {
    const asked: (string | null | undefined)[] = [];
    return {
      asked,
      confirm: async (name?: string | null) => {
        asked.push(name);
        return answer;
      },
    };
  }

  async function dirtyEditor(answer: "save" | "discard" | "cancel") {
    const { client, writes } = fakeClient();
    const ask = asker(answer);
    const { result } = renderHook(() => useWorkspace(client, "", ask.confirm));

    // With a folder open, because closing one is now where the question about unsaved work is asked
    // - and because a document has to be IN a folder for that to mean anything.
    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.openFile(NODE);
    });
    act(() => result.current.actions.edit("# Edited\n"));
    expect(result.current.state.dirty).toBe(true);

    return { result, writes, ask };
  }

  // Nothing to lose, so nothing to ask about. A prompt on every close would be worse than the bug it
  // exists to prevent.
  it("asks nothing when no document has been changed", async () => {
    const { client } = fakeClient();
    const ask = asker("cancel");
    const { result } = renderHook(() => useWorkspace(client, "", ask.confirm));

    await act(async () => {
      await result.current.actions.openFile(NODE);
    });
    await act(async () => {
      await result.current.actions.open();
    });

    expect(ask.asked).toHaveLength(0);
  });

  /// Opening another folder asks nothing, because it discards nothing.
  ///
  /// This is what 0.57.0 changed. Every path names the folder it is in, so a second folder cannot
  /// make the documents from the first ambiguous - and a prompt about work that is not going
  /// anywhere is a prompt people learn to dismiss.
  it("asks nothing when another folder is opened, and keeps every document", async () => {
    const { result, ask } = await dirtyEditor("cancel");

    await act(async () => {
      await result.current.actions.open();
    });

    expect(ask.asked).toEqual([]);
    expect(result.current.state.file?.path).toBe("ws/b.md");
    expect(result.current.state.dirty).toBe(true);
  });

  /// Closing one DOES discard its documents, and asks about each in turn.
  ///
  /// The question moved rather than disappearing: it belongs where the folder actually goes away.
  it("asks about the unsaved work in a folder being closed", async () => {
    const { result, ask, writes } = await dirtyEditor("save");

    await act(async () => {
      await result.current.actions.closeWorkspace("ws");
    });

    expect(ask.asked).toEqual(["b.md"]);
    expect(writes).toHaveLength(1);
    expect(result.current.state.documents).toHaveLength(0);
    expect(result.current.state.workspaces).toEqual([]);
  });

  // The first cancel stops the close: a folder that went while somebody was still deciding about a
  // file in it would take the answer away along with the question.
  it("keeps the folder and its documents when the question is cancelled", async () => {
    const { result } = await dirtyEditor("cancel");

    await act(async () => {
      await result.current.actions.closeWorkspace("ws");
    });

    expect(result.current.state.documents).toHaveLength(1);
    expect(result.current.state.workspaces).toHaveLength(1);
  });


  // The same question the shell asks before closing the window, so there is one implementation of
  // "may I throw this away" rather than one per caller.
  it("answers whether everything may be discarded, for the shell to close on", async () => {
    const { result, writes } = await dirtyEditor("save");

    let mayClose = false;
    await act(async () => {
      mayClose = await result.current.actions.mayDiscard();
    });

    expect(mayClose).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("asks about each unsaved document in turn", async () => {
    const { client } = fakeClient();
    const ask = asker("discard");
    const { result } = renderHook(() => useWorkspace(client, "", ask.confirm));

    await act(async () => {
      await result.current.actions.openFile(NODE);
    });
    act(() => result.current.actions.edit("# One\n"));
    await act(async () => {
      await result.current.actions.openFile(OTHER);
    });
    act(() => result.current.actions.edit("# Two\n"));

    let mayClose = false;
    await act(async () => {
      mayClose = await result.current.actions.mayDiscard();
    });

    expect(ask.asked).toEqual(["b.md", "a.md"]);
    expect(mayClose).toBe(true);
  });

  // One cancel stops the whole close. Anything else would have the window shut on the documents the
  // user had not been asked about yet.
  it("stops at the first cancel", async () => {
    const { client } = fakeClient();
    const ask = asker("cancel");
    const { result } = renderHook(() => useWorkspace(client, "", ask.confirm));

    await act(async () => {
      await result.current.actions.openFile(NODE);
    });
    act(() => result.current.actions.edit("# One\n"));
    await act(async () => {
      await result.current.actions.openFile(OTHER);
    });
    act(() => result.current.actions.edit("# Two\n"));

    let mayClose = true;
    await act(async () => {
      mayClose = await result.current.actions.mayDiscard();
    });

    expect(mayClose).toBe(false);
    expect(ask.asked).toEqual(["b.md"]);
  });
});

describe("the built-in guide", () => {
  const GUIDE = "# Guide\n\nAn example.\n";
  const NODE = { id: "b.md", name: "b.md", kind: "file" as const };

  /// Records what it was asked about. Nothing here should ever ask it anything.
  function neverAsked() {
    const asked: (string | null | undefined)[] = [];
    return {
      asked,
      confirm: async (name?: string | null) => {
        asked.push(name);
        return "cancel" as const;
      },
    };
  }

  it("opens in a tab of its own, without reading anything from disk", async () => {
    const { client, reads } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    act(() => result.current.actions.openGuide(GUIDE));

    expect(result.current.state.activePath).toBe(GUIDE_PATH);
    expect(result.current.state.content).toBe(GUIDE);
    expect(reads).toEqual([]);
  });

  it("goes back to the tab it already has rather than opening a second", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    act(() => result.current.actions.openGuide(GUIDE));
    await act(async () => {
      await result.current.actions.openFile(NODE);
    });
    act(() => result.current.actions.openGuide(GUIDE));

    expect(result.current.state.documents.map((document) => document.path)).toEqual([
      GUIDE_PATH,
      "b.md",
    ]);
    expect(result.current.state.activePath).toBe(GUIDE_PATH);
  });

  // "Never saved" has to hold at the one place a save is actually attempted. A write here would be
  // a write to a path no workspace contains, and the guard in the main process would refuse it -
  // which is the right answer arrived at far too late to be a design.
  it("is never written, even when a save is asked for", async () => {
    const { client, writes } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    act(() => result.current.actions.openGuide(GUIDE));
    act(() => result.current.actions.edit("# Rewritten\n"));

    let saved = true;
    await act(async () => {
      saved = await result.current.actions.save();
    });

    expect(saved).toBe(false);
    expect(writes).toEqual([]);
    // Nothing was typed into it either: the editor refuses edits, and the document refuses to
    // record one if anything else tries.
    expect(result.current.state.content).toBe(GUIDE);
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.errorKey).toBeNull();
  });

  it("closes without asking about unsaved work", async () => {
    const { client } = fakeClient();
    const ask = neverAsked();
    const { result } = renderHook(() => useWorkspace(client, "", ask.confirm));

    act(() => result.current.actions.openGuide(GUIDE));
    await act(async () => {
      await result.current.actions.closeFile(GUIDE_PATH);
    });

    expect(result.current.state.documents).toEqual([]);
    expect(ask.asked).toEqual([]);
  });
});

/// Which folder chat maps when the Folder button is on.
///
/// A real selection rather than something derived from the open file: the two are different
/// questions, and somebody reading one document while asking about another folder is the ordinary
/// case rather than the odd one.
describe("the selected folder", () => {
  it("starts at the workspace root", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });

    expect(result.current.state.selectedFolder).toBe("");
  });

  it("follows the folder that was chosen", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    act(() => result.current.actions.selectFolder("notes"));

    expect(result.current.state.selectedFolder).toBe("notes");
  });

  // Opening a document says nothing about which folder the question is about. A selection that
  // moved with the open file would be a selection the user could not keep.
  it("stays put when a document elsewhere is opened", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    act(() => result.current.actions.selectFolder("notes"));
    await act(async () => {
      await result.current.actions.openPath("a.md");
    });

    expect(result.current.state.selectedFolder).toBe("notes");
  });

  // A folder in the old workspace is not a folder in the new one, and carrying the path across
  // would point chat at a directory that may not exist.
  // Opening another folder does not disturb the selection: it disturbs nothing at all.
  it("keeps the chosen folder when another workspace is opened", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    act(() => result.current.actions.selectFolder("ws/notes"));
    await act(async () => {
      await result.current.actions.open();
    });

    expect(result.current.state.selectedFolder).toBe("ws/notes");
  });

  // Closing the folder it was in does. A folder chat is mapping in a workspace that has gone is a
  // question about nothing.
  it("forgets the chosen folder when its workspace is closed", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    act(() => result.current.actions.selectFolder("ws/notes"));
    await act(async () => {
      await result.current.actions.closeWorkspace("ws");
    });

    expect(result.current.state.selectedFolder).toBe("");
    expect(result.current.state.folders["ws"]).toBeUndefined();
  });
});

/// Save As, from the hook's side.
///
/// The shell decides where the file goes; what is left here is what happens to the TAB afterwards,
/// and it differs by what was being saved. A file moves. The scratch buffer and the built-in guide
/// have no file to move, so they are copied out and stay where they are.
describe("saving somewhere else", () => {
  const A = { id: "ws/a.md", name: "a.md", kind: "file" as const };

  /// Save As names WHICH folder it saves into, so these all start with one open. A document that has
  /// never been saved has no path to read the answer from - see the test at the end of this block.
  const withWorkspace = async (result: { current: { actions: WorkspaceActions } }) => {
    await act(async () => {
      await result.current.actions.open();
    });
  };

  it("sends the document, where it lives, and which folder it belongs to", async () => {
    const { client, saveAsCalls } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await withWorkspace(result);
    await act(async () => {
      await result.current.actions.openFile(A);
    });
    act(() => result.current.actions.edit("# Mine\n"));
    await act(async () => {
      await result.current.actions.saveAs();
    });

    expect(saveAsCalls).toEqual([{ workspaceId: "ws", path: "ws/a.md", content: "# Mine\n" }]);
  });

  it("moves the tab to the file that was written, clean and at its new revision", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await withWorkspace(result);
    await act(async () => {
      await result.current.actions.openFile(A);
    });
    act(() => result.current.actions.edit("# Mine\n"));
    await act(async () => {
      await result.current.actions.saveAs();
    });

    expect(result.current.state.activePath).toBe("ws/chosen.md");
    expect(result.current.state.file?.revision).toEqual({ id: "r-saved-as" });
    expect(result.current.state.content).toBe("# Mine\n");
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.documents.map((document) => document.path)).toEqual(["ws/chosen.md"]);
  });

  // The scratch buffer is the reason Save As can be reached with nothing open at all. It has never
  // been anywhere, so the dialog is told nothing about where to start.
  it("gives the scratch buffer somewhere to live, and leaves it there too", async () => {
    const { client, saveAsCalls } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client, "typed into the scratch buffer"));

    await withWorkspace(result);
    await act(async () => {
      await result.current.actions.saveAs();
    });

    // No path, because it has never been anywhere - and the first open folder, because something
    // has to say which one, and it is the only one there is.
    expect(saveAsCalls).toEqual([
      { workspaceId: "ws", path: null, content: "typed into the scratch buffer" },
    ]);
    expect(result.current.state.activePath).toBe("ws/chosen.md");
    expect(result.current.state.content).toBe("typed into the scratch buffer");
    expect(result.current.state.dirty).toBe(false);
  });

  // The guide has no file behind it, so there is nothing to move: this is a copy, and the guide
  // stays open and stays read-only.
  it("copies a read-only document out rather than moving it", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await withWorkspace(result);
    act(() => result.current.actions.openGuide("# Guide\n"));
    await act(async () => {
      await result.current.actions.saveAs();
    });

    expect(result.current.state.documents.map((document) => document.path)).toEqual([
      GUIDE_PATH,
      "ws/chosen.md",
    ]);
    expect(result.current.state.activePath).toBe("ws/chosen.md");
    expect(result.current.state.readOnly).toBe(false);
  });

  it("changes nothing when the dialog is cancelled, and raises no error", async () => {
    const { client } = fakeClient({
      saveFileAs: async () => ({ ok: false, reason: "cancelled" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await withWorkspace(result);
    await act(async () => {
      await result.current.actions.openFile(A);
    });
    act(() => result.current.actions.edit("# Mine\n"));
    await act(async () => {
      await result.current.actions.saveAs();
    });

    expect(result.current.state.activePath).toBe("ws/a.md");
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.errorKey).toBeNull();
  });

  // A folder outside the workspace is a real folder the user can write to, and the app is the thing
  // declining - so it says so in its own words rather than borrowing "permission denied".
  it("says so when the chosen folder is outside the open workspace", async () => {
    const { client } = fakeClient({
      saveFileAs: async () => ({ ok: false, reason: "outside-workspace" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await withWorkspace(result);
    await act(async () => {
      await result.current.actions.openFile(A);
    });
    await act(async () => {
      await result.current.actions.saveAs();
    });

    expect(result.current.state.errorKey).toBe("errors.outsideWorkspace");
    expect(result.current.state.activePath).toBe("ws/a.md");
  });

  // The caller may be about to act on the answer, exactly as it may with `save`.
  it("reports whether the file actually landed", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await withWorkspace(result);
    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.actions.saveAs();
    });
    expect(landed).toBe(true);
  });
});

/// What the File menu's recent list is built from.
///
/// The hook reports an open rather than writing anything: it holds no settings, and a hook that did
/// would be two things. Which files it reports is the whole question - a chat attachment goes
/// through the same read, and a list that collected those would fill with files nobody opened.
describe("reporting an opened file", () => {
  // Qualified, as every path in the tree now is. The root reported back is the ABSOLUTE folder that
  // workspace stands for, and the path is relative to it - which is what a recent-files entry needs.
  const A = { id: "ws/notes/a.md", name: "a.md", kind: "file" as const };

  function withReporter(overrides = {}) {
    const opened: { root: string; path: string }[] = [];
    const { client, saveAsCalls } = fakeClient(overrides);
    const rendered = renderHook(() =>
      useWorkspace(client, "", null, (file) => opened.push(file)),
    );
    return { ...rendered, opened, saveAsCalls };
  }

  it("names the file and the workspace it was opened in", async () => {
    const { result, opened } = withReporter();

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.openFile(A);
    });

    expect(opened).toEqual([{ root: "/ws", path: "notes/a.md" }]);
  });

  // Going back to a tab is not opening a file: nothing is read, and the list already has it.
  it("says nothing when a file that is already open is switched to", async () => {
    const { result, opened } = withReporter();

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.openFile(A);
    });
    await act(async () => {
      await result.current.actions.openFile(A);
    });

    expect(opened).toHaveLength(1);
  });

  it("says nothing when the file could not be read", async () => {
    const { result, opened } = withReporter({
      readFile: async () => ({ ok: false as const, reason: "not-found" }),
    });

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.openFile(A);
    });

    expect(opened).toEqual([]);
  });

  // Save As leaves you editing a file you have never opened. Leaving it off the list would put the
  // original there and not the one you are actually working in.
  it("reports a file saved somewhere else", async () => {
    const { result, opened } = withReporter();

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.saveAs();
    });

    // Relative to the root beside it: a recent-files entry is a folder and a path inside it, so the
    // workspace comes off the front here rather than being stored twice.
    expect(opened).toEqual([{ root: "/ws", path: "chosen.md" }]);
  });

  // Nothing is relative to nothing. Every path here belongs to one open folder.
  it("says nothing with no folder open at all", async () => {
    const { result, opened } = withReporter();

    await act(async () => {
      await result.current.actions.saveAs();
    });

    expect(opened).toEqual([]);
  });
});

/// Closing several tabs at once, which is what a tab's right-click menu asks for.
///
/// The rule that matters is the one it shares with closing the window: each unsaved document is
/// asked about in turn, and the first cancel stops the rest. A "Close Others" that carried on past a
/// cancel would shut tabs nobody had been asked about yet.
describe("closing several documents", () => {
  const nodes = ["a.md", "b.md", "c.md"].map((id) => ({ id, name: id, kind: "file" as const }));

  async function withOpen(confirm?: ConfirmDiscard) {
    const { client } = fakeClient();
    const rendered = renderHook(() => useWorkspace(client, "", confirm ?? null));
    for (const node of nodes) {
      await act(async () => {
        await rendered.result.current.actions.openFile(node);
      });
    }
    return rendered;
  }

  it("closes every tab it was given, and leaves the rest", async () => {
    const { result } = await withOpen();

    await act(async () => {
      await result.current.actions.closeFiles(["a.md", "c.md"]);
    });

    expect(result.current.state.documents.map((document) => document.path)).toEqual(["b.md"]);
  });

  it("asks about each unsaved document by name", async () => {
    const asked: (string | null | undefined)[] = [];
    const { result } = await withOpen(async (name) => {
      asked.push(name);
      return "discard";
    });

    act(() => result.current.actions.edit("# Mine"));
    await act(async () => {
      await result.current.actions.closeFiles(["a.md", "b.md", "c.md"]);
    });

    // Only the one with unsaved work in it: a clean document is discardable and asks nothing.
    expect(asked).toEqual(["c.md"]);
    expect(result.current.state.documents).toHaveLength(0);
  });

  // The whole point of doing this one at a time.
  it("stops at the first cancel, leaving that tab and everything after it", async () => {
    const { result } = await withOpen(async () => "cancel");

    act(() => result.current.actions.activateFile("b.md"));
    act(() => result.current.actions.edit("# Mine"));

    await act(async () => {
      await result.current.actions.closeFiles(["a.md", "b.md", "c.md"]);
    });

    expect(result.current.state.documents.map((document) => document.path)).toEqual([
      "b.md",
      "c.md",
    ]);
  });

  it("does nothing when there is nothing to close", async () => {
    const { result } = await withOpen();

    await act(async () => {
      await result.current.actions.closeFiles([]);
    });

    expect(result.current.state.documents).toHaveLength(3);
  });
});

/// File > New: a document with a name and nowhere to be.
describe("a new document", () => {
  it("opens as a tab named what the user called it", () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    act(() => result.current.actions.newDocument("notes.md"));

    expect(result.current.state.file?.name).toBe("notes.md");
    expect(result.current.state.content).toBe("");
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.readOnly).toBe(false);
  });

  it("tells two new documents of the same name apart", () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    act(() => result.current.actions.newDocument("notes.md"));
    act(() => result.current.actions.newDocument("notes.md"));

    expect(result.current.state.documents).toHaveLength(2);
  });

  // The whole point of the draft. Ctrl+S on a document that has never been anywhere cannot write to
  // a path it does not have, so it asks where to put it - and the tab follows the file it lands in.
  it("asks where to put it the first time it is saved", async () => {
    const { client, saveAsCalls, writes } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    // A draft belongs to no folder, so something has to say which one it lands in. With one open it
    // is that one; with none there is nowhere to save to at all.
    await act(async () => {
      await result.current.actions.open();
    });
    act(() => result.current.actions.newDocument("notes.md"));
    act(() => result.current.actions.edit("# Notes"));
    await act(async () => {
      await result.current.actions.save();
    });

    expect(saveAsCalls).toEqual([{ workspaceId: "ws", path: "notes.md", content: "# Notes" }]);
    expect(writes).toEqual([]);
    expect(result.current.state.file?.path).toBe("ws/chosen.md");
    expect(result.current.state.dirty).toBe(false);
  });

  // Once it has landed it is an ordinary file, and Ctrl+S writes to it without asking again.
  it("saves straight to its file every time after that", async () => {
    const { client, saveAsCalls, writes } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    act(() => result.current.actions.newDocument("notes.md"));
    await act(async () => {
      await result.current.actions.save();
    });
    act(() => result.current.actions.edit("# More"));
    await act(async () => {
      await result.current.actions.save();
    });

    expect(saveAsCalls).toHaveLength(1);
    expect(writes).toEqual([{ path: "ws/chosen.md", content: "# More", revision: "r-saved-as", message: null }]);
  });

  // The dialog is where the folder is chosen, so cancelling it leaves the document exactly where it
  // was: still a draft, still unsaved, still holding the work.
  it("stays a draft when the save dialog is cancelled", async () => {
    const { client } = fakeClient({
      saveFileAs: async () => ({ ok: false as const, reason: "cancelled" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    act(() => result.current.actions.newDocument("notes.md"));
    act(() => result.current.actions.edit("# Notes"));
    await act(async () => {
      await result.current.actions.save();
    });

    expect(result.current.state.file?.name).toBe("notes.md");
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.content).toBe("# Notes");
  });
});

/// Opening an image, which is read by a different call and held in a different field.
describe("opening an image", () => {
  const PNG = { id: "shot.png", name: "shot.png", kind: "file" as const };

  it("reads it as an image and holds the data URL", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile(PNG);
    });

    expect(result.current.state.media).toBe("data:image/png;base64,shot.png");
    expect(result.current.state.file?.path).toBe("shot.png");
  });

  // `content` is what the chat panel sends and what the editor holds. An image's bytes belong in
  // neither, and an empty string is what both should see.
  it("keeps the bytes out of the document content", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile(PNG);
    });

    expect(result.current.state.content).toBe("");
    expect(result.current.state.readOnly).toBe(true);
  });

  it("says so when the image cannot be read", async () => {
    const { client } = fakeClient({
      readImage: async () => ({ ok: false as const, reason: "not-found" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile(PNG);
    });

    expect(result.current.state.errorKey).toBe("errors.notFound");
    expect(result.current.state.documents).toHaveLength(0);
  });

  it("reads an ordinary document the ordinary way", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openFile({ id: "a.md", name: "a.md", kind: "file" });
    });

    expect(result.current.state.media).toBeNull();
    expect(result.current.state.content).toBe("# On disk\n");
  });
});

/// Several folders open at once.
///
/// The change 0.57.0 made, and the reason every path now carries the folder it is in: two files
/// called `notes.md` in two folders are two documents, and nothing but the workspace on the front
/// tells them apart.
describe("several folders open at once", () => {
  /// A fake that mints a different id per folder, as the shell does - the id is the folder's name.
  function twoFolders() {
    const roots = ["/one", "/two"];
    let next = 0;
    const closed: string[] = [];

    const { client } = fakeClient({
      openWorkspace: async () => {
        const root = roots[next++]!;
        return {
          ok: true as const,
          workspace: { id: root.slice(1), name: root.slice(1), ref: { kind: "local" as const, root }, truncated: false },
        };
      },
      closeWorkspace: async (workspaceId) => {
        closed.push(workspaceId);
        return { ok: true };
      },
    });
    return { client, closed };
  }

  const openBoth = async (result: { current: { actions: WorkspaceActions } }) => {
    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.open();
    });
  };

  it("keeps both folders, in the order they were opened", async () => {
    const { client } = twoFolders();
    const { result } = renderHook(() => useWorkspace(client));

    await openBoth(result);

    expect(result.current.state.workspaces.map((workspace) => workspace.id)).toEqual(["one", "two"]);
    expect(result.current.state.folders["one"]?.status).toBe("loaded");
    expect(result.current.state.folders["two"]?.status).toBe("loaded");
  });

  // The whole point. Without the folder on the front these are one path, and the second click would
  // be read as going back to the first file rather than opening a different one.
  it("tells apart two files with the same name in different folders", async () => {
    const { client } = twoFolders();
    const { result } = renderHook(() => useWorkspace(client));

    await openBoth(result);
    await act(async () => {
      await result.current.actions.openPath("one/notes.md");
    });
    await act(async () => {
      await result.current.actions.openPath("two/notes.md");
    });

    expect(result.current.state.documents.map((document) => document.path)).toEqual([
      "one/notes.md",
      "two/notes.md",
    ]);
    expect(result.current.state.activePath).toBe("two/notes.md");
  });

  it("closes one folder and its documents, leaving the other alone", async () => {
    const { client, closed } = twoFolders();
    const { result } = renderHook(() => useWorkspace(client));

    await openBoth(result);
    await act(async () => {
      await result.current.actions.openPath("one/a.md");
    });
    await act(async () => {
      await result.current.actions.openPath("two/b.md");
    });

    await act(async () => {
      await result.current.actions.closeWorkspace("one");
    });

    // Told to the shell as well, so the workspace stops answering there - a path naming it is
    // refused rather than quietly resolving against a provider nothing is using.
    expect(closed).toEqual(["one"]);
    expect(result.current.state.workspaces.map((workspace) => workspace.id)).toEqual(["two"]);
    expect(result.current.state.documents.map((document) => document.path)).toEqual(["two/b.md"]);
    expect(result.current.state.folders["one"]).toBeUndefined();
    expect(result.current.state.folders["two"]?.status).toBe("loaded");
  });

  // Closing the folder a document came from cannot leave that document on screen: it could neither
  // be saved nor re-read.
  it("puts the reader on what is left after closing the folder they were in", async () => {
    const { client } = twoFolders();
    const { result } = renderHook(() => useWorkspace(client));

    await openBoth(result);
    await act(async () => {
      await result.current.actions.openPath("two/b.md");
    });
    await act(async () => {
      await result.current.actions.openPath("one/a.md");
    });
    expect(result.current.state.activePath).toBe("one/a.md");

    await act(async () => {
      await result.current.actions.closeWorkspace("one");
    });

    expect(result.current.state.activePath).toBe("two/b.md");
  });

  // Opening the same folder twice is one workspace: the shell answers with the one it is already
  // open as, and the list must not gain a duplicate of it.
  it("does not list the same folder twice", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.open();
    });

    expect(result.current.state.workspaces).toHaveLength(1);
  });

  it("reopens every remembered folder, in order", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.reopen([{ kind: "local", root: "D:/One" }, { kind: "local", root: "D:/Two" }]);
    });

    expect(result.current.state.workspaces.map(workspaceRoot)).toEqual([
      "D:/One",
      "D:/Two",
    ]);
  });

  // One folder that has since been deleted must not take the rest with it.
  it("skips a remembered folder that has gone, and opens the others", async () => {
    const { client } = fakeClient({
      openWorkspaceRef: async (ref) => {
        const root = ref.kind === "local" ? ref.root : "";
        return root === "D:/Gone"
          ? { ok: false as const, reason: "not-found" }
          : { ok: true as const, workspace: { id: root, name: root, ref, truncated: false } };
      },
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.reopen([{ kind: "local", root: "D:/Gone" }, { kind: "local", root: "D:/Here" }]);
    });

    expect(result.current.state.workspaces.map(workspaceRoot)).toEqual(["D:/Here"]);
    expect(result.current.state.errorKey).toBeNull();
  });
});

/// What the browser looks like when the app comes back.
///
/// A workspace that was open last time is remembered and reopened. Expanding each of them on launch
/// fills the panel with every folder of every workspace before the user has asked for anything -
/// which is worst for the people who keep several open, who are the people the feature is for.
describe("reopening on launch", () => {
  it("brings workspaces back collapsed", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.reopen([
        { kind: "local", root: "D:/Notes" },
        { kind: "local", root: "D:/Work" },
      ]);
    });

    // Both are there to be expanded.
    expect(result.current.state.workspaces).toHaveLength(2);
    // And neither has been listed: absent from the map is what collapsed means.
    expect(result.current.state.folders["D:/Notes"]).toBeUndefined();
    expect(result.current.state.folders["D:/Work"]).toBeUndefined();
  });

  // Expanding one afterwards works exactly as it does for any folder - nothing about the launch
  // path leaves them in a state the tree cannot open.
  it("expands one when it is asked to", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.reopen([{ kind: "local", root: "D:/Notes" }]);
    });
    await act(async () => {
      await result.current.actions.toggleFolder("D:/Notes");
    });

    expect(result.current.state.folders["D:/Notes"]?.status).toBe("loaded");
  });
});

describe("opening a workspace the user just chose", () => {
  // The opposite case, and the reason this is not simply "never expand": somebody who has just
  // picked a folder from the dialog is asking to see what is in it.
  it("expands it", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });

    expect(result.current.state.folders["ws"]?.status).toBe("loaded");
  });

  it("expands a repository chosen from the picker", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.openRef({ kind: "github", owner: "ada", repo: "notes" });
    });

    expect(result.current.state.folders["notes"]?.status).toBe("loaded");
  });
});

/// Saving to a repository, which is a commit on a branch.
///
/// The rule this encodes: **the questions belong to the branch, not to the save.** The first save in
/// a repository asks where its commits go; every save after that is instant. Asking on each one
/// would be punishing in a document somebody saves every couple of minutes, and it would be asking a
/// question whose answer has not changed.
describe("committing to a repository", () => {
  const REPO = { kind: "github" as const, owner: "ada", repo: "notes" };

  /// Opens a repository and a file in it, ready to be edited.
  async function openRepoFile(overrides: Partial<WorkspaceClient> = {}, ask = askOnce()) {
    const { client, writes } = fakeClient({
      listDirectory: async (path) => ({
        ok: true,
        nodes: [{ id: `${path}/README.md`, name: "README.md", kind: "file" as const }],
      }),
      ...overrides,
    });
    const { result } = renderHook(() => useWorkspace(client, "", null, null, ask.askCommit));

    await act(async () => {
      await result.current.actions.openRef(REPO);
    });
    await act(async () => {
      await result.current.actions.openFile({
        id: "notes/README.md",
        name: "README.md",
        kind: "file",
      });
    });
    await act(async () => {
      result.current.actions.edit("# Changed\n");
    });

    return { result, writes, ask, client };
  }

  /// Stands in for the dialog: records what it was asked, answers what it was told to.
  function askOnce(answer: CommitChoice | null = {
    branch: "trypthos/update-readme",
    create: true,
    message: "Update the readme",
  }) {
    const asked: { workspaceId: string; name: string }[] = [];
    return {
      asked,
      askCommit: async (workspaceId: string, name: string) => {
        asked.push({ workspaceId, name });
        return answer;
      },
    };
  }

  it("asks where the commit goes, sets the branch, and commits with the message", async () => {
    const branches: { branch: string; create: boolean }[] = [];
    const { result, writes, ask } = await openRepoFile({
      setRepoBranch: async (_id: string, branch: string, create: boolean) => {
        branches.push({ branch, create });
        return { ok: true as const, branch };
      },
    });

    await act(async () => {
      await result.current.actions.save();
    });

    expect(ask.asked).toEqual([{ workspaceId: "notes", name: "README.md" }]);
    expect(branches).toEqual([{ branch: "trypthos/update-readme", create: true }]);
    expect(writes).toEqual([
      { path: "notes/README.md", content: "# Changed\n", revision: "r1", message: "Update the readme" },
    ]);
  });

  /// Cancelling is not a failure.
  ///
  /// Nothing is committed and nothing is said. An error banner for somebody who pressed Escape would
  /// be the app complaining about a decision the user was entitled to make.
  it("commits nothing when the dialog is cancelled", async () => {
    const { result, writes } = await openRepoFile({}, askOnce(null));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.actions.save();
    });

    expect(saved).toBe(false);
    expect(writes).toEqual([]);
    expect(result.current.state.errorKey).toBe(null);
    // And the work is still there, unsaved, which is the whole point of not reporting a save.
    expect(result.current.state.dirty).toBe(true);
  });

  // The second save is instant. The branch was settled on the first one and has not changed, so
  // there is nothing to ask - and the message is written from the file's name.
  it("does not ask again once a branch has been chosen", async () => {
    const { result, writes, ask } = await openRepoFile();

    await act(async () => {
      await result.current.actions.save();
    });
    await act(async () => {
      result.current.actions.edit("# Changed again\n");
    });
    await act(async () => {
      await result.current.actions.save();
    });

    expect(ask.asked).toHaveLength(1);
    expect(writes).toHaveLength(2);
    expect(writes[1]!.message).toBe("Update README.md");
  });

  // A folder on this machine has no branches and nothing to ask about. A dialog over a local save
  // would be a question with no answers.
  it("asks nothing when saving a local file", async () => {
    const ask = askOnce();
    const { client, writes } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client, "", null, null, ask.askCommit));

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.openFile({ id: "ws/a.md", name: "a.md", kind: "file" });
    });
    await act(async () => {
      result.current.actions.edit("changed");
    });
    await act(async () => {
      await result.current.actions.save();
    });

    expect(ask.asked).toEqual([]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.message).toBe(null);
  });

  /// A branch that could not be made.
  ///
  /// The name is already taken, or the token may not write. Reported, and nothing is committed - and
  /// the next save asks again, because the question has not been answered yet.
  it("says why the branch could not be made, and commits nothing", async () => {
    const { result, writes, ask } = await openRepoFile({
      setRepoBranch: async () => ({ ok: false as const, reason: "branch-exists" }),
    });

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.actions.save();
    });

    expect(saved).toBe(false);
    expect(writes).toEqual([]);
    expect(result.current.state.errorKey).toBe("errors.branchExists");

    await act(async () => {
      await result.current.actions.save();
    });
    expect(ask.asked).toHaveLength(2);
  });

  // The refusal every existing user meets first: a token made for reading. Said as itself, because
  // "permission denied" would send them to check their access rather than to make a new token.
  it("says when the token may not write", async () => {
    const { result } = await openRepoFile({
      writeFile: async () => ({ ok: false as const, reason: "read-only-token" }),
    });

    await act(async () => {
      await result.current.actions.save();
    });

    expect(result.current.state.errorKey).toBe("errors.readOnlyToken");
    expect(result.current.state.dirty).toBe(true);
  });
});

/// Refresh, from the workspace's right-click menu.
///
/// The tree is a listing taken when each folder was opened, and nothing watches the disk - so a file
/// added or deleted outside the app is not there until something asks again. Refresh is that asking,
/// for every folder the user has open, without collapsing what they had expanded.
describe("refreshing a workspace", () => {
  /// A folder on disk the tests can change between listings. Keyed by qualified path, answering the
  /// same shapes the shell does - and a folder that is not in it answers "not found", which is what
  /// listing a deleted folder does.
  function disk(initial: Record<string, { name: string; kind: "file" | "directory" }[]>) {
    const folders = { ...initial };
    const listed: string[] = [];
    const listDirectory: WorkspaceClient["listDirectory"] = async (path) => {
      listed.push(path);
      const entries = folders[path];
      if (entries === undefined) return { ok: false, reason: "not-found" };
      return {
        ok: true,
        nodes: entries.map((entry) => ({ id: `${path}/${entry.name}`, ...entry })),
      };
    };
    return { folders, listed, listDirectory };
  }

  const names = (state: { folders: Record<string, { children?: { name: string }[] }> }, path: string) =>
    state.folders[path]?.children?.map((node) => node.name).sort();

  async function openWithNotesExpanded(fs: ReturnType<typeof disk>) {
    const { client } = fakeClient({ listDirectory: fs.listDirectory });
    const hook = renderHook(() => useWorkspace(client));
    await act(async () => {
      await hook.result.current.actions.open();
    });
    await act(async () => {
      await hook.result.current.actions.toggleFolder("ws/notes");
    });
    return hook;
  }

  it("picks up files added since each open folder was listed", async () => {
    const fs = disk({
      ws: [
        { name: "a.md", kind: "file" },
        { name: "notes", kind: "directory" },
      ],
      "ws/notes": [{ name: "one.md", kind: "file" }],
    });
    const { result } = await openWithNotesExpanded(fs);

    fs.folders.ws = [...fs.folders.ws!, { name: "b.md", kind: "file" }];
    fs.folders["ws/notes"] = [...fs.folders["ws/notes"]!, { name: "two.md", kind: "file" }];

    await act(async () => {
      await result.current.actions.refreshWorkspace("ws");
    });

    expect(names(result.current.state, "ws")).toEqual(["a.md", "b.md", "notes"]);
    expect(names(result.current.state, "ws/notes")).toEqual(["one.md", "two.md"]);
  });

  it("forgets a folder that has been deleted, and says nothing about it", async () => {
    const fs = disk({
      ws: [{ name: "notes", kind: "directory" }],
      "ws/notes": [{ name: "one.md", kind: "file" }],
    });
    const { result } = await openWithNotesExpanded(fs);

    fs.folders.ws = [];
    delete fs.folders["ws/notes"];

    await act(async () => {
      await result.current.actions.refreshWorkspace("ws");
    });

    // Gone rather than drawn as a failure: a folder that is not there any more is not a folder that
    // could not be read, and a Retry beside it would be offering to find something that was deleted.
    expect(result.current.state.folders["ws/notes"]).toBeUndefined();
    expect(result.current.state.folders.ws?.status).toBe("loaded");
    expect(result.current.state.errorKey).toBeNull();
  });

  // Refresh re-reads what is open. Listing a collapsed folder would expand it, and on a large tree
  // would walk folders nobody asked to see.
  it("leaves collapsed folders collapsed, and does not list them", async () => {
    const fs = disk({
      ws: [
        { name: "notes", kind: "directory" },
        { name: "archive", kind: "directory" },
      ],
      "ws/notes": [],
      "ws/archive": [],
    });
    const { result } = await openWithNotesExpanded(fs);
    fs.listed.length = 0;

    await act(async () => {
      await result.current.actions.refreshWorkspace("ws");
    });

    expect(fs.listed.sort()).toEqual(["ws", "ws/notes"]);
    expect(result.current.state.folders["ws/archive"]).toBeUndefined();
    expect(result.current.state.folders["ws/notes"]?.status).toBe("loaded");
  });

  // A refresh swaps the new listing in when it arrives. Dropping each folder to "loading" first
  // would empty the tree and redraw it, which is a flash and a lost scroll position for a list that
  // is usually unchanged.
  it("keeps the rows on screen while the folders are being listed again", async () => {
    let release: () => void = () => {};
    let hold = false;
    let holding = false;
    const fs = disk({ ws: [{ name: "a.md", kind: "file" }] });
    const { client } = fakeClient({
      listDirectory: async (path) => {
        if (hold) {
          holding = true;
          await new Promise<void>((resolve) => (release = resolve));
        }
        return await fs.listDirectory(path);
      },
    });
    const { result } = renderHook(() => useWorkspace(client));
    await act(async () => {
      await result.current.actions.open();
    });

    hold = true;
    let refreshing: Promise<boolean> = Promise.resolve(true);
    act(() => {
      refreshing = result.current.actions.refreshWorkspace("ws");
    });
    // The listing is out and has not come back - which is the moment a "loading" would be drawn.
    await waitFor(() => expect(holding).toBe(true));

    expect(result.current.state.folders.ws?.status).toBe("loaded");
    expect(names(result.current.state, "ws")).toEqual(["a.md"]);

    await act(async () => {
      release();
      await refreshing;
    });
  });

  // A root that has been deleted or unmounted fails like any other listing: on its own row, with the
  // Retry that is already there for it.
  it("records a root that can no longer be listed on its row", async () => {
    const fs = disk({ ws: [{ name: "notes", kind: "directory" }], "ws/notes": [] });
    const { result } = await openWithNotesExpanded(fs);

    delete fs.folders.ws;
    delete fs.folders["ws/notes"];

    await act(async () => {
      await result.current.actions.refreshWorkspace("ws");
    });

    expect(result.current.state.folders.ws?.status).toBe("error");
    expect(result.current.state.errorKey).toBeNull();
  });

  // For a repository the shell moves the pin to the newest commit first, so the listings that follow
  // describe that commit rather than the one the workspace opened on.
  it("asks the shell to look again before listing anything", async () => {
    const order: string[] = [];
    const fs = disk({ ws: [] });
    const { client } = fakeClient({
      listDirectory: async (path) => {
        order.push(`list ${path}`);
        return await fs.listDirectory(path);
      },
    });
    const refreshWorkspace = client.refreshWorkspace;
    client.refreshWorkspace = async (workspaceId) => {
      order.push(`refresh ${workspaceId}`);
      return await refreshWorkspace(workspaceId);
    };
    const { result } = renderHook(() => useWorkspace(client));
    await act(async () => {
      await result.current.actions.open();
    });
    order.length = 0;

    let refreshed: boolean | undefined;
    await act(async () => {
      refreshed = await result.current.actions.refreshWorkspace("ws");
    });

    expect(order).toEqual(["refresh ws", "list ws"]);
    expect(refreshed).toBe(true);
  });

  // `truncated` describes the TREE, and a newer commit's tree can be cut short where the old one was
  // not - so what the shell says now replaces what it said at open.
  it("takes what the shell now says about the workspace", async () => {
    const { client } = fakeClient({
      refreshWorkspace: async () => ({
        ok: true,
        workspace: { id: "ws", name: "ws", ref: { kind: "local" as const, root: "/ws" }, truncated: true },
      }),
    });
    const { result } = renderHook(() => useWorkspace(client));
    await act(async () => {
      await result.current.actions.open();
    });

    await act(async () => {
      await result.current.actions.refreshWorkspace("ws");
    });

    expect(result.current.state.workspaces[0]?.truncated).toBe(true);
  });

  // A repository that could not be moved on is still on the commit it was - so its listings are still
  // right, nothing is re-listed, and the user is told why in the banner every other failure uses.
  it("says why the shell could not refresh it, and lists nothing", async () => {
    const fs = disk({ ws: [{ name: "a.md", kind: "file" }] });
    const { client } = fakeClient({
      listDirectory: fs.listDirectory,
      refreshWorkspace: async () => ({ ok: false, reason: "rate-limited" }),
    });
    const { result } = renderHook(() => useWorkspace(client));
    await act(async () => {
      await result.current.actions.open();
    });
    fs.listed.length = 0;

    let refreshed: boolean | undefined;
    await act(async () => {
      refreshed = await result.current.actions.refreshWorkspace("ws");
    });

    expect(refreshed).toBe(false);
    expect(fs.listed).toEqual([]);
    expect(result.current.state.errorKey).toBe("errors.rateLimited");
    expect(names(result.current.state, "ws")).toEqual(["a.md"]);
  });

  // "ws" must not refresh "ws-archive" - the same prefix trap `withoutSubtree` guards against.
  it("leaves every other open workspace alone", async () => {
    const fs = disk({
      ws: [{ name: "a.md", kind: "file" }],
      "ws-archive": [{ name: "old.md", kind: "file" }],
    });
    const { client } = fakeClient({ listDirectory: fs.listDirectory });
    const { result } = renderHook(() => useWorkspace(client));
    await act(async () => {
      await result.current.actions.openRef({ kind: "local", root: "/ws" });
    });
    await act(async () => {
      await result.current.actions.openRef({ kind: "local", root: "/ws-archive" });
    });
    fs.listed.length = 0;

    await act(async () => {
      await result.current.actions.refreshWorkspace("ws");
    });

    expect(fs.listed).toEqual(["ws"]);
    expect(names(result.current.state, "ws-archive")).toEqual(["old.md"]);
  });
});
