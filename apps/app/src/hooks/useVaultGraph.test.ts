import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphState } from "@trypthos/domain";
import type { GraphClient } from "../lib/workspaceClient";
import { PROGRESS_DELAY_MS, useVaultGraph } from "./useVaultGraph";

const snapshot = {
  workspaceId: "V",
  builtAt: "2026-09-17T10:00:00.000Z",
  unreadable: 0,
  newNotes: { mode: "root" as const },
  nodes: [{ id: "V/A.md", kind: "note" as const, label: "A", path: "V/A.md", degree: 0 }],
  edges: [],
};

/// A hand-written bridge: answers what `state` holds, and lets a test push events.
function fakeClient(initial: GraphState) {
  let state = initial;
  const progress = new Set<(message: unknown) => void>();
  const changed = new Set<(message: unknown) => void>();
  const client: GraphClient & { refreshed: string[] } = {
    refreshed: [],
    graphState: vi.fn(async () => ({ ok: true as const, state })),
    refreshGraph: vi.fn(async (id: string) => {
      client.refreshed.push(id);
      return { ok: true as const };
    }),
    onGraphProgress: (listener) => {
      progress.add(listener);
      return () => progress.delete(listener);
    },
    onGraphChanged: (listener) => {
      changed.add(listener);
      return () => changed.delete(listener);
    },
  };
  return {
    client,
    set: (next: GraphState) => (state = next),
    pushProgress: (message: unknown) => progress.forEach((listener) => listener(message)),
    pushChanged: (message: unknown) => changed.forEach((listener) => listener(message)),
    listeners: () => progress.size + changed.size,
  };
}

const flush = () => act(async () => {});

describe("useVaultGraph", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads the vault's graph", async () => {
    const fake = fakeClient({ snapshot, building: null, error: null });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();
    expect(result.current.snapshot).toEqual(snapshot);
    expect(result.current.error).toBe(null);
  });

  it("shows progress only once a build has run past the delay", async () => {
    const fake = fakeClient({ snapshot: null, building: null, error: null });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();

    act(() => fake.pushProgress({ workspaceId: "V", read: 1, total: 10, walking: false }));
    expect(result.current.building).toEqual({ workspaceId: "V", read: 1, total: 10, walking: false });
    expect(result.current.progress).toBe(null);

    await act(async () => vi.advanceTimersByTime(PROGRESS_DELAY_MS));
    expect(result.current.progress).toEqual({ workspaceId: "V", read: 1, total: 10, walking: false });
  });

  it("never flashes progress for a build that finishes inside the delay", async () => {
    const fake = fakeClient({ snapshot: null, building: null, error: null });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();

    act(() => fake.pushProgress({ workspaceId: "V", read: 0, total: 1, walking: true }));
    fake.set({ snapshot, building: null, error: null });
    act(() => fake.pushChanged({ workspaceId: "V" }));
    await flush();
    await act(async () => vi.advanceTimersByTime(PROGRESS_DELAY_MS * 2));

    expect(result.current.progress).toBe(null);
    expect(result.current.snapshot).toEqual(snapshot);
  });

  it("ignores events for other vaults and events that do not parse", async () => {
    const fake = fakeClient({ snapshot: null, building: null, error: null });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();

    act(() => fake.pushProgress({ workspaceId: "Other", read: 1, total: 2, walking: false }));
    act(() => fake.pushProgress({ workspaceId: "V", read: "one" }));
    act(() => fake.pushChanged({ workspaceId: "Other" }));
    await flush();

    expect(result.current.building).toBe(null);
    expect(fake.client.graphState).toHaveBeenCalledTimes(1);
  });

  it("reports a build that failed", async () => {
    const fake = fakeClient({ snapshot: null, building: null, error: "not-found" });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();
    expect(result.current.error).toBe("not-found");
  });

  it("asks for a rebuild when refreshed", async () => {
    const fake = fakeClient({ snapshot, building: null, error: null });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();
    await act(async () => result.current.refresh());
    await flush();
    expect(fake.client.refreshed).toEqual(["V"]);
    // The previous graph stays while the new one builds.
    expect(result.current.snapshot).toEqual(snapshot);
    expect(fake.client.graphState).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a vault, and stops listening when unmounted", async () => {
    const fake = fakeClient({ snapshot, building: null, error: null });
    const none = renderHook(() => useVaultGraph(fake.client, null));
    await flush();
    expect(none.result.current.snapshot).toBe(null);
    expect(fake.client.graphState).not.toHaveBeenCalled();
    none.unmount();

    const some = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();
    expect(fake.listeners()).toBe(2);
    some.unmount();
    expect(fake.listeners()).toBe(0);
  });
});
