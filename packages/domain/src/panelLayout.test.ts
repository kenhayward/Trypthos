import { describe, expect, it } from "vitest";
import { PANEL_BOUNDS, resolvePanelWidths } from "./panelLayout";

const wide = 1400;

describe("resolvePanelWidths", () => {
  it("uses the requested widths when there is room", () => {
    const layout = resolvePanelWidths({
      available: wide,
      workspace: 268,
      chat: 348,
      workspaceCollapsed: false,
      chatCollapsed: false,
    });
    expect(layout).toEqual({ workspace: 268, chat: 348, editor: wide - 268 - 348 });
  });

  it("gives a collapsed panel no width at all", () => {
    const layout = resolvePanelWidths({
      available: wide,
      workspace: 268,
      chat: 348,
      workspaceCollapsed: true,
      chatCollapsed: false,
    });
    expect(layout.workspace).toBe(0);
    expect(layout.editor).toBe(wide - 348);
  });

  it("clamps a width to the panel's own bounds", () => {
    const tooNarrow = resolvePanelWidths({
      available: wide,
      workspace: 40,
      chat: 348,
      workspaceCollapsed: false,
      chatCollapsed: false,
    });
    expect(tooNarrow.workspace).toBe(PANEL_BOUNDS.workspace.min);

    const tooWide = resolvePanelWidths({
      available: wide,
      workspace: 5000,
      chat: 348,
      workspaceCollapsed: false,
      chatCollapsed: false,
    });
    expect(tooWide.workspace).toBe(PANEL_BOUNDS.workspace.max);
  });

  // The editor is the point of the app. When the window is too narrow for everything, the side
  // panels give up their space - the editor never shrinks below what a line of text needs.
  it("takes space from the side panels before the editor, in a narrow window", () => {
    const layout = resolvePanelWidths({
      available: 800,
      workspace: 268,
      chat: 348,
      workspaceCollapsed: false,
      chatCollapsed: false,
    });

    expect(layout.editor).toBeGreaterThanOrEqual(PANEL_BOUNDS.editorMin);
    expect(layout.workspace).toBeLessThan(268);
    expect(layout.chat).toBeLessThan(348);
    expect(layout.workspace + layout.chat + layout.editor).toBe(800);
  });

  // Below a certain width there is no honest answer: the editor minimum plus two panel minimums does
  // not fit. Panels collapse to nothing rather than the editor being squeezed out of existence.
  it("collapses the panels entirely when even their minimums do not fit", () => {
    const layout = resolvePanelWidths({
      available: 380,
      workspace: 268,
      chat: 348,
      workspaceCollapsed: false,
      chatCollapsed: false,
    });

    expect(layout.workspace).toBe(0);
    expect(layout.chat).toBe(0);
    expect(layout.editor).toBe(380);
  });

  it("never returns a negative or fractional width", () => {
    for (const available of [0, 1, 200, 617, 801, 1399]) {
      const layout = resolvePanelWidths({
        available,
        workspace: 268,
        chat: 348,
        workspaceCollapsed: false,
        chatCollapsed: false,
      });
      for (const value of Object.values(layout)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(value)).toBe(true);
      }
      expect(layout.workspace + layout.chat + layout.editor).toBe(available);
    }
  });
});
