import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { describeFailure, parentOf, useWorkspace } from "./useWorkspace";
import type { ReadResult, WorkspaceClient, WriteResult } from "../lib/workspaceClient";

/// A hand-written fake, not a mocking library. It records what it was asked to do, which is what most
/// of these assertions are actually about - particularly that a save presents the revision the file
/// was read at.
function fakeClient(overrides: Partial<WorkspaceClient> = {}) {
  const writes: { path: string; content: string; revision: string | null }[] = [];

  const client: WorkspaceClient = {
    openWorkspace: async () => ({ ok: true, workspace: { root: "/ws", name: "ws" } }),
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

describe("describeFailure", () => {
  it("explains a conflict in terms of what the user can do, and reassures them", () => {
    const message = describeFailure("conflict");
    expect(message).toMatch(/changed on disk/i);
    expect(message).toMatch(/still here/i);
  });

  it("says the browser preview has no filesystem, rather than reporting an error", () => {
    expect(describeFailure("not-desktop")).toMatch(/desktop app/i);
  });

  // Cancelling a folder picker is not a failure and must not raise anything.
  it("has nothing to say about a cancelled dialog", () => {
    expect(describeFailure("cancelled")).toBe("");
  });

  it("never leaks an errno to the user", () => {
    expect(describeFailure("EACCES")).toBe("Something went wrong.");
  });
});

describe("useWorkspace", () => {
  it("starts with nothing open", () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    expect(result.current.state.workspace).toBeNull();
    expect(result.current.state.file).toBeNull();
  });

  it("lists the root after a folder is opened, directories first", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });

    expect(result.current.state.workspace?.name).toBe("ws");
    expect(result.current.state.nodes.map((n) => n.name)).toEqual(["notes", "a.md", "b.md"]);
  });

  it("navigates into a directory and back up", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    await act(async () => {
      await result.current.actions.open();
    });
    await act(async () => {
      await result.current.actions.enter("notes");
    });
    expect(result.current.state.directory).toBe("notes");

    await act(async () => {
      await result.current.actions.goUp();
    });
    expect(result.current.state.directory).toBe("");
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
    expect(result.current.state.error).toMatch(/changed on disk/i);
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

    await waitFor(() => expect(result.current.state.error).toMatch(/no longer there/i));
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

    expect(result.current.state.error).toMatch(/desktop app/i);
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

    expect(result.current.state.error).toBeNull();
  });
});
