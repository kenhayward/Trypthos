import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { failureKey, parentOf, useWorkspace, withoutSubtree } from "./useWorkspace";
import type { ReadResult, WorkspaceClient, WriteResult } from "../lib/workspaceClient";

/// A hand-written fake, not a mocking library. It records what it was asked to do, which is what most
/// of these assertions are actually about - particularly that a save presents the revision the file
/// was read at.
function fakeClient(overrides: Partial<WorkspaceClient> = {}) {
  const writes: { path: string; content: string; revision: string | null }[] = [];
  const reads: string[] = [];

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
    readFile: async (path): Promise<ReadResult> => {
      reads.push(path);
      return { ok: true, content: "# On disk\n", revision: { id: "r1" } };
    },
    writeFile: async (path, content, expectedRevision): Promise<WriteResult> => {
      writes.push({ path, content, revision: expectedRevision?.id ?? null });
      return { ok: true, revision: { id: "r2" } };
    },
    ...overrides,
  };

  return { client, writes, reads };
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

    expect(writes).toEqual([{ path: "a.md", content: "# Mine\n", revision: "r1" }]);
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

      expect(writes).toEqual([{ path: "a.md", content: "# Mine\n", revision: "r1" }]);
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

/// Unsaved work, and everything that would throw it away.
///
/// With one document there was one question to ask. With several there is one PER document, and the
/// two paths that ask are the two that discard everything: opening another folder, and closing the
/// window. Switching tabs is not one of them, which is the point of tabs.
describe("guarding unsaved changes", () => {
  const NODE = { id: "b.md", name: "b.md", kind: "file" as const };
  const OTHER = { id: "a.md", name: "a.md", kind: "file" as const };

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

  it("guards opening another folder, and keeps the documents on cancel", async () => {
    const { result, ask } = await dirtyEditor("cancel");

    await act(async () => {
      await result.current.actions.open();
    });

    expect(ask.asked).toEqual(["b.md"]);
    expect(result.current.state.file?.path).toBe("b.md");
    expect(result.current.state.dirty).toBe(true);
  });

  // Every tab belongs to the folder that was open. Carrying them into another workspace would leave
  // paths pointing at files that are not there.
  it("closes every document when another folder is opened", async () => {
    const { result, writes } = await dirtyEditor("save");

    await act(async () => {
      await result.current.actions.openFile(OTHER);
    });
    await act(async () => {
      await result.current.actions.open();
    });

    expect(writes).toHaveLength(1);
    expect(result.current.state.documents).toHaveLength(0);
    expect(result.current.state.file).toBeNull();
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
