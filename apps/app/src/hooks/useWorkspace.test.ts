import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { failureKey, parentOf, useWorkspace, withoutSubtree } from "./useWorkspace";
import type { ReadResult, WorkspaceClient, WriteResult } from "../lib/workspaceClient";

/// A hand-written fake, not a mocking library. It records what it was asked to do, which is what most
/// of these assertions are actually about - particularly that a save presents the revision the file
/// was read at.
function fakeClient(overrides: Partial<WorkspaceClient> = {}) {
  const writes: { path: string; content: string; revision: string | null }[] = [];

  const client: WorkspaceClient = {
    // Chat's map of the folder. Nothing in this hook asks for it; it is here because the client is
    // one interface.
    workspaceOutline: async () => ({ ok: true, outline: { paths: [], truncated: false } }),
    openWorkspace: async () => ({ ok: true, workspace: { root: "/ws", name: "ws" } }),
    reopenWorkspace: async (root) => ({ ok: true, workspace: { root, name: "ws" } }),
    listDirectory: async (path) => ({
      ok: true,
      nodes:
        path === ""
          ? [
              { id: "b.md", name: "b.md", kind: "file" },
              { id: "notes", name: "notes", kind: "directory" },
              { id: "a.md", name: "a.md", kind: "file" },
            ]
          : [{ id: `${path}/inner.md`, name: "inner.md", kind: "file" }],
    }),
    readFile: async (): Promise<ReadResult> => ({
      ok: true,
      content: "# On disk\n",
      revision: { id: "r1" },
    }),
    writeFile: async (path, content, expectedRevision): Promise<WriteResult> => {
      writes.push({ path, content, revision: expectedRevision?.id ?? null });
      return { ok: true, revision: { id: "r2" } };
    },
    ...overrides,
  };

  return { client, writes };
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

  // An errno must never reach the interface, whether as wording or as a key that renders raw.
  it("maps anything unrecognised to the generic key", () => {
    expect(failureKey("EACCES")).toBe("errors.unknown");
    expect(failureKey("")).toBe("errors.unknown");
  });
});

describe("useWorkspace", () => {
  it("starts with nothing open", () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    expect(result.current.state.workspace).toBeNull();
    expect(result.current.state.file).toBeNull();
  });

  it("lists the root after a folder is opened", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });

    expect(result.current.state.workspace?.name).toBe("ws");
    expect(result.current.state.folders[""]?.status).toBe("loaded");
    expect(result.current.state.folders[""]?.children?.map((n) => n.name)).toContain("notes");
  });

  it("expands a folder, then collapses it again", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.toggleFolder("notes");
    });
    expect(result.current.state.folders["notes"]?.status).toBe("loaded");

    await act(async () => {
      await result.current.actions.toggleFolder("notes");
    });
    expect(result.current.state.folders["notes"]).toBeUndefined();
  });

  // A failed folder is a fact about that row. Raising it as a banner would suggest the workspace is
  // broken when every other folder is fine.
  it("records a failed listing on the folder, not as a panel-wide error", async () => {
    const { client } = fakeClient({
      listDirectory: async (path) =>
        path === "notes" ? { ok: false, reason: "permission-denied" } : { ok: true, nodes: [] },
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.toggleFolder("notes");
    });

    expect(result.current.state.folders["notes"]?.status).toBe("error");
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
      await result.current.actions.retryFolder("notes");
    });
    expect(result.current.state.folders["notes"]?.status).toBe("error");

    await act(async () => {
      await result.current.actions.retryFolder("notes");
    });
    expect(result.current.state.folders["notes"]?.status).toBe("loaded");
  });

  // A remembered folder that has since gone is not an error the user caused, and a warning about a
  // path they may not remember choosing is worse than simply opening with nothing.
  it("says nothing when a remembered folder can no longer be opened", async () => {
    const { client } = fakeClient({
      reopenWorkspace: async () => ({ ok: false, reason: "not-found" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.reopen("D:/Gone");
    });

    expect(result.current.state.workspace).toBeNull();
    expect(result.current.state.errorKey).toBeNull();
  });

  it("reopens a remembered folder and lists it", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.reopen("D:/Notes");
    });

    expect(result.current.state.workspace?.root).toBe("D:/Notes");
    expect(result.current.state.folders[""]?.status).toBe("loaded");
  });

  it("holds the filter text", () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    act(() => {
      result.current.actions.setFilter("plan");
    });
    expect(result.current.state.filter).toBe("plan");
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

    expect(writes).toEqual([{ path: "a.md", content: "# Edited\n", revision: "r1" }]);
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

  it("explains that the browser preview cannot open folders", async () => {
    const { client } = fakeClient({
      openWorkspace: async () => ({ ok: false, reason: "not-desktop" }),
    });
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });

    expect(result.current.state.errorKey).toBe("errors.notDesktop");
    expect(result.current.state.workspace).toBeNull();
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
});
