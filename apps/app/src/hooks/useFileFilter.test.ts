import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileFilter, type FilterSurroundings } from "./useFileFilter";
import type { FilterResult } from "../lib/workspaceClient";

const NOTES = { id: "Notes" };
const WORK = { id: "Work" };

/// The searches the hook asked for, and what it was told.
function shell(
  answers: Record<string, FilterResult> = {},
  overrides: Partial<FilterSurroundings> = {},
) {
  const asked: { path: string; filter: string }[] = [];
  const where: FilterSurroundings = {
    workspaces: [NOTES],
    filterFiles: async (request) => {
      asked.push({ path: request.path, filter: request.filter });
      return answers[request.path] ?? { ok: true, paths: [], truncated: false };
    },
    ...overrides,
  };
  return { where, asked };
}

const run = (where: FilterSurroundings) =>
  renderHook(({ w }: { w: FilterSurroundings }) => useFileFilter(w), { initialProps: { w: where } });

/// waitFor polls on real timers, which fake timers replace - so it can never resolve here. The
/// searches resolve on microtasks, so flushing with act is both correct and immediate.
async function flush() {
  await act(async () => {});
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useFileFilter", () => {
  it("starts empty, and asks for nothing", async () => {
    const { where, asked } = shell();
    const { result } = run(where);

    expect(result.current.filter).toBe("");
    expect(result.current.status).toEqual({ kind: "idle" });
    act(() => void vi.advanceTimersByTime(5000));
    await flush();
    expect(asked).toEqual([]);
  });

  it("searches each open folder for what was typed", async () => {
    const { where, asked } = shell(
      { Notes: { ok: true, paths: ["Notes/docs/plan.md"], truncated: false } },
      { workspaces: [NOTES, WORK] },
    );
    const { result } = run(where);

    act(() => result.current.setFilter("plan"));
    act(() => void vi.advanceTimersByTime(1000));
    await flush();

    expect(asked).toEqual([
      { path: "Notes", filter: "plan" },
      { path: "Work", filter: "plan" },
    ]);
    expect(result.current.status).toEqual({
      kind: "results",
      paths: ["Notes/docs/plan.md"],
      truncated: false,
    });
  });

  // The box is typed in a character at a time, and each character would otherwise be a walk of every
  // open folder. What the user sees is their own typing, which is not delayed by any of this.
  it("waits for the typing to settle before it searches", async () => {
    const { where, asked } = shell();
    const { result } = run(where);

    act(() => result.current.setFilter("p"));
    act(() => result.current.setFilter("pl"));
    act(() => result.current.setFilter("plan"));
    expect(asked).toEqual([]);

    act(() => void vi.advanceTimersByTime(1000));
    await flush();
    expect(asked).toEqual([{ path: "Notes", filter: "plan" }]);
  });

  it("says it is searching while it waits for an answer", async () => {
    const { where } = shell();
    const { result } = run(where);

    act(() => result.current.setFilter("plan"));
    expect(result.current.status).toEqual({ kind: "searching" });

    act(() => void vi.advanceTimersByTime(1000));
    await flush();
    expect(result.current.status.kind).toBe("results");
  });

  // A search that came back after the user had typed something else would replace the answer to the
  // question they are now asking with the answer to one they have abandoned.
  it("ignores an answer to a filter that has been typed over", async () => {
    let releaseFirst: ((result: FilterResult) => void) | null = null;
    const asked: string[] = [];
    const where: FilterSurroundings = {
      workspaces: [NOTES],
      filterFiles: (request) => {
        asked.push(request.filter);
        if (request.filter === "slow") {
          return new Promise<FilterResult>((resolve) => (releaseFirst = resolve));
        }
        return Promise.resolve({ ok: true, paths: ["Notes/fast.md"], truncated: false });
      },
    };
    const { result } = run(where);

    act(() => result.current.setFilter("slow"));
    act(() => void vi.advanceTimersByTime(1000));
    await flush();

    act(() => result.current.setFilter("fast"));
    act(() => void vi.advanceTimersByTime(1000));
    await flush();

    await act(async () => {
      releaseFirst?.({ ok: true, paths: ["Notes/slow.md"], truncated: false });
    });

    expect(asked).toEqual(["slow", "fast"]);
    expect(result.current.status).toEqual({
      kind: "results",
      paths: ["Notes/fast.md"],
      truncated: false,
    });
  });

  it("goes back to showing the tree when the box is cleared", async () => {
    const { where } = shell({ Notes: { ok: true, paths: ["Notes/plan.md"], truncated: false } });
    const { result } = run(where);

    act(() => result.current.setFilter("plan"));
    act(() => void vi.advanceTimersByTime(1000));
    await flush();
    expect(result.current.status.kind).toBe("results");

    act(() => result.current.setFilter(""));
    expect(result.current.status).toEqual({ kind: "idle" });
  });

  // Spaces are not a filter. Trimmed here as well as in the matcher, so a box holding one space does
  // not walk every open folder to answer nothing.
  it("treats a box holding only spaces as empty", async () => {
    const { where, asked } = shell();
    const { result } = run(where);

    act(() => result.current.setFilter("   "));
    act(() => void vi.advanceTimersByTime(1000));
    await flush();

    expect(asked).toEqual([]);
    expect(result.current.status).toEqual({ kind: "idle" });
  });

  it("carries the folders' answers back together, capped if either was", async () => {
    const { where } = shell(
      {
        Notes: { ok: true, paths: ["Notes/a.md"], truncated: false },
        Work: { ok: true, paths: ["Work/b.md"], truncated: true },
      },
      { workspaces: [NOTES, WORK] },
    );
    const { result } = run(where);

    act(() => result.current.setFilter("*.md"));
    act(() => void vi.advanceTimersByTime(1000));
    await flush();

    expect(result.current.status).toEqual({
      kind: "results",
      paths: ["Notes/a.md", "Work/b.md"],
      truncated: true,
    });
  });

  // One folder that has gone - unmounted, renamed - must not take the answer away from the others.
  // A filter is not the place to learn that, and the tree's own row already says a folder failed.
  it("keeps the folders that answered when one fails", async () => {
    const { where } = shell(
      {
        Notes: { ok: false, reason: "not-found" },
        Work: { ok: true, paths: ["Work/b.md"], truncated: false },
      },
      { workspaces: [NOTES, WORK] },
    );
    const { result } = run(where);

    act(() => result.current.setFilter("b"));
    act(() => void vi.advanceTimersByTime(1000));
    await flush();

    expect(result.current.status).toEqual({
      kind: "results",
      paths: ["Work/b.md"],
      truncated: false,
    });
  });

  // Closing a folder while a filter is up would otherwise leave its matches on screen, under a
  // heading for a folder that is no longer open.
  it("searches again when the open folders change", async () => {
    const { where, asked } = shell({}, { workspaces: [NOTES] });
    const { result, rerender } = run(where);

    act(() => result.current.setFilter("plan"));
    act(() => void vi.advanceTimersByTime(1000));
    await flush();
    expect(asked).toHaveLength(1);

    rerender({ w: { ...where, workspaces: [NOTES, WORK] } });
    act(() => void vi.advanceTimersByTime(1000));
    await flush();

    expect(asked.map((one) => one.path)).toEqual(["Notes", "Notes", "Work"]);
  });
});

/// The window hands this hook a fresh callback on every render - it closes over the client - so an
/// effect that keyed on it would search, set state, re-render and search again for ever. React
/// stops that with "Maximum update depth exceeded", which is how it was found.
describe("useFileFilter: what makes it search again", () => {
  it("does not search again just because the caller re-rendered", async () => {
    const { where, asked } = shell();
    const { result, rerender } = run(where);

    act(() => result.current.setFilter("plan"));
    act(() => void vi.advanceTimersByTime(1000));
    await flush();
    expect(asked).toHaveLength(1);

    // A new object carrying a NEW closure, which is what a re-render of the window produces: the
    // callback there is written inline and closes over the client.
    rerender({ w: { ...where, filterFiles: (request) => where.filterFiles(request) } });
    act(() => void vi.advanceTimersByTime(1000));
    await flush();

    expect(asked).toHaveLength(1);
  });
});
