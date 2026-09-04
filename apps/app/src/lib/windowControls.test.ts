import { afterEach, describe, expect, it, vi } from "vitest";
import { browserControls, windowControls } from "./windowControls";

/// The renderer's half of the unsaved-changes guard.
///
/// The interesting part is what happens when the shell answers something unexpected: this decides
/// whether somebody's document survives, so anything it does not recognise has to mean "do nothing".

function shell(over: Record<string, unknown> = {}) {
  const bridge = {
    onWindowState: () => () => {},
    closeWindow: vi.fn(async () => ({ ok: true })),
    setDocumentDirty: vi.fn(async () => ({ ok: true })),
    confirmDiscard: vi.fn(async () => ({ ok: true, choice: "save" })),
    onCloseRequested: (listener: () => void) => {
      listeners.push(listener);
      return () => {};
    },
    ...over,
  };
  (window as unknown as { trypthos?: unknown }).trypthos = bridge;
  return bridge;
}

const listeners: (() => void)[] = [];

afterEach(() => {
  delete (window as unknown as { trypthos?: unknown }).trypthos;
  listeners.length = 0;
});

describe("windowControls without a shell", () => {
  // The browser preview has no window to close and nothing to save to, so the guard is not a
  // question there. Cancel is the answer that changes nothing.
  it("cancels a discard prompt it cannot show", async () => {
    expect(await browserControls.confirmDiscard()).toBe("cancel");
  });

  it("reports a dirty document to nobody, without failing", async () => {
    await expect(browserControls.setDocumentDirty(true)).resolves.toBeUndefined();
  });
});

describe("windowControls with a shell", () => {
  it("passes the user's choice through", async () => {
    shell();
    expect(await windowControls().confirmDiscard()).toBe("save");
  });

  // The one that decides whether a file survives. A shape this build does not recognise must read as
  // cancel: proceeding on an answer nobody gave is how the guard would destroy the work it protects.
  it("treats an answer it does not recognise as cancel", async () => {
    shell({ confirmDiscard: async () => ({ ok: true, choice: "burn-it" }) });
    expect(await windowControls().confirmDiscard()).toBe("cancel");
  });

  it("treats a failed prompt as cancel", async () => {
    shell({ confirmDiscard: async () => ({ ok: false, reason: "no-window" }) });
    expect(await windowControls().confirmDiscard()).toBe("cancel");
  });

  it("tells the shell when the document becomes dirty", async () => {
    const bridge = shell();
    await windowControls().setDocumentDirty(true);

    expect(bridge.setDocumentDirty).toHaveBeenCalledWith(true);
  });

  // Force is how the renderer says "I have asked, go ahead" - without it the shell would ask again.
  it("forces the close it performs after asking", async () => {
    const bridge = shell();
    await windowControls().closeWindow(true);

    expect(bridge.closeWindow).toHaveBeenCalledWith(true);
  });

  it("does not force an ordinary close", async () => {
    const bridge = shell();
    await windowControls().closeWindow();

    expect(bridge.closeWindow).toHaveBeenCalledWith(false);
  });

  it("subscribes to the shell asking whether it may close", () => {
    shell();
    const heard: number[] = [];
    windowControls().onCloseRequested(() => heard.push(1));

    listeners.forEach((listener) => listener());
    expect(heard).toEqual([1]);
  });
});
