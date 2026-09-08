import { useCallback, useEffect, useState } from "react";
import type { RepoSummary } from "@trypthos/domain";
import type { GitHubBridge } from "../lib/workspaceClient";
import { failureKey } from "./useWorkspace";

/// The GitHub account, as the interface sees it.
///
/// **A token goes through here and is never held.** `connect` hands one to the bridge and keeps
/// nothing: a token in renderer state is a token in a React devtools inspection and in a crash dump,
/// which is the same reason the shell has no channel that returns one. What this holds is a LOGIN,
/// which is a name rather than a credential.
///
/// The four states the interface can be in are separate on purpose:
///
///   - `supported` false - a browser tab, with no credential store and no main process to make the
///     calls. Nothing is offered, because there is nothing the user could do about it.
///   - `checking` - the shell is asking GitHub who the stored token belongs to.
///   - `connected` with a `login` - a token that works, and the account it works for.
///   - not connected with an `errorKey` - a token that was refused, which is a different thing from
///     never having connected and needs to say so.

export interface GitHubState {
  /// Whether an account can be connected at all. False outside the desktop shell.
  supported: boolean;
  /// True while the shell is checking a stored token. Not the same as "not connected": showing a
  /// Connect form for half a second to somebody who is already signed in is worse than a moment's
  /// wait.
  checking: boolean;
  connected: boolean;
  login: string | null;
  /// The repositories the account owns. Empty until they are asked for - the picker asks when it
  /// opens, so nothing is fetched for a user who never opens it.
  repos: readonly RepoSummary[];
  loading: boolean;
  /// Translation key for the last failure, or null. Never a sentence - see `failureKey`, which this
  /// shares with the workspace so a refusal reads the same wherever it surfaces.
  errorKey: string | null;
}

export interface GitHubActions {
  /// Hands a token to the shell, which verifies it before storing it. Trimmed here, because a stray
  /// space pasted with a token is not part of it - and an empty box is not a request at all.
  connect(token: string): Promise<boolean>;
  disconnect(): Promise<void>;
  /// Fetches the repositories. `refresh` skips the copy the shell is holding, which is what a user
  /// who has just made a repository needs.
  loadRepos(refresh?: boolean): Promise<void>;
  dismissError(): void;
}

/// Runs one call to the shell, turning a rejection into an ordinary refusal.
///
/// **`ipcRenderer.invoke` REJECTS whenever the main-process handler throws**, so every call here can
/// fail rather than answer - a handler that was never registered, an unexpected errno, a bug on the
/// other side. Left uncaught, the hook simply stays in whatever state it was in: for the status
/// check that means `checking` for ever, which is a dialog spinning on "Loading your repositories..."
/// with no error and no way out. That was the bug.
///
/// The reason is deliberately generic. There is nothing to say about a failure the other side did
/// not name, and inventing a specific one would send the user somewhere on the strength of a guess.
async function attempt<T extends { ok: boolean }>(
  call: () => Promise<T>,
  logger: Pick<Console, "error"> = console,
): Promise<T | { ok: false; reason: string }> {
  try {
    return await call();
  } catch (error) {
    // Logged rather than shown: the message is a main-process error string, which is for whoever is
    // debugging it and not for the person trying to open a repository.
    logger.error("A call to the shell did not complete:", error);
    return { ok: false, reason: "unknown" };
  }
}

const EMPTY: GitHubState = {
  supported: false,
  checking: true,
  connected: false,
  login: null,
  repos: [],
  loading: false,
  errorKey: null,
};

export function useGitHub(bridge: GitHubBridge | null): GitHubState & GitHubActions {
  const [state, setState] = useState<GitHubState>({
    ...EMPTY,
    supported: bridge !== null,
    // Checking only when there is something to check. With no shell the answer is already known, and
    // a moment of "checking..." for a question nobody can ask would be wrong before it was right.
    checking: bridge !== null,
  });

  /// Asks the shell who the stored token belongs to.
  ///
  /// This is also how a stored token is verified - there is no way to check one but to use it - so a
  /// revoked token shows as disconnected with a reason rather than as an account that is still
  /// there. An indicator that named an account the app cannot reach is the one thing this must not
  /// do.
  ///
  /// The answer is dropped if the hook has gone by the time it arrives. A status check outlives a
  /// dialog that was closed while it was in flight, and setting state after that is a warning in
  /// the test output and a leak in the app.
  useEffect(() => {
    if (bridge === null) return;

    let live = true;
    void (async () => {
      const status = await attempt(() => bridge.githubStatus());
      if (!live) return;

      // **`checking` ends whatever happened.** A call that failed outright leaves the account
      // unknown, which reads as not connected with something to say - never as a check still in
      // progress, which is a dialog that spins for ever.
      if (!status.ok) {
        setState((prev) => ({
          ...prev,
          checking: false,
          connected: false,
          login: null,
          errorKey: failureKey(status.reason),
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        checking: false,
        connected: status.connected,
        login: status.login,
        // A reason only when there was a token to refuse. Never having connected is not a failure
        // and must not be reported as one.
        errorKey: status.reason === null ? null : failureKey(status.reason),
      }));
    })();

    return () => {
      live = false;
    };
  }, [bridge]);

  const connect = useCallback(
    async (token: string) => {
      const trimmed = token.trim();
      // An empty box is not a request. Sending it would spend a round trip to be told what is
      // already known here.
      if (bridge === null || trimmed === "") return false;

      setState((prev) => ({ ...prev, loading: true, errorKey: null }));
      const result = await attempt(() => bridge.connectGitHub(trimmed));

      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          loading: false,
          connected: false,
          login: null,
          errorKey: failureKey(result.reason),
        }));
        return false;
      }

      setState((prev) => ({
        ...prev,
        loading: false,
        connected: true,
        login: result.login,
        errorKey: null,
        // The list belongs to whichever account is connected, so connecting a different one starts
        // it empty rather than showing the previous account's repositories.
        repos: [],
      }));
      return true;
    },
    [bridge],
  );

  const disconnect = useCallback(async () => {
    if (bridge === null) return;

    const result = await attempt(() => bridge.disconnectGitHub().then((ok) => ({ ...ok })));
    // Reported rather than assumed. A disconnect that did not happen leaving the interface saying
    // "not connected" would be the interface lying about a credential that is still on disk.
    if (!result.ok) {
      setState((prev) => ({ ...prev, errorKey: failureKey("unknown") }));
      return;
    }

    // The repositories go with the account. Keeping them would let a picker opened after signing out
    // show the repositories of an account the app can no longer reach.
    setState((prev) => ({ ...prev, connected: false, login: null, repos: [], errorKey: null }));
  }, [bridge]);

  const loadRepos = useCallback(
    async (refresh = false) => {
      if (bridge === null) return;

      setState((prev) => ({ ...prev, loading: true, errorKey: null }));
      const result = await attempt(() => bridge.listRepositories(refresh));

      if (!result.ok) {
        // Carried rather than flattened into "could not load": a spent rate limit and a revoked
        // token are different problems, and they send the user to different places.
        setState((prev) => ({ ...prev, loading: false, errorKey: failureKey(result.reason) }));
        return;
      }

      setState((prev) => ({ ...prev, loading: false, repos: result.repos, errorKey: null }));
    },
    [bridge],
  );

  return {
    ...state,
    connect,
    disconnect,
    loadRepos,
    dismissError: () => setState((prev) => ({ ...prev, errorKey: null })),
  };
}
