import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GraphSnapshot } from "@trypthos/domain";
import { expectsConsoleError } from "../test-setup";
import { FakeCanvas, instantLayout } from "../testing/fakeGraphClient";
import LocalGraph from "./LocalGraph";

const snapshot: GraphSnapshot = {
  workspaceId: "V",
  builtAt: "2026-09-17T10:00:00.000Z",
  unreadable: 0,
  newNotes: { mode: "root" },
  nodes: [
    { id: "V/A.md", kind: "note", label: "Alpha", path: "V/A.md", degree: 2 },
    { id: "V/B.md", kind: "note", label: "Beta", path: "V/B.md", degree: 2 },
    { id: "V/C.md", kind: "note", label: "Gamma", path: "V/C.md", degree: 1 },
    { id: "V/Lonely.md", kind: "note", label: "Lonely", path: "V/Lonely.md", degree: 0 },
  ],
  edges: [
    { source: "V/A.md", target: "V/B.md", both: false },
    { source: "V/B.md", target: "V/C.md", both: false },
  ],
};
const filter = { notes: true, attachments: false, tags: false, unresolved: true, orphans: false };

function show(overrides = {}) {
  const props = {
    snapshot,
    centre: "V/A.md",
    depth: 1,
    filter,
    onOpenPath: vi.fn(),
    onCreateNote: vi.fn(),
    layout: instantLayout,
    Canvas: FakeCanvas,
    ...overrides,
  };
  render(<LocalGraph {...props} />);
  return props;
}

describe("LocalGraph", () => {
  it("draws the centre note's neighbourhood to the depth chosen, compactly", async () => {
    show();
    await act(async () => {});
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Alpha", "Beta"]);
    expect(screen.getByTestId("fake-canvas").dataset.compact).toBe("true");
    expect(screen.getByTestId("fake-canvas").dataset.active).toBe("V/A.md");
  });

  it("goes further at a greater depth", async () => {
    show({ depth: 2 });
    await act(async () => {});
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("never hides the centre note, even as an orphan", async () => {
    show({ centre: "V/Lonely.md" });
    await act(async () => {});
    expect(screen.getByTestId("fake-canvas").dataset.hidden).toBe("");
  });

  it("opens a neighbour on double-click", async () => {
    const props = show();
    await act(async () => {});
    fireEvent.doubleClick(screen.getByRole("button", { name: "Beta" }));
    expect(props.onOpenPath).toHaveBeenCalledWith("V/B.md");
  });

  // The pane sits under the folder trees, so a canvas chunk that would not load takes the whole
  // left panel with it unless something catches the throw here.
  it("says so rather than throwing when the canvas cannot be drawn at all", async () => {
    expectsConsoleError(/no canvas here/);
    expectsConsoleError(/error occurred in the/i);
    show({
      Canvas: () => {
        throw new Error("no canvas here");
      },
    });
    await act(async () => {});
    expect(screen.getByText("The graph could not be drawn.")).toBeTruthy();
  });
});
