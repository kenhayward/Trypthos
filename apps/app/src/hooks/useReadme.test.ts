import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReadme } from "./useReadme";

/// A workspace's front page, for any kind of workspace.
///
/// It used to be fetched only for a GitHub repository, inside the repository page's own hook, though
/// nothing about it was GitHub's. A local folder's README is its front page just as much.

function client(files: Record<string, string>, { listFails = false } = {}) {
  return {
    listDirectory: vi.fn(async (path: string) =>
      listFails
        ? { ok: false as const, reason: "not-found" }
        : {
            ok: true as const,
            nodes: Object.keys(files).map((name) => ({ id: `${path}/${name}`, name, kind: "file" as const })),
          },
    ),
    readFile: vi.fn(async (path: string) => {
      const name = path.slice(path.indexOf("/") + 1);
      return name in files
        ? { ok: true as const, content: files[name]!, revision: { id: "r" } }
        : { ok: false as const, reason: "not-found" };
    }),
  };
}

describe("a workspace's README", () => {
  it("reads the one at the root", async () => {
    const fake = client({ "README.md": "# Notes", "Plan.md": "" });
    const { result } = renderHook(() => useReadme("Notes", fake as never));
    await waitFor(() => expect(result.current.source).toBe("# Notes"));
    expect(result.current.path).toBe("Notes/README.md");
    expect(result.current.failed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  // "There is no README" and "the README could not be read" are different facts, and showing the
  // first for the second is a wrong answer given confidently.
  it("answers no README, not a failure, when there is none", async () => {
    const { result } = renderHook(() => useReadme("Notes", client({ "Plan.md": "" }) as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe(null);
    expect(result.current.failed).toBe(false);
  });

  it("says it failed when the listing does", async () => {
    const { result } = renderHook(() => useReadme("Notes", client({}, { listFails: true }) as never));
    await waitFor(() => expect(result.current.failed).toBe(true));
  });

  it("reads once per workspace, however often the page is shown", async () => {
    const fake = client({ "README.md": "# Notes" });
    const { result, rerender } = renderHook(({ id }) => useReadme(id, fake as never), {
      initialProps: { id: "Notes" },
    });
    await waitFor(() => expect(result.current.source).toBe("# Notes"));
    rerender({ id: "Notes" });
    expect(fake.readFile).toHaveBeenCalledTimes(1);
  });

  it("reads it again once told to", async () => {
    const fake = client({ "README.md": "# Notes" });
    const { result } = renderHook(() => useReadme("Notes", fake as never));
    await waitFor(() => expect(result.current.source).toBe("# Notes"));
    result.current.invalidate("Notes");
    await waitFor(() => expect(fake.readFile).toHaveBeenCalledTimes(2));
  });

  it("is idle with no workspace", () => {
    const { result } = renderHook(() => useReadme(null, client({}) as never));
    expect(result.current).toMatchObject({ loading: false, source: null, path: null, failed: false });
  });
});
