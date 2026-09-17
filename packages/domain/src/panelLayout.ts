/// How the three panels share the window's width.
///
/// Pure, and shared, because the answer has to be the same whoever asks: the renderer laying out, a
/// drag handle deciding where it can go, and a stored width being restored on a window narrower than
/// the one it was saved from.

export const PANEL_BOUNDS = {
  workspace: { min: 180, max: 480 },
  /// The chat can be most of the window: a long conversation is read, not glanced at. `max` is only
  /// a sanity bound on what a settings file can ask for - the real limit is the editor's floor, which
  /// `chatWidthLimit` answers for the window as it is.
  ///
  /// `shares` is the width up to which the chat and the workspace give way together in a narrow
  /// window. What the chat asks for beyond it is given back first, so widening the chat never costs
  /// the file list its width.
  chat: { min: 260, max: 4000, shares: 560 },
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
  /// The editor hidden, so the chat can take the room it leaves. Ignored while the chat is hidden,
  /// since something has to fill the window and the editor is the point of the app.
  editorCollapsed?: boolean;
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

  if (request.editorCollapsed === true && !request.chatCollapsed) {
    return withoutEditor(request, available);
  }

  const wanted = {
    workspace: request.workspaceCollapsed
      ? 0
      : clamp(request.workspace, PANEL_BOUNDS.workspace.min, PANEL_BOUNDS.workspace.max),
    chat: request.chatCollapsed
      ? 0
      : clamp(request.chat, PANEL_BOUNDS.chat.min, PANEL_BOUNDS.chat.max),
  };

  // Width beyond what the chat shares with the workspace comes out of the editor's spare room, and
  // is the first thing to go when there is none.
  if (wanted.chat > PANEL_BOUNDS.chat.shares) {
    const room = available - wanted.workspace - PANEL_BOUNDS.editorMin;
    wanted.chat = Math.max(PANEL_BOUNDS.chat.shares, Math.min(wanted.chat, room));
  }

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

/// The chat with the editor hidden: it takes everything the workspace does not.
///
/// The workspace keeps its width while the chat still gets its minimum, then narrows, then goes -
/// the reverse of the usual order, because with the editor hidden the chat is the thing being read.
function withoutEditor(request: PanelRequest, available: number): PanelWidths {
  let workspace = request.workspaceCollapsed
    ? 0
    : clamp(request.workspace, PANEL_BOUNDS.workspace.min, PANEL_BOUNDS.workspace.max);

  if (available - workspace < PANEL_BOUNDS.chat.min) {
    const squeezed = available - PANEL_BOUNDS.chat.min;
    workspace = workspace > 0 && squeezed >= PANEL_BOUNDS.workspace.min ? squeezed : 0;
  }

  return { workspace, chat: available - workspace, editor: 0 };
}

/// The widest the chat's divider will drag to in this window: up to the editor's floor.
///
/// Never below the chat's minimum, which would make a divider that can only be dragged the wrong way.
export function chatWidthLimit({ available, workspace }: { available: number; workspace: number }): number {
  const room = Math.round(available - workspace - PANEL_BOUNDS.editorMin);
  return Math.min(PANEL_BOUNDS.chat.max, Math.max(PANEL_BOUNDS.chat.min, room));
}
