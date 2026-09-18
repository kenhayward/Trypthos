import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphSnapshot } from "@trypthos/domain";
import { fakeGraphClient } from "../testing/fakeGraphClient";
import type { LocalGraphProps } from "./LocalGraph";
import LocalGraphPane from "./LocalGraphPane";

const snapshot: GraphSnapshot = {
  workspaceId: "V",
  builtAt: "2026-09-17T10:00:00.000Z",
  unreadable: 0,
  truncated: false,
  newNotes: { mode: "root" },
  nodes: [{ id: "V/A.md", kind: "note", label: "Alpha", path: "V/A.md", degree: 0 }],
  edges: [],
};

function FakeBody(props: LocalGraphProps) {
  return <div data-testid="local-body" data-centre={props.centre} data-depth={props.depth} />;
}

function pane(fake: ReturnType<typeof fakeGraphClient>, overrides = {}) {
  const props = {
    client: fake.client,
    workspaceId: "V" as string | null,
    activePath: "V/A.md" as string | null,
    filter: { notes: true, attachments: false, tags: false, unresolved: true, orphans: true },
    depth: 1,
    collapsed: false,
    onDepthChange: vi.fn(),
    onCollapsedChange: vi.fn(),
    onOpenPath: vi.fn(),
    onCreateNote: vi.fn(),
    Body: FakeBody,
    ...overrides,
  };
  render(<LocalGraphPane {...props} />);
  return props;
}

describe("LocalGraphPane", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the active note's graph", async () => {
    pane(fakeGraphClient({ snapshot, building: null, error: null }));
    await act(async () => {});
    expect(screen.getByRole("region", { name: "Local graph" })).toBeTruthy();
    expect(screen.getByTestId("local-body").dataset.centre).toBe("V/A.md");
  });

  // Any local folder has a graph now, so the pane asks for a note - not a note in a vault.
  it("asks for a note when the active tab is not one", async () => {
    pane(fakeGraphClient({ snapshot, building: null, error: null }), { workspaceId: null, activePath: "trypthos:home/V" });
    await act(async () => {});
    expect(screen.getByText("Open a note to see its links")).toBeTruthy();
    expect(screen.queryByTestId("local-body")).toBeNull();
  });

  it("asks the same for a note the graph does not have", async () => {
    pane(fakeGraphClient({ snapshot, building: null, error: null }), { activePath: "V/Other.md" });
    await act(async () => {});
    expect(screen.getByText("Open a note to see its links")).toBeTruthy();
  });

  it("changes depth and collapses through its settings", async () => {
    const props = pane(fakeGraphClient({ snapshot, building: null, error: null }));
    await act(async () => {});
    fireEvent.change(screen.getByRole("combobox", { name: "Depth" }), { target: { value: "3" } });
    expect(props.onDepthChange).toHaveBeenCalledWith(3);
    const collapse = screen.getByRole("button", { name: "Collapse local graph" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(collapse.querySelector("svg")).not.toBeNull();
    fireEvent.click(collapse);
    expect(props.onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("shows only its header when collapsed", async () => {
    pane(fakeGraphClient({ snapshot, building: null, error: null }), { collapsed: true });
    await act(async () => {});
    expect(screen.queryByTestId("local-body")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand local graph" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows indexing progress under its header, even collapsed", async () => {
    const fake = fakeGraphClient({ snapshot: null, building: { workspaceId: "V", read: 1, total: 3, walking: false }, error: null });
    pane(fake, { collapsed: true });
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
  });

  it("says how far indexing has got when there is no graph yet", async () => {
    const fake = fakeGraphClient({ snapshot: null, building: { workspaceId: "V", read: 1, total: 3, walking: false }, error: null });
    pane(fake);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByText("Indexing - 33%")).toBeTruthy();
  });
});
