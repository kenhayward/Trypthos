import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useExplorerIntegration } from "./useExplorerIntegration";
import type { IntegrationBridge } from "../lib/workspaceClient";

/// The Explorer switch's half of the shell.
///
/// The registry is the record, so nothing here remembers what it asked for: every answer comes back
/// from the shell reading the keys, which is the only thing that can be true after a user has taken
/// them away by hand.

function fakeBridge(over: { supported?: boolean; registered?: boolean } = {}) {
  const asked: boolean[] = [];
  let registered = over.registered ?? false;
  const supported = over.supported ?? true;

  const bridge: IntegrationBridge = {
    status: async () => ({ ok: true, supported, registered }),
    set: async (enabled) => {
      asked.push(enabled);
      if (supported) registered = enabled;
      return { ok: true, supported, registered };
    },
  };
  return { bridge, asked };
}

describe("useExplorerIntegration", () => {
  it("asks the shell what is registered rather than assuming", async () => {
    const { bridge } = fakeBridge({ registered: true });
    const { result } = renderHook(() => useExplorerIntegration(bridge));

    await waitFor(() => expect(result.current.registered).toBe(true));
    expect(result.current.supported).toBe(true);
  });

  it("adds the entries when it is switched on", async () => {
    const { bridge, asked } = fakeBridge({ registered: false });
    const { result } = renderHook(() => useExplorerIntegration(bridge));

    await waitFor(() => expect(result.current.supported).toBe(true));
    await act(async () => {
      await result.current.set(true);
    });

    expect(asked).toEqual([true]);
    expect(result.current.registered).toBe(true);
  });

  it("takes them away when it is switched off", async () => {
    const { bridge, asked } = fakeBridge({ registered: true });
    const { result } = renderHook(() => useExplorerIntegration(bridge));

    await waitFor(() => expect(result.current.registered).toBe(true));
    await act(async () => {
      await result.current.set(false);
    });

    expect(asked).toEqual([false]);
    expect(result.current.registered).toBe(false);
  });

  // Everywhere but a packaged Windows build. The switch is not drawn at all there, so the answer has
  // to be a state rather than a failed call.
  it("reports that there is nothing to register", async () => {
    const { bridge } = fakeBridge({ supported: false });
    const { result } = renderHook(() => useExplorerIntegration(bridge));

    await waitFor(() => expect(result.current.checked).toBe(true));
    expect(result.current.supported).toBe(false);
    expect(result.current.registered).toBe(false);
  });

  // The browser preview has no shell at all. Null rather than a stub, so the switch is absent rather
  // than present and lying.
  it("is unsupported with no shell behind it", async () => {
    const { result } = renderHook(() => useExplorerIntegration(null));

    await waitFor(() => expect(result.current.checked).toBe(true));
    expect(result.current.supported).toBe(false);
  });
});
