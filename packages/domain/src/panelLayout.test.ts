import { describe, expect, it } from "vitest";
import { PANEL_BOUNDS, chatWidthLimit, resolvePanelWidths } from "./panelLayout";

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

  // A long conversation is read, not glanced at, and a third of the window is not enough to read it
  // in. The chat can be as wide as the window leaves it once the editor has its floor.
  it("lets the chat be much wider than it once could", () => {
    const layout = resolvePanelWidths({
      available: wide,
      workspace: 268,
      chat: 800,
      workspaceCollapsed: false,
      chatCollapsed: false,
    });
    expect(layout).toEqual({ workspace: 268, chat: 800, editor: wide - 268 - 800 });
  });

  // A wide chat is taken from the editor, and never past the editor's floor. What it asks for beyond
  // that is given back first - the file list does not shrink to pay for it.
  it("gives back a wide chat's extra width before touching the workspace", () => {
    const layout = resolvePanelWidths({
      available: wide,
      workspace: 268,
      chat: 1300,
      workspaceCollapsed: false,
      chatCollapsed: false,
    });
    expect(layout).toEqual({
      workspace: 268,
      chat: wide - 268 - PANEL_BOUNDS.editorMin,
      editor: PANEL_BOUNDS.editorMin,
    });
  });

  describe("with the editor hidden", () => {
    it("gives the chat everything the workspace does not use", () => {
      const layout = resolvePanelWidths({
        available: wide,
        workspace: 268,
        chat: 348,
        workspaceCollapsed: false,
        chatCollapsed: false,
        editorCollapsed: true,
      });
      expect(layout).toEqual({ workspace: 268, chat: wide - 268, editor: 0 });
    });

    it("gives the chat the whole window when the workspace is hidden too", () => {
      const layout = resolvePanelWidths({
        available: wide,
        workspace: 268,
        chat: 348,
        workspaceCollapsed: true,
        chatCollapsed: false,
        editorCollapsed: true,
      });
      expect(layout).toEqual({ workspace: 0, chat: wide, editor: 0 });
    });

    // Something has to fill the window. With the chat hidden as well, that is the editor, whatever
    // was remembered about it.
    it("shows the editor anyway when the chat is hidden", () => {
      const layout = resolvePanelWidths({
        available: wide,
        workspace: 268,
        chat: 348,
        workspaceCollapsed: false,
        chatCollapsed: true,
        editorCollapsed: true,
      });
      expect(layout).toEqual({ workspace: 268, chat: 0, editor: wide - 268 });
    });

    it("keeps the chat readable in a narrow window, at the workspace's expense", () => {
      const narrow = resolvePanelWidths({
        available: 500,
        workspace: 268,
        chat: 348,
        workspaceCollapsed: false,
        chatCollapsed: false,
        editorCollapsed: true,
      });
      expect(narrow).toEqual({ workspace: 500 - PANEL_BOUNDS.chat.min, chat: PANEL_BOUNDS.chat.min, editor: 0 });

      const tiny = resolvePanelWidths({
        available: 400,
        workspace: 268,
        chat: 348,
        workspaceCollapsed: false,
        chatCollapsed: false,
        editorCollapsed: true,
      });
      expect(tiny).toEqual({ workspace: 0, chat: 400, editor: 0 });
    });
  });

  it("never returns a negative or fractional width with the editor hidden", () => {
    for (const available of [0, 1, 200, 439, 617, 801, 1399]) {
      const layout = resolvePanelWidths({
        available,
        workspace: 268,
        chat: 348,
        workspaceCollapsed: false,
        chatCollapsed: false,
        editorCollapsed: true,
      });
      for (const value of Object.values(layout)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(value)).toBe(true);
      }
      expect(layout.workspace + layout.chat + layout.editor).toBe(available);
    }
  });
});

describe("chatWidthLimit", () => {
  // The furthest the chat's divider goes: to the editor's floor, and no further.
  it("stops where the editor would drop below its floor", () => {
    expect(chatWidthLimit({ available: wide, workspace: 268 })).toBe(wide - 268 - PANEL_BOUNDS.editorMin);
    expect(chatWidthLimit({ available: wide, workspace: 0 })).toBe(wide - PANEL_BOUNDS.editorMin);
  });

  // A limit below the minimum would be a divider that can only be dragged the wrong way.
  it("is never below the chat's own minimum", () => {
    expect(chatWidthLimit({ available: 500, workspace: 268 })).toBe(PANEL_BOUNDS.chat.min);
  });
});
