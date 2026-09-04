import {
  DiscardChoiceSchema,
  MenuActionMessage,
  WindowStateSchema,
  type DiscardChoice,
  type MenuAction,
  type MenuName,
  type WindowState,
} from "@trypthos/domain";

/// Window controls, and the state push that keeps the maximise button honest.
///
/// Separate from `workspaceClient` because the fallbacks differ in kind. A workspace call outside the
/// desktop shell is a failure worth telling the user about ("this needs the desktop app"); a window
/// control outside it is simply meaningless - the browser tab has its own chrome - so it does nothing
/// and says nothing.

export interface WindowControls {
  minimizeWindow(): Promise<unknown>;
  toggleMaximizeWindow(): Promise<unknown>;
  /// `force` says the unsaved-changes question has already been asked and answered. Without it the
  /// shell asks again, and the window never closes.
  closeWindow(force?: boolean): Promise<unknown>;
  /// Tells the shell whether the document has unsaved changes, so it knows whether a close is worth
  /// interrupting. The flag only - never what the document says.
  setDocumentDirty(dirty: boolean): Promise<unknown>;
  /// The shared native prompt for anything about to discard the document.
  confirmDiscard(): Promise<DiscardChoice>;
  /// Subscribes to the shell asking whether the window may close. Returns an unsubscribe function.
  onCloseRequested(listener: () => void): () => void;
  /// Subscribes to maximise/restore. Returns an unsubscribe function.
  onWindowState(listener: (state: WindowState) => void): () => void;
  /// Opens a native menu under a label the title bar drew.
  popupMenu(menu: MenuName, x: number, y: number): Promise<unknown>;
  /// Subscribes to menu items the renderer carries out. Returns an unsubscribe function.
  onMenuAction(listener: (action: MenuAction) => void): () => void;
}

interface WindowBridge {
  minimizeWindow?: () => Promise<unknown>;
  toggleMaximizeWindow?: () => Promise<unknown>;
  closeWindow?: (force: boolean) => Promise<unknown>;
  setDocumentDirty?: (dirty: boolean) => Promise<unknown>;
  confirmDiscard?: () => Promise<unknown>;
  onCloseRequested?: (listener: () => void) => () => void;
  onWindowState?: (listener: (state: unknown) => void) => () => void;
  popupMenu?: (menu: MenuName, x: number, y: number) => Promise<unknown>;
  onMenuAction?: (listener: (message: unknown) => void) => () => void;
}

const noop = async (): Promise<void> => {};

export const browserControls: WindowControls = {
  minimizeWindow: noop,
  toggleMaximizeWindow: noop,
  closeWindow: noop,
  setDocumentDirty: noop,
  // Nothing to close and nowhere to save, so there is no question to put. Cancel is the answer that
  // changes nothing, which is the right one when the prompt cannot be shown.
  confirmDiscard: async () => "cancel",
  onCloseRequested: () => () => {},
  onWindowState: () => () => {},
  // No shell, no native menus. The browser tab has its own chrome and its own right-click menu.
  popupMenu: noop,
  onMenuAction: () => () => {},
};

export function windowControls(): WindowControls {
  const bridge = (window as unknown as { trypthos?: WindowBridge }).trypthos;
  if (!bridge?.onWindowState) return browserControls;

  return {
    minimizeWindow: bridge.minimizeWindow ?? noop,
    toggleMaximizeWindow: bridge.toggleMaximizeWindow ?? noop,
    closeWindow: (force = false) => bridge.closeWindow?.(force) ?? noop(),
    setDocumentDirty: (dirty) => bridge.setDocumentDirty?.(dirty) ?? noop(),
    confirmDiscard: async () => {
      const answer = await bridge.confirmDiscard?.();
      // Validated on arrival, and anything unrecognised reads as cancel. This is the call that
      // decides whether somebody's document survives: proceeding on an answer nobody gave is how the
      // guard would destroy exactly the work it exists to protect.
      const parsed = DiscardChoiceSchema.safeParse(
        (answer as { choice?: unknown } | undefined)?.choice,
      );
      return parsed.success ? parsed.data : "cancel";
    },
    onCloseRequested: (listener) => bridge.onCloseRequested?.(listener) ?? (() => {}),
    popupMenu: bridge.popupMenu ?? noop,
    onMenuAction: (listener) =>
      bridge.onMenuAction?.((message) => {
        // Validated on arrival like every other push from main. Main is trusted; the schema is what
        // stops the two sides drifting silently into a menu item that quietly does nothing.
        const parsed = MenuActionMessage.safeParse(message);
        if (parsed.success) listener(parsed.data.action);
      }) ?? (() => {}),
    onWindowState: (listener) =>
      bridge.onWindowState!((raw) => {
        // Validated even though it came from the main process. Main is trusted, but the schema is
        // what stops the two sides drifting silently - a shape change would otherwise show up as a
        // button that quietly stops updating rather than as anything anyone notices.
        const parsed = WindowStateSchema.safeParse(raw);
        if (parsed.success) listener(parsed.data);
      }),
  };
}

/// The platform, as the shell reported it. Defaults to win32 in a browser tab so the title bar draws
/// its controls there and they can be seen while working on the interface.
export function currentPlatform(): "win32" | "darwin" | "linux" {
  const platform = (window as unknown as { trypthos?: { platform?: string } }).trypthos?.platform;
  if (platform === "darwin" || platform === "linux") return platform;
  return "win32";
}
