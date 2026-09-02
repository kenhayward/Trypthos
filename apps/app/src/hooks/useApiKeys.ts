import { useCallback, useEffect, useMemo, useState } from "react";
import { normaliseEndpoint } from "@trypthos/domain";

/// Which endpoints have an API key stored, and how to change that.
///
/// The renderer never holds a key. It sends one to the shell and is told, separately, which
/// ENDPOINTS have one - which is everything the interface needs in order to say "Key stored" without
/// being able to reveal anything. There is deliberately no read: see the note on `IPC_CHANNELS`.

export interface KeyBridge {
  listKeyedEndpoints(): Promise<{ ok: true; endpoints: string[] } | { ok: false; reason: string }>;
  setApiKey(endpoint: string, key: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  deleteApiKey(endpoint: string): Promise<unknown>;
}

export type SaveKeyResult = { ok: true } | { ok: false; reason: string };

export function useApiKeys(bridge: KeyBridge | null, configuredEndpoints: readonly string[]) {
  const [keyedEndpoints, setKeyedEndpoints] = useState<string[]>([]);

  /// A stable identity for the configured set, so the effect below re-runs when the endpoints
  /// actually change and not merely when the array is rebuilt - which React does on every render.
  /// Sorted, because the same endpoints in a different order are the same set.
  const fingerprint = useMemo(
    () => [...configuredEndpoints].map(normaliseEndpoint).sort().join("\n"),
    [configuredEndpoints],
  );

  const refresh = useCallback(async () => {
    if (bridge === null) return;
    const result = await bridge.listKeyedEndpoints();
    if (result.ok) setKeyedEndpoints(result.endpoints);
  }, [bridge]);

  useEffect(() => {
    if (bridge === null) return;

    // `fingerprint` is the dependency that matters: saving settings sweeps keys for endpoints no
    // profile references any more, so a change to the configured set can change what is stored -
    // without which the UI would keep showing "Key stored" for a profile just repointed elsewhere.
    let cancelled = false;
    void bridge.listKeyedEndpoints().then((result) => {
      // The dialog can close, or the endpoints change again, before this answers. Setting state
      // then would overwrite a newer answer with an older one.
      if (cancelled || !result.ok) return;
      setKeyedEndpoints(result.endpoints);
    });

    return () => {
      cancelled = true;
    };
  }, [bridge, fingerprint]);

  const saveKey = useCallback(
    async (endpoint: string, key: string): Promise<SaveKeyResult> => {
      // No shell: the browser preview. Reporting failure rather than pretending, so the interface
      // does not show a stored key that went nowhere.
      if (bridge === null) return { ok: false, reason: "not-desktop" };

      const result = await bridge.setApiKey(endpoint, key);
      // Only on success. A refresh after a failure is a wasted round trip that cannot change
      // anything, and re-reading would make a failure look momentarily like a success.
      if (result.ok) await refresh();
      return result;
    },
    [bridge, refresh],
  );

  const deleteKey = useCallback(
    async (endpoint: string) => {
      if (bridge === null) return;
      await bridge.deleteApiKey(endpoint);
      await refresh();
    },
    [bridge, refresh],
  );

  return { keyedEndpoints, saveKey, deleteKey };
}
