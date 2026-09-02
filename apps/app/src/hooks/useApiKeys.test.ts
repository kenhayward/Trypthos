import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useApiKeys, type KeyBridge } from "./useApiKeys";

const ENDPOINT = "https://api.example.com/v1";
const KEY = "sk-test-do-not-use-90210";

function fakeBridge(stored: string[] = []) {
  const endpoints = new Set(stored);
  const bridge: KeyBridge = {
    listKeyedEndpoints: vi.fn(async () => ({ ok: true as const, endpoints: [...endpoints] })),
    setApiKey: vi.fn(async (endpoint: string) => {
      endpoints.add(endpoint);
      return { ok: true as const };
    }),
    deleteApiKey: vi.fn(async (endpoint: string) => {
      endpoints.delete(endpoint);
    }),
  };
  return { bridge, endpoints };
}

describe("useApiKeys", () => {
  it("asks the shell which endpoints have a key", async () => {
    const { bridge } = fakeBridge([ENDPOINT]);
    const { result } = renderHook(() => useApiKeys(bridge, [ENDPOINT]));

    await waitFor(() => expect(result.current.keyedEndpoints).toEqual([ENDPOINT]));
  });

  // Otherwise the field still says "No key stored" against a key that was just saved, and the user
  // saves it again.
  it("refreshes after a key is stored, so the interface catches up", async () => {
    const { bridge } = fakeBridge();
    const { result } = renderHook(() => useApiKeys(bridge, [ENDPOINT]));
    await waitFor(() => expect(result.current.keyedEndpoints).toEqual([]));

    await act(async () => {
      await result.current.saveKey(ENDPOINT, KEY);
    });

    expect(result.current.keyedEndpoints).toEqual([ENDPOINT]);
  });

  it("refreshes after a key is removed", async () => {
    const { bridge } = fakeBridge([ENDPOINT]);
    const { result } = renderHook(() => useApiKeys(bridge, [ENDPOINT]));
    await waitFor(() => expect(result.current.keyedEndpoints).toEqual([ENDPOINT]));

    await act(async () => {
      await result.current.deleteKey(ENDPOINT);
    });

    expect(result.current.keyedEndpoints).toEqual([]);
  });

  it("does not claim a key is stored when storing it failed", async () => {
    const { bridge } = fakeBridge();
    bridge.setApiKey = vi.fn(async () => ({
      ok: false as const,
      reason: "encryption-unavailable",
    }));
    const { result } = renderHook(() => useApiKeys(bridge, [ENDPOINT]));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveKey(ENDPOINT, KEY);
    });

    expect(outcome).toEqual({ ok: false, reason: "encryption-unavailable" });
    expect(result.current.keyedEndpoints).toEqual([]);
  });

  // The shell sweeps keys for endpoints no profile uses when settings are saved. Without this, the
  // interface would keep showing "Key stored" for a profile the user had just repointed.
  it("re-checks when the configured endpoints change", async () => {
    const { bridge } = fakeBridge([ENDPOINT]);
    const { result, rerender } = renderHook(
      ({ endpoints }: { endpoints: string[] }) => useApiKeys(bridge, endpoints),
      { initialProps: { endpoints: [ENDPOINT] } },
    );
    await waitFor(() => expect(result.current.keyedEndpoints).toEqual([ENDPOINT]));

    rerender({ endpoints: ["https://other.example.com/v1"] });
    await waitFor(() => expect(bridge.listKeyedEndpoints).toHaveBeenCalledTimes(2));
  });

  // The same list in a different order is the same list. Without a stable comparison this would
  // re-read on every render, and every read would set state and cause another render.
  it("does not re-check when the endpoints are merely reordered", async () => {
    const { bridge } = fakeBridge();
    const { rerender } = renderHook(
      ({ endpoints }: { endpoints: string[] }) => useApiKeys(bridge, endpoints),
      { initialProps: { endpoints: ["https://a.example.com/v1", "https://b.example.com/v1"] } },
    );
    await waitFor(() => expect(bridge.listKeyedEndpoints).toHaveBeenCalledTimes(1));

    rerender({ endpoints: ["https://b.example.com/v1", "https://a.example.com/v1"] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridge.listKeyedEndpoints).toHaveBeenCalledTimes(1);
  });

  // The browser preview. Nothing can be stored, and pretending otherwise would show "Key stored"
  // against a key that went nowhere.
  it("stores nothing and claims nothing without a shell", async () => {
    const { result } = renderHook(() => useApiKeys(null, [ENDPOINT]));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveKey(ENDPOINT, KEY);
    });

    expect(outcome).toEqual({ ok: false, reason: "not-desktop" });
    expect(result.current.keyedEndpoints).toEqual([]);
  });
});
