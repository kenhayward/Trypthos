import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGoogle } from "./useGoogle";
import type { GoogleBridge, GoogleConnectResult } from "../lib/workspaceClient";

/// The Google account, from the interface's side: which of not configured, checking, connected,
/// waiting for the browser and "that did not work" the section is in.

function fakeBridge(overrides: Partial<GoogleBridge> = {}) {
  return {
    googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: false, email: null, reason: null })),
    connectGoogle: vi.fn(async (): Promise<GoogleConnectResult> => ({ ok: true, email: "ada@example.com" })),
    cancelGoogleConnect: vi.fn(async () => ({ ok: true })),
    disconnectGoogle: vi.fn(async () => ({ ok: true })),
    listDriveFolders: vi.fn(async () => ({ ok: true as const, folders: [] })),
    ...overrides,
  } satisfies GoogleBridge;
}

describe("useGoogle", () => {
  it("asks the shell whether an account is connected", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: true, email: "ada@example.com", reason: null })),
    });
    const { result } = renderHook(() => useGoogle(bridge));

    await waitFor(() => expect(result.current.email).toBe("ada@example.com"));
    expect(result.current.connected).toBe(true);
    expect(result.current.configured).toBe(true);
  });

  it("reports no shell as unsupported", async () => {
    const { result } = renderHook(() => useGoogle(null));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.supported).toBe(false);
  });

  it("reports a build without a Google client as not configured", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: false, connected: false, email: null, reason: null })),
    });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.configured).toBe(false);
  });

  it("is connecting while the browser is open, then connected", async () => {
    let finish: (value: GoogleConnectResult) => void = () => {};
    const bridge = fakeBridge({ connectGoogle: vi.fn(() => new Promise<GoogleConnectResult>((resolve) => (finish = resolve))) });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    let connected: Promise<boolean> = Promise.resolve(false);
    act(() => {
      connected = result.current.connect();
    });
    expect(result.current.connecting).toBe(true);

    await act(async () => {
      finish({ ok: true, email: "ada@example.com" });
      await connected;
    });
    expect(result.current.connecting).toBe(false);
    expect(result.current.connected).toBe(true);
    expect(result.current.email).toBe("ada@example.com");
  });

  // Closing the browser or pressing Cancel is not a failure and must not raise a banner.
  it("returns to idle without an error when the sign-in is cancelled", async () => {
    const bridge = fakeBridge({ connectGoogle: vi.fn(async () => ({ ok: false as const, reason: "cancelled" })) });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.connecting).toBe(false);
    expect(result.current.connected).toBe(false);
    expect(result.current.errorKey).toBeNull();
  });

  it("names a refused sign-in", async () => {
    const bridge = fakeBridge({ connectGoogle: vi.fn(async () => ({ ok: false as const, reason: "scope-denied" })) });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.errorKey).toBe("errors.scopeDenied");
  });

  it("cancel asks the shell to stop waiting", async () => {
    const bridge = fakeBridge();
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));

    await act(async () => {
      await result.current.cancel();
    });
    expect(bridge.cancelGoogleConnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: true, email: "ada@example.com", reason: null })),
    });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.connected).toBe(true));

    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.email).toBeNull();
  });

  it("shows a stored grant Google refused as disconnected with the reason", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: false, email: null, reason: "not-connected" })),
    });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.errorKey).toBe("errors.googleNotConnected");
  });

  it("keeps the account connected and says why when Google cannot be told to disconnect", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: true, email: "ada@example.com", reason: null })),
      disconnectGoogle: vi.fn(async () => ({ ok: false as const, reason: "unknown" })),
    });
    const { result } = renderHook(() => useGoogle(bridge));
    await waitFor(() => expect(result.current.connected).toBe(true));

    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.errorKey).toBe("errors.unknown");
    expect(result.current.connected).toBe(true);
    expect(result.current.email).toBe("ada@example.com");
  });
});
