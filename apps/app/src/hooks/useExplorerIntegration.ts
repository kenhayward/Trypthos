import { useCallback, useEffect, useState } from "react";
import type { IntegrationBridge } from "../lib/workspaceClient";

/// Whether Trypthos is in File Explorer's right-click menu, and turning that on or off.
///
/// Nothing is remembered here, and nothing is stored in settings: the registry is the record. A user
/// can remove the keys by hand, and a copy of the answer in a settings file would then be a switch
/// showing "on" for entries that are not there. So the state is what the shell reports, read once on
/// mount and again after every change.

export interface ExplorerIntegration {
  /// True once the shell has answered. Until then the switch has nothing honest to show.
  checked: boolean;
  /// Whether the entries CAN exist: a packaged Windows build, and nothing else.
  supported: boolean;
  registered: boolean;
  set(enabled: boolean): Promise<void>;
}

const NOTHING = { supported: false, registered: false };

export function useExplorerIntegration(bridge: IntegrationBridge | null): ExplorerIntegration {
  const [state, setState] = useState({ checked: false, ...NOTHING });

  useEffect(() => {
    let live = true;
    void (async () => {
      const status = bridge === null ? NOTHING : await bridge.status();
      if (live) {
        setState({
          checked: true,
          supported: status.supported === true,
          registered: status.registered === true,
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [bridge]);

  const set = useCallback(
    async (enabled: boolean) => {
      if (bridge === null) return;

      // The answer is the state that FOLLOWS, read back by the shell rather than assumed here: a
      // write that did not land must not leave the switch claiming it did.
      const status = await bridge.set(enabled);
      setState({
        checked: true,
        supported: status.supported === true,
        registered: status.registered === true,
      });
    },
    [bridge],
  );

  return { ...state, set };
}
