import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@trypthos/domain";

/// How long to wait after the last change before writing.
///
/// A panel drag produces a change per pointer move. Writing each one would hammer the disk for a
/// value nobody has finished choosing; waiting for the drag to settle writes once.
const WRITE_DELAY_MS = 400;

export interface SettingsBridge {
  readSettings(): Promise<{ ok: true; settings: Settings } | { ok: false; reason: string }>;
  writeSettings(settings: Settings): Promise<unknown>;
}

/// The settings file, as state.
///
/// Reads once on mount and writes on a delay. `loaded` matters: until the file has been read, the
/// state is the DEFAULTS rather than what is stored, and saving then would overwrite a real file with
/// defaults on every launch.
export function useSettings(bridge: SettingsBridge | null) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  /// Derived from the bridge rather than set in an effect. Without a shell there is nothing to read,
  /// so the defaults ARE the loaded state - and setting that synchronously in an effect would cost a
  /// second render to reach the same answer.
  const [loaded, setLoaded] = useState(bridge === null);

  useEffect(() => {
    // No shell - the browser preview. Defaults, and nothing is ever written.
    if (bridge === null) return;

    let cancelled = false;
    void bridge.readSettings().then((result) => {
      if (cancelled) return;
      if (result.ok) setSettings(result.settings);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loaded || bridge === null) return;

    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void bridge.writeSettings(settings), WRITE_DELAY_MS);

    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [settings, loaded, bridge]);

  const update = useCallback((change: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...change }));
  }, []);

  const updatePanels = useCallback((change: Partial<Settings["panels"]>) => {
    setSettings((prev) => ({ ...prev, panels: { ...prev.panels, ...change } }));
  }, []);

  return { settings, loaded, update, updatePanels };
}
