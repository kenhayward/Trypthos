import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFind, type FindSurroundings } from "./useFind";
import type { FindResult } from "../lib/workspaceClient";

const DOC = "The cat sat on the mat.\nAnother cat entirely.\n";

function surroundings(overrides: Partial<FindSurroundings> = {}): FindSurroundings {
  return {
    content: DOC,
    activePath: "notes.md",
    selectedFolder: "",
    fileTypes: ["markdown"],
    findInFiles: async () => ({ ok: true, hits: [], capped: false }),
    openPath: async () => {},
    ...overrides,
  };
}

const run = (overrides: Partial<FindSurroundings> = {}) =>
  renderHook(({ where }: { where: FindSurroundings }) => useFind(where), {
    initialProps: { where: surroundings(overrides) },
  });

describe("useFind: the dialog", () => {
  it("starts closed, on the document tab", () => {
    const { result } = run();
    expect(result.current.open).toBe(false);
    expect(result.current.tab).toBe("document");
  });

  it("opens and closes", () => {
    const { result } = run();

    act(() => result.current.openFind());
    expect(result.current.open).toBe(true);

    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });

  // Closing takes the highlights with it. A dialog that is gone while the document is still marked
  // up leaves colour on the page with nothing that explains it and no way to clear it.
  it("clears what it highlighted when it closes", async () => {
    const { result } = run();

    act(() => result.current.openFind());
    act(() => result.current.setQuery("cat"));
    await act(async () => {
      await result.current.search();
    });
    expect(result.current.highlight.matches).toHaveLength(2);

    act(() => result.current.close());
    expect(result.current.highlight.matches).toHaveLength(0);
  });
});

describe("useFind: the open document", () => {
  const searched = async (query: string, regex = false, caseSensitive = false) => {
    const view = run();
    act(() => view.result.current.openFind());
    act(() => view.result.current.setQuery(query));
    if (regex) act(() => view.result.current.setRegex(true));
    if (caseSensitive) act(() => view.result.current.setCaseSensitive(true));
    await act(async () => {
      await view.result.current.search();
    });
    return view;
  };

  it("finds every occurrence and lands on the first", async () => {
    const { result } = await searched("cat");

    expect(result.current.status).toEqual({ kind: "results", total: 2, current: 1, capped: false });
    expect(result.current.highlight.matches).toEqual([
      { from: 4, to: 7 },
      { from: 32, to: 35 },
    ]);
    expect(result.current.highlight.active).toBe(0);
    // The highlight belongs to the document it was found in, so switching tabs cannot leave it
    // painted over somebody else's text.
    expect(result.current.highlight.path).toBe("notes.md");
  });

  it("steps through them, and wraps", async () => {
    const { result } = await searched("cat");

    await act(async () => {
      await result.current.step("next");
    });
    expect(result.current.highlight.active).toBe(1);
    expect(result.current.status).toMatchObject({ current: 2 });

    await act(async () => {
      await result.current.step("next");
    });
    expect(result.current.highlight.active).toBe(0);
  });

  it("takes a regular expression when it is told to", async () => {
    // `cat`, `mat`, `cat` - and no `sat`, which is what says the brackets were read as a character
    // class rather than as three literal characters.
    const { result } = await searched("[cm]at", true);
    expect(result.current.status).toMatchObject({ kind: "results", total: 3 });
  });

  // Off to begin with, because that is what every other search in the app does. On is what makes a
  // search of a source file useful, where `state` and `State` are two different things.
  it("ignores case until it is told not to", async () => {
    // `The`, `the`, and the middle of `Another`.
    const insensitive = await searched("the");
    expect(insensitive.result.current.caseSensitive).toBe(false);
    expect(insensitive.result.current.status).toMatchObject({ total: 3 });

    // Only the one that is actually capitalised.
    const sensitive = await searched("The", false, true);
    expect(sensitive.result.current.status).toMatchObject({ total: 1 });
  });

  // "That is not a pattern" and "nothing here matches" send the user in opposite directions.
  it("says an expression is broken rather than saying nothing matched", async () => {
    const { result } = await searched("[unclosed", true);
    expect(result.current.status).toEqual({ kind: "bad-pattern" });
  });

  it("reports finding nothing", async () => {
    const { result } = await searched("needle");
    expect(result.current.status).toEqual({ kind: "results", total: 0, current: 0, capped: false });
    expect(result.current.highlight.matches).toHaveLength(0);
  });

  // The two tabs are two searches, not two views of one. Left in place, the last document search's
  // results would still be what Next walked while the Files tab was on screen - so a hit list about
  // one thing would be stepped through under a heading about another.
  it("puts its results away when the tab changes", async () => {
    const { result } = await searched("cat");
    expect(result.current.status).toMatchObject({ kind: "results" });

    act(() => result.current.setTab("files"));
    expect(result.current.status).toEqual({ kind: "idle" });
    expect(result.current.highlight.matches).toHaveLength(0);

    // And Next has nothing to walk, rather than walking what the other tab found.
    await act(async () => {
      await result.current.step("next");
    });
    expect(result.current.highlight.matches).toHaveLength(0);
  });

  it("does nothing at all with an empty query", async () => {
    const view = run();
    act(() => view.result.current.openFind());
    await act(async () => {
      await view.result.current.search();
    });
    expect(view.result.current.status).toEqual({ kind: "idle" });
  });
});

/// Where the panel sits.
///
/// Remembered by the hook rather than by the dialog, which unmounts when the find closes: a panel
/// moved out of the way of the text you were reading would go back to covering it the next time you
/// pressed Ctrl+F.
describe("useFind: where the panel sits", () => {
  it("starts wherever the stylesheet puts it", () => {
    const { result } = run();
    expect(result.current.position).toBeNull();
  });

  it("remembers where it was moved to, across closing and reopening", () => {
    const { result } = run();

    act(() => result.current.openFind());
    act(() => result.current.setPosition({ left: 40, top: 120 }));
    expect(result.current.position).toEqual({ left: 40, top: 120 });

    act(() => result.current.close());
    act(() => result.current.openFind());
    expect(result.current.position).toEqual({ left: 40, top: 120 });
  });
});

describe("useFind: the files under a folder", () => {
  const HITS: FindResult = {
    ok: true,
    capped: false,
    hits: [
      { path: "docs/a.md", line: 1, column: 1, from: 0, to: 3, preview: "cat" },
      { path: "docs/b.md", line: 4, column: 2, from: 20, to: 23, preview: " cat" },
    ],
  };

  const searchFiles = async (overrides: Partial<FindSurroundings> = {}) => {
    const view = run(overrides);
    act(() => view.result.current.openFind());
    act(() => view.result.current.setTab("files"));
    act(() => view.result.current.setQuery("cat"));
    await act(async () => {
      await view.result.current.search();
    });
    return view;
  };

  it("asks the shell, and lands on the first hit", async () => {
    const findInFiles = vi.fn(async () => HITS);
    const openPath = vi.fn(async () => {});
    const { result } = await searchFiles({ findInFiles, openPath, selectedFolder: "docs" });

    expect(findInFiles).toHaveBeenCalledWith({
      path: "docs",
      pattern: "cat",
      regex: false,
      caseSensitive: false,
      fileTypes: ["markdown"],
    });
    expect(result.current.status).toMatchObject({ kind: "results", total: 2, current: 1 });
    // Opened, not merely listed: a result you have to go and find yourself is a result list.
    expect(openPath).toHaveBeenCalledWith("docs/a.md");
    expect(result.current.highlight).toMatchObject({ path: "docs/a.md", active: 0 });
  });

  // One match per highlight here, unlike the document tab: the editor is showing the file this hit
  // is in, and the others are in files it is not showing.
  it("highlights the hit it opened, and only that one", async () => {
    const { result } = await searchFiles({ findInFiles: async () => HITS });
    expect(result.current.highlight.matches).toEqual([{ from: 0, to: 3 }]);
  });

  it("opens the next file when it steps into one", async () => {
    const openPath = vi.fn(async () => {});
    const { result } = await searchFiles({ findInFiles: async () => HITS, openPath });

    await act(async () => {
      await result.current.step("next");
    });

    expect(openPath).toHaveBeenLastCalledWith("docs/b.md");
    expect(result.current.highlight).toMatchObject({ path: "docs/b.md" });
    expect(result.current.highlight.matches).toEqual([{ from: 20, to: 23 }]);
  });

  // The folder the user picked, or the one the open file is in. Shown in the dialog, so a search
  // that looked somewhere unexpected says so before it runs rather than after.
  it("searches the folder the open file is in when none is picked", async () => {
    const findInFiles = vi.fn(async () => HITS);
    await searchFiles({ findInFiles, selectedFolder: "", activePath: "src/deep/main.ts" });
    expect(findInFiles).toHaveBeenCalledWith(expect.objectContaining({ path: "src/deep" }));
  });

  it("passes a broken expression on as a broken expression", async () => {
    const { result } = await searchFiles({
      findInFiles: async () => ({ ok: false, reason: "bad-pattern" }),
    });
    expect(result.current.status).toEqual({ kind: "bad-pattern" });
  });

  it("says so when the shell could not answer", async () => {
    const { result } = await searchFiles({
      findInFiles: async () => ({ ok: false, reason: "no-workspace" }),
    });
    expect(result.current.status).toEqual({ kind: "failed" });
  });

  // An answer that was cut short has to say so, or it is a wrong answer given confidently.
  it("carries the cap through to what the dialog shows", async () => {
    const { result } = await searchFiles({
      findInFiles: async () => ({ ...HITS, capped: true }),
    });
    expect(result.current.status).toMatchObject({ capped: true });
  });

  it("is busy while it waits", async () => {
    let release: (value: FindResult) => void = () => {};
    const findInFiles = () => new Promise<FindResult>((resolve) => (release = resolve));

    const view = run({ findInFiles });
    act(() => view.result.current.openFind());
    act(() => view.result.current.setTab("files"));
    act(() => view.result.current.setQuery("cat"));

    let running: Promise<void> | undefined;
    act(() => {
      running = view.result.current.search();
    });
    expect(view.result.current.status).toEqual({ kind: "searching" });

    await act(async () => {
      release(HITS);
      await running;
    });
    expect(view.result.current.status).toMatchObject({ kind: "results" });
  });
});
