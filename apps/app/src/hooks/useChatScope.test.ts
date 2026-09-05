import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChatScope, type ScopeBridge, type ScopeSource } from "./useChatScope";

const SOURCE: ScopeSource = {
  selection: "",
  file: { path: "notes/plan.md", content: "# Plan", fileType: "markdown" },
};

function fakeBridge(files: Record<string, string> = {}) {
  return {
    workspaceOutline: vi.fn(async () => ({
      ok: true as const,
      outline: { paths: ["notes/plan.md", "notes/risks.md"], truncated: false },
    })),
    readFile: vi.fn(async (path: string) =>
      path in files
        ? { ok: true as const, content: files[path]! }
        : { ok: false as const, reason: "not-found" },
    ),
  } satisfies ScopeBridge;
}

const scope = (bridge: ScopeBridge | null, source: ScopeSource = SOURCE) =>
  renderHook(() => useChatScope(bridge, () => source));

describe("attachments", () => {
  it("reads a file when it is attached, and sends it", async () => {
    const bridge = fakeBridge({ "notes/risks.md": "# Risks" });
    const { result } = scope(bridge);

    await act(async () => {
      await result.current.attach("notes/risks.md");
    });

    expect(result.current.attachments).toEqual(["notes/risks.md"]);
    expect(result.current.context().attachments[0]).toMatchObject({
      path: "notes/risks.md",
      text: "# Risks",
    });
  });

  // Sending the same file twice would spend the budget on a duplicate.
  it("ignores a file that is already attached", async () => {
    const bridge = fakeBridge({ "notes/risks.md": "# Risks" });
    const { result } = scope(bridge);

    await act(async () => {
      await result.current.attach("notes/risks.md");
      await result.current.attach("notes/risks.md");
    });

    expect(result.current.attachments).toHaveLength(1);
  });

  it("attaches nothing when the file cannot be read", async () => {
    const bridge = fakeBridge();
    const { result } = scope(bridge);

    await act(async () => {
      await result.current.attach("notes/gone.md");
    });

    expect(result.current.attachments).toEqual([]);
  });

  it("removes an attachment", async () => {
    const bridge = fakeBridge({ "notes/risks.md": "# Risks" });
    const { result } = scope(bridge);

    await act(async () => {
      await result.current.attach("notes/risks.md");
    });
    act(() => result.current.detach("notes/risks.md"));

    expect(result.current.attachments).toEqual([]);
  });

  // Read once, when attached. A file edited afterwards is a different question, and re-reading it
  // silently would change what an earlier answer was about.
  it("keeps the contents as they were when the file was attached", async () => {
    const files = { "notes/risks.md": "# Risks" };
    const bridge = fakeBridge(files);
    const { result } = scope(bridge);

    await act(async () => {
      await result.current.attach("notes/risks.md");
    });
    files["notes/risks.md"] = "# Risks, rewritten";

    expect(result.current.context().attachments[0]?.text).toBe("# Risks");
  });
});

describe("the folder", () => {
  it("is not included until it is asked for", () => {
    const bridge = fakeBridge();
    const { result } = scope(bridge);

    expect(result.current.context().folder).toBeNull();
    expect(bridge.workspaceOutline).not.toHaveBeenCalled();
  });

  it("lists the folder once it is asked for", async () => {
    const bridge = fakeBridge();
    const { result } = scope(bridge);

    act(() => result.current.setIncludeFolder(true));
    await waitFor(() => expect(result.current.context().folder).not.toBeNull());

    expect(result.current.context().folder?.paths).toContain("notes/risks.md");
  });

  it("stops sending the folder when it is switched off", async () => {
    const bridge = fakeBridge();
    const { result } = scope(bridge);

    act(() => result.current.setIncludeFolder(true));
    await waitFor(() => expect(result.current.context().folder).not.toBeNull());
    act(() => result.current.setIncludeFolder(false));

    expect(result.current.context().folder).toBeNull();
  });
});

describe("the context it builds", () => {
  it("carries the open document", () => {
    const { result } = scope(fakeBridge());
    expect(result.current.context().document).toMatchObject({ kind: "file", text: "# Plan" });
  });

  it("prefers a selection, as it always has", () => {
    const { result } = scope(fakeBridge(), { ...SOURCE, selection: "A passage" });
    expect(result.current.context().document).toMatchObject({ kind: "selection" });
  });

  // Starting a new conversation should not silently carry the last one's attachments into it.
  it("forgets attachments and the folder when cleared", async () => {
    const bridge = fakeBridge({ "notes/risks.md": "# Risks" });
    const { result } = scope(bridge);

    await act(async () => {
      await result.current.attach("notes/risks.md");
    });
    act(() => result.current.setIncludeFolder(true));
    act(() => result.current.clear());

    expect(result.current.attachments).toEqual([]);
    expect(result.current.includeFolder).toBe(false);
    expect(result.current.context().folder).toBeNull();
  });

  // The browser preview, where there is no filesystem to attach from.
  it("sends nothing at all without a shell", () => {
    const { result } = scope(null);
    expect(result.current.context()).toEqual({
      document: { kind: "none" },
      attachments: [],
      folder: null,
    });
  });
});
