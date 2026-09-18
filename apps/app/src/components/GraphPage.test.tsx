import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphSnapshot } from "@trypthos/domain";
import { expectsConsoleError } from "../test-setup";
import { FakeCanvas, fakeGraphClient, instantLayout } from "../testing/fakeGraphClient";
import { useVaultGraph } from "../hooks/useVaultGraph";
import type { GraphClient } from "../lib/workspaceClient";
import GraphPage from "./GraphPage";
import type { GraphPageProps } from "./GraphPage";

const NOW = Date.parse("2026-09-17T10:00:00.000Z");
const snapshot: GraphSnapshot = {
  workspaceId: "V",
  builtAt: "2026-09-17T10:00:00.000Z",
  unreadable: 0,
  truncated: false,
  newNotes: { mode: "folder", folder: "Inbox" },
  nodes: [
    { id: "V/A.md", kind: "note", label: "Alpha", path: "V/A.md", degree: 2 },
    { id: "V/B.md", kind: "note", label: "Beta", path: "V/B.md", degree: 1 },
    { id: "V/pic.png", kind: "attachment", label: "pic.png", path: "V/pic.png", degree: 0 },
    { id: "ghost:risks", kind: "ghost", label: "Risks", path: null, degree: 1 },
  ],
  edges: [
    { source: "V/A.md", target: "V/B.md", both: false },
    { source: "V/A.md", target: "ghost:risks", both: false },
  ],
};
const filter = { notes: true, attachments: false, tags: false, unresolved: true, orphans: true };

/// The page no longer subscribes to the index itself: the home page that holds it already has, to
/// decide whether a Graph section exists at all. This harness plays that part, so every assertion
/// below is about the page and none of them had to change.
function Subscribed({
  client,
  workspaceId,
  ...rest
}: Omit<GraphPageProps, "graph"> & { client: GraphClient; workspaceId: string }) {
  const graph = useVaultGraph(client, workspaceId);
  return <GraphPage {...rest} graph={graph} />;
}

function page(fake: ReturnType<typeof fakeGraphClient>, overrides = {}) {
  const props = {
    workspaceId: "V",
    workspaceName: "Research",
    client: fake.client,
    activePath: "V/B.md",
    filter,
    onFilterChange: vi.fn(),
    onOpenPath: vi.fn(),
    onCreateNote: vi.fn(),
    layout: instantLayout,
    Canvas: FakeCanvas,
    now: () => NOW,
    ...overrides,
  };
  render(<Subscribed {...props} />);
  return props;
}

const flush = () => act(async () => {});

describe("GraphPage", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the first build's progress once it has run a moment", async () => {
    const fake = fakeGraphClient({ snapshot: null, building: { workspaceId: "V", read: 1, total: 10, walking: false }, error: null });
    page(fake);
    await flush();
    expect(screen.queryByText("Indexing Research")).toBeNull();
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByText("Indexing Research")).toBeTruthy();
    expect(screen.getByText("1 of 10 files")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("10");
  });

  it("draws the graph with the filter applied and says how big and how fresh it is", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    page(fake);
    await flush();
    const canvas = screen.getByTestId("fake-canvas");
    expect(canvas.dataset.hidden).toBe("V/pic.png");
    expect(canvas.dataset.active).toBe("V/B.md");
    expect(canvas.getAttribute("aria-label")).toBe("Link graph of Research");
    expect(screen.getByText("2 notes - 2 links - indexed just now")).toBeTruthy();
  });

  it("toggles a chip through the settings, and shows each chip's state", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    const props = page(fake);
    await flush();
    const attachments = screen.getByRole("button", { name: "Attachments" });
    expect(attachments.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Notes" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(attachments);
    expect(props.onFilterChange).toHaveBeenCalledWith({ attachments: true });
  });

  it("highlights search matches and centres on the best one with Enter", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    page(fake);
    await flush();
    const search = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(search, { target: { value: "be" } });
    expect(screen.getByTestId("fake-canvas").dataset.highlighted).toBe("V/B.md");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByTestId("fake-canvas").dataset.focus).toBe("V/B.md");
  });

  it("asks again when Enter is pressed a second time on the same match", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    page(fake);
    await flush();
    const search = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(search, { target: { value: "be" } });
    fireEvent.keyDown(search, { key: "Enter" });
    const first = screen.getByTestId("fake-canvas").dataset.focusNonce;
    fireEvent.keyDown(search, { key: "Enter" });
    const canvas = screen.getByTestId("fake-canvas");
    expect(canvas.dataset.focus).toBe("V/B.md");
    expect(canvas.dataset.focusNonce).not.toBe(first);
  });

  it("neither highlights nor focuses a match the filters have hidden", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    page(fake);
    await flush();
    const search = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(search, { target: { value: "pic" } });
    expect(screen.getByTestId("fake-canvas").dataset.highlighted).toBe("");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByTestId("fake-canvas").dataset.focus).toBe("");
  });

  it("opens a note and offers to create a ghost's note on double-click", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    const props = page(fake);
    await flush();
    fireEvent.doubleClick(screen.getByRole("button", { name: "Alpha" }));
    expect(props.onOpenPath).toHaveBeenCalledWith("V/A.md");
    fireEvent.doubleClick(screen.getByRole("button", { name: "Risks" }));
    expect(props.onCreateNote).toHaveBeenCalledWith({ directory: "V/Inbox", name: "Risks" });
  });

  it("refreshes, keeps the old graph on screen, and disables refresh while building", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    page(fake);
    await flush();
    const refresh = screen.getByRole("button", { name: "Refresh graph" });
    await act(async () => fireEvent.click(refresh));
    expect(fake.refreshed).toEqual(["V"]);

    act(() => fake.pushProgress({ workspaceId: "V", read: 2, total: 4, walking: false }));
    expect((screen.getByRole("button", { name: "Refresh graph" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByTestId("fake-canvas")).toBeTruthy();
    expect(screen.getByText("Refreshing - 2 of 4 files - showing index from just now")).toBeTruthy();
  });

  // Inside the group it is announced as one of the filters, which it is not - it rebuilds the index
  // and changes nothing about what is shown.
  it("keeps refresh out of the group of filters", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    page(fake);
    await flush();
    const filters = screen.getByRole("group", { name: "Graph filters" });
    expect(within(filters).queryByRole("button", { name: "Refresh graph" })).toBeNull();
    expect(within(filters).getByRole("button", { name: "Notes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh graph" })).toBeTruthy();
  });

  it("says when a build failed", async () => {
    const fake = fakeGraphClient({ snapshot: null, building: null, error: "not-found" });
    page(fake);
    await flush();
    expect(screen.getByText("The graph could not be built. Refresh to try again.")).toBeTruthy();
  });

  it("says when a folder has no notes", async () => {
    const fake = fakeGraphClient({ snapshot: { ...snapshot, nodes: [], edges: [] }, building: null, error: null });
    page(fake);
    await flush();
    expect(screen.getByText("No notes in this folder yet")).toBeTruthy();
  });

  it("counts files it could not read", async () => {
    const fake = fakeGraphClient({ snapshot: { ...snapshot, unreadable: 3 }, building: null, error: null });
    page(fake);
    await flush();
    expect(screen.getByText((text) => text.includes("Files that could not be read: 3"))).toBeTruthy();
  });

  // The canvas is a chunk fetched when the tab first draws, and a fetch can fail. Without a floor
  // under it that throw unmounts the tab itself, so a graph nobody could draw takes the filters,
  // the search and the status line with it.
  it("keeps the tab when the canvas cannot be drawn at all", async () => {
    expectsConsoleError(/no canvas here/);
    expectsConsoleError(/error occurred in the/i);
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    page(fake, {
      Canvas: () => {
        throw new Error("no canvas here");
      },
    });
    await flush();
    expect(screen.getByText("The graph could not be drawn.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh graph" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search notes" })).toBeTruthy();
  });
});
