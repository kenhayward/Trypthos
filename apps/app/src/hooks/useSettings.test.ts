import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@trypthos/domain";
import { useSettings, type SettingsBridge } from "./useSettings";

const stored: Settings = {
  ...DEFAULT_SETTINGS,
  lastWorkspace: "D:/Notes",
  panels: { ...DEFAULT_SETTINGS.panels, workspaceWidth: 300 },
};

function bridge(overrides: Partial<SettingsBridge> = {}) {
  const writes: Settings[] = [];
  const value: SettingsBridge = {
    readSettings: async () => ({ ok: true, settings: stored }),
    writeSettings: async (settings) => {
      writes.push(settings);
    },
    ...overrides,
  };
  return { bridge: value, writes };
}

/// waitFor polls on real timers, which fake timers replace - so it can never resolve here. The read
/// resolves on a microtask, so flushing with act is both correct and immediate.
async function flush() {
  await act(async () => {});
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSettings", () => {
  it("reads what is stored", async () => {
    const { bridge: b } = bridge();
    const { result } = renderHook(() => useSettings(b));

    await flush();
    expect(result.current.loaded).toBe(true);
    expect(result.current.settings.lastWorkspace).toBe("D:/Notes");
  });

  // Until the file has been read the state is DEFAULTS, not what is stored. Writing then would
  // overwrite a real settings file with defaults on every single launch.
  it("writes nothing before the stored file has been read", async () => {
    let release: ((value: { ok: true; settings: Settings }) => void) | null = null;
    const { bridge: b, writes } = bridge({
      readSettings: () => new Promise((resolve) => (release = resolve)),
    });

    renderHook(() => useSettings(b));
    act(() => void vi.advanceTimersByTime(5000));
    expect(writes).toEqual([]);

    await act(async () => {
      release?.({ ok: true, settings: stored });
    });
  });

  it("writes once the change settles, not on every change", async () => {
    const { bridge: b, writes } = bridge();
    const { result } = renderHook(() => useSettings(b));
    await flush();
    expect(result.current.loaded).toBe(true);

    // A drag produces a change per pointer move.
    act(() => {
      for (let width = 300; width <= 320; width += 1) {
        result.current.updatePanels({ workspaceWidth: width });
      }
    });
    expect(writes).toEqual([]);

    act(() => void vi.advanceTimersByTime(500));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.panels.workspaceWidth).toBe(320);
  });

  it("merges a panel change rather than replacing the whole block", async () => {
    const { bridge: b } = bridge();
    const { result } = renderHook(() => useSettings(b));
    await flush();
    expect(result.current.loaded).toBe(true);

    act(() => result.current.updatePanels({ chatCollapsed: true }));

    expect(result.current.settings.panels.chatCollapsed).toBe(true);
    expect(result.current.settings.panels.workspaceWidth).toBe(300);
  });

  // The browser preview has no shell. Defaults, and nothing is written anywhere.
  it("uses defaults and writes nothing without a shell", async () => {
    const { result } = renderHook(() => useSettings(null));

    await flush();
    expect(result.current.loaded).toBe(true);
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);

    act(() => result.current.updatePanels({ workspaceWidth: 400 }));
    act(() => void vi.advanceTimersByTime(5000));
    // Nothing to assert against but the absence of a crash: there is no bridge to have written to.
    expect(result.current.settings.panels.workspaceWidth).toBe(400);
  });

  it("falls back to defaults when the stored file cannot be read", async () => {
    const { bridge: b } = bridge({ readSettings: async () => ({ ok: false, reason: "no-shell" }) });
    const { result } = renderHook(() => useSettings(b));

    await flush();
    expect(result.current.loaded).toBe(true);
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });
});
