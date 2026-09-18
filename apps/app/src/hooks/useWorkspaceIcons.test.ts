import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IconMap } from "@trypthos/domain";
import type { IconsClient } from "../lib/workspaceClient";
import { useWorkspaceIcons } from "./useWorkspaceIcons";

/// One map per open workspace, fetched once when it opens.
///
/// There is no watcher, deliberately: icons set in Obsidian while Trypthos is open appear after a
/// refresh, which is the same contract the graph already has.

const client = (icons: Record<string, IconMap>) => {
  const workspaceIcons = vi.fn(async (id: string) =>
    id in icons ? { ok: true as const, icons: icons[id]! } : { ok: false as const, reason: "no-workspace" },
  );
  return { workspaceIcons } satisfies IconsClient & { workspaceIcons: typeof workspaceIcons };
};

describe("a workspace's icons", () => {
  it("fetches one map for each open workspace", async () => {
    const assignments = { Notes: { Projects: { icon: "lucide-folder", colour: null } } };
    const fake = client(assignments);
    const { result } = renderHook(() => useWorkspaceIcons(fake, ["Notes"]));
    await waitFor(() => expect(result.current.Notes).toEqual(assignments.Notes));
    expect(fake.workspaceIcons).toHaveBeenCalledWith("Notes");
  });

  it("asks once per workspace, not once per render", async () => {
    const fake = client({ Notes: {} });
    const { result, rerender } = renderHook(({ ids }) => useWorkspaceIcons(fake, ids), {
      initialProps: { ids: ["Notes"] },
    });
    await waitFor(() => expect(result.current.Notes).toEqual({}));
    rerender({ ids: ["Notes"] });
    rerender({ ids: ["Notes"] });
    expect(fake.workspaceIcons).toHaveBeenCalledTimes(1);
  });

  it("forgets a workspace that has been closed", async () => {
    const fake = client({ Notes: { A: { icon: "lucide-a", colour: null } }, Ideas: {} });
    const { result, rerender } = renderHook(({ ids }) => useWorkspaceIcons(fake, ids), {
      initialProps: { ids: ["Notes", "Ideas"] },
    });
    await waitFor(() => expect(Object.keys(result.current).sort()).toEqual(["Ideas", "Notes"]));
    rerender({ ids: ["Ideas"] });
    await waitFor(() => expect(Object.keys(result.current)).toEqual(["Ideas"]));
  });

  // Opening a second folder must not send the shell back to the plugin file of every folder that
  // was already open. Each map is fetched once, for the workspace it belongs to.
  it("asks only for the workspace that has just opened", async () => {
    const fake = client({ Notes: {}, Ideas: {} });
    const { result, rerender } = renderHook(({ ids }) => useWorkspaceIcons(fake, ids), {
      initialProps: { ids: ["Notes"] },
    });
    await waitFor(() => expect(result.current.Notes).toEqual({}));
    rerender({ ids: ["Notes", "Ideas"] });
    await waitFor(() => expect(result.current.Ideas).toEqual({}));
    expect(fake.workspaceIcons.mock.calls.map(([id]) => id)).toEqual(["Notes", "Ideas"]);
  });

  // A refusal is not an error here. A workspace with no icon plugin, a repository, a folder that is
  // not a vault at all - every one of them answers this way, and every one means no icons.
  it("holds an empty map when the shell refuses", async () => {
    const { result } = renderHook(() => useWorkspaceIcons(client({}), ["Notes"]));
    await waitFor(() => expect(result.current.Notes).toEqual({}));
  });
});
