import { useCallback, useEffect, useState } from "react";
import type { CloudAccountBridge } from "../lib/workspaceClient";
import { attempt } from "./useGitHub";

/// A cloud account (Google, OneDrive), as the interface sees it.
///
/// The shape of `useGitHub`, with one state GitHub does not have: `connecting`, while the consent
/// page is open in the user's browser. Nothing here ever holds a credential - the sign-in happens
/// entirely between the browser and the main process, and what comes back is an email.

export interface CloudAccountState {
  /// False outside the desktop shell.
  supported: boolean;
  /// False in a build without an OAuth client. Known only after the first status answer.
  configured: boolean;
  checking: boolean;
  connected: boolean;
  email: string | null;
  /// True while the consent page is open in the browser.
  connecting: boolean;
  errorKey: string | null;
}

export interface CloudAccountActions {
  /// Opens the provider's consent page and waits for the answer. True when an account was connected.
  connect(): Promise<boolean>;
  /// Stops waiting for the browser. The pending `connect` then answers cancelled.
  cancel(): Promise<void>;
  disconnect(): Promise<void>;
  dismissError(): void;
}

export function useCloudAccount(bridge: CloudAccountBridge | null, failureKey: (reason: string) => string | null): CloudAccountState & CloudAccountActions {
  const [state, setState] = useState<CloudAccountState>({
    supported: bridge !== null,
    configured: false,
    checking: bridge !== null,
    connected: false,
    email: null,
    connecting: false,
    errorKey: null,
  });

  useEffect(() => {
    if (bridge === null) return;

    let live = true;
    void (async () => {
      const status = await attempt(() => bridge.status());
      if (!live) return;

      if (!status.ok) {
        setState((prev) => ({ ...prev, checking: false, connected: false, email: null, errorKey: failureKey(status.reason) }));
        return;
      }

      setState((prev) => ({
        ...prev,
        checking: false,
        configured: status.configured,
        connected: status.connected,
        email: status.email,
        errorKey: status.reason === null ? null : failureKey(status.reason),
      }));
    })();

    return () => {
      live = false;
    };
  }, [bridge, failureKey]);

  const connect = useCallback(async () => {
    if (bridge === null) return false;

    setState((prev) => ({ ...prev, connecting: true, errorKey: null }));
    const result = await attempt(() => bridge.connect());

    if (!result.ok) {
      // `failureKey("cancelled")` is null: closing the browser is not an error.
      setState((prev) => ({ ...prev, connecting: false, errorKey: failureKey(result.reason) }));
      return false;
    }

    setState((prev) => ({ ...prev, connecting: false, connected: true, email: result.email, errorKey: null }));
    return true;
  }, [bridge, failureKey]);

  const cancel = useCallback(async () => {
    if (bridge === null) return;
    await attempt(() => bridge.cancelConnect());
  }, [bridge]);

  const disconnect = useCallback(async () => {
    if (bridge === null) return;

    const result = await attempt(() => bridge.disconnect().then((answer) => ({ ...answer })));
    if (!result.ok) {
      setState((prev) => ({ ...prev, errorKey: failureKey(result.reason ?? "unknown") }));
      return;
    }
    setState((prev) => ({ ...prev, connected: false, email: null, errorKey: null }));
  }, [bridge, failureKey]);

  return {
    ...state,
    connect,
    cancel,
    disconnect,
    dismissError: () => setState((prev) => ({ ...prev, errorKey: null })),
  };
}
