/// How the three panels share the window's width.
///
/// Pure, and shared, because the answer has to be the same whoever asks: the renderer laying out, a
/// drag handle deciding where it can go, and a stored width being restored on a window narrower than
/// the one it was saved from.

export const PANEL_BOUNDS = {
  workspace: { min: 180, max: 480 },
  chat: { min: 260, max: 560 },
  /// The editor is the point of the app, so it has a floor and the side panels do not defend theirs
  /// against it.
  editorMin: 320,
} as const;

export interface PanelRequest {
  /// Width available to all three panels together.
  available: number;
  workspace: number;
  chat: number;
  workspaceCollapsed: boolean;
  chatCollapsed: boolean;
}

export interface PanelWidths {
  workspace: number;
  chat: number;
  editor: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max));
}

/// Resolves requested widths against the window actually available.
///
/// The order of yielding is deliberate. A window can be narrower than the panels want - restored on a
/// smaller screen, or simply dragged in - and something has to give. It is never the editor: a
/// person can work with a cramped file list, and cannot work in a cramped document.
///
/// Below the point where even the minimums fit, the panels collapse to nothing rather than the editor
/// being squeezed out of existence. That is not a state anyone chose; it is the honest answer to a
/// window too small for the layout.
export function resolvePanelWidths(request: PanelRequest): PanelWidths {
  const available = Math.max(0, Math.round(request.available));

  const wanted = {
    workspace: request.workspaceCollapsed
      ? 0
      : clamp(request.workspace, PANEL_BOUNDS.workspace.min, PANEL_BOUNDS.workspace.max),
    chat: request.chatCollapsed
      ? 0
      : clamp(request.chat, PANEL_BOUNDS.chat.min, PANEL_BOUNDS.chat.max),
  };

  const spare = available - wanted.workspace - wanted.chat;
  if (spare >= PANEL_BOUNDS.editorMin) {
    return { ...wanted, editor: available - wanted.workspace - wanted.chat };
  }

  // Shrink the open panels towards their minimums, proportionally, so neither collapses while the
  // other keeps its full width.
  const floors = {
    workspace: wanted.workspace === 0 ? 0 : PANEL_BOUNDS.workspace.min,
    chat: wanted.chat === 0 ? 0 : PANEL_BOUNDS.chat.min,
  };

  if (available - floors.workspace - floors.chat >= PANEL_BOUNDS.editorMin) {
    const shrinkable = wanted.workspace + wanted.chat - floors.workspace - floors.chat;
    const excess = PANEL_BOUNDS.editorMin - spare;
    const ratio = shrinkable === 0 ? 0 : Math.min(1, excess / shrinkable);

    const workspace = Math.round(
      wanted.workspace - (wanted.workspace - floors.workspace) * ratio,
    );
    const chat = Math.round(wanted.chat - (wanted.chat - floors.chat) * ratio);
    return { workspace, chat, editor: available - workspace - chat };
  }

  return { workspace: 0, chat: 0, editor: available };
}
