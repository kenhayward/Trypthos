import { useCallback, useEffect, useState } from "react";
import { GraphChangedSchema, GraphProgressSchema, GraphStateSchema } from "@trypthos/domain";
import type { GraphProgress, GraphSnapshot } from "@trypthos/domain";
import type { GraphClient } from "../lib/workspaceClient";

/// One vault's graph as the renderer sees it.
///
/// **Everything from the bridge is parsed on arrival.** Main is trusted, but the schema is what stops
/// the two sides drifting silently - a shape change would otherwise show as a graph that stops
/// updating rather than as an error.
///
/// **Progress waits.** A small vault indexes in well under a second, and a bar that flashes for a
/// frame reads as something going wrong. `building` is immediate (the refresh button needs it);
/// `progress` appears only once a build has run for `PROGRESS_DELAY_MS`.

export const PROGRESS_DELAY_MS = 300;

export interface VaultGraphView {
  snapshot: GraphSnapshot | null;
  building: GraphProgress | null;
  progress: GraphProgress | null;
  error: string | null;
  refresh(): void;
}

export function useVaultGraph(client: GraphClient, workspaceId: string | null): VaultGraphView {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [building, setBuilding] = useState<GraphProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delayed, setDelayed] = useState(false);
  const [generation, setGeneration] = useState(0);

  // Cleared only when the vault changes - adjusted during render (React's documented pattern for
  // state that must not survive a prop change) rather than in an effect, so a refresh (which bumps
  // `generation`, never `workspaceId`) keeps the previous graph on screen while the new one builds -
  // that is the whole point of showing "showing index from 2 min ago".
  const [trackedWorkspaceId, setTrackedWorkspaceId] = useState(workspaceId);
  if (workspaceId !== trackedWorkspaceId) {
    setTrackedWorkspaceId(workspaceId);
    setSnapshot(null);
    setBuilding(null);
    setError(null);
  }

  useEffect(() => {
    if (workspaceId === null) return;
    let live = true;

    const load = async () => {
      const answer = await client.graphState(workspaceId);
      if (!live) return;
      if (!answer.ok) {
        setError(answer.reason);
        return;
      }
      const parsed = GraphStateSchema.safeParse(answer.state);
      if (!parsed.success) return;
      setSnapshot(parsed.data.snapshot);
      setBuilding(parsed.data.building);
      setError(parsed.data.error);
    };

    const offProgress = client.onGraphProgress((message) => {
      const parsed = GraphProgressSchema.safeParse(message);
      if (parsed.success && parsed.data.workspaceId === workspaceId) setBuilding(parsed.data);
    });
    const offChanged = client.onGraphChanged((message) => {
      const parsed = GraphChangedSchema.safeParse(message);
      if (parsed.success && parsed.data.workspaceId === workspaceId) void load();
    });
    void load();

    return () => {
      live = false;
      offProgress();
      offChanged();
    };
  }, [client, workspaceId, generation]);

  // Same reason as above: the reset is adjusted during render, and only the timer itself - which
  // calls setState from its own callback rather than synchronously in the effect body - stays in an
  // effect.
  const isBuilding = building !== null;
  const [trackedBuilding, setTrackedBuilding] = useState(isBuilding);
  if (isBuilding !== trackedBuilding) {
    setTrackedBuilding(isBuilding);
    setDelayed(false);
  }

  useEffect(() => {
    if (!isBuilding) return;
    const timer = setTimeout(() => setDelayed(true), PROGRESS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isBuilding]);

  const refresh = useCallback(() => {
    if (workspaceId === null) return;
    void client.refreshGraph(workspaceId).then((answer) => {
      if (answer.ok) setGeneration((value) => value + 1);
    });
  }, [client, workspaceId]);

  return { snapshot, building, progress: delayed ? building : null, error, refresh };
}
