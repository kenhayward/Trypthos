import { useEffect, useMemo, useRef, useState } from "react";
import { NO_ICONS } from "@trypthos/domain";
import type { IconMap } from "@trypthos/domain";
import type { IconsClient } from "../lib/workspaceClient";

/// The icon assignments for every open workspace, fetched once each as they open.
///
/// **No watcher.** Icons set in Obsidian while Trypthos is open appear after a refresh, which is the
/// contract the graph already has and the sentence the release notes already carry.
///
/// A refusal is not an error. A folder that is not a vault, a vault with no icon plugin and a
/// repository all answer the same way, and they all mean the tree keeps its own glyphs.

export function useWorkspaceIcons(
  client: IconsClient,
  workspaceIds: readonly string[],
): Readonly<Record<string, IconMap>> {
  const [maps, setMaps] = useState<Readonly<Record<string, IconMap>>>({});
  /// Which workspaces have been asked about. Opening a second folder must not send the shell back to
  /// the plugin file of every folder that was already open.
  const asked = useRef<Set<string>>(new Set());
  /// Whether this component is still mounted. Not a per-effect flag: a fetch begun for one workspace
  /// is still wanted when a second one opens while it is in flight, and a per-effect flag would
  /// abandon it and never ask again.
  const mounted = useRef(true);
  // The ids as one value, so the effect runs when the set of open workspaces changes and not on
  // every render that happens to build a new array with the same names in it. JSON rather than a
  // separator character, because there is no character a workspace id is guaranteed not to hold.
  const key = JSON.stringify(workspaceIds);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    const ids = JSON.parse(key) as string[];
    const open = new Set(ids);
    // A workspace that has closed is forgotten, so reopening it reads the file again - which is how
    // icons changed in Obsidian in the meantime arrive.
    for (const id of asked.current) if (!open.has(id)) asked.current.delete(id);

    const hold = (id: string, icons: IconMap) => {
      if (mounted.current) setMaps((held) => ({ ...held, [id]: icons }));
    };

    for (const id of ids) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      void client.workspaceIcons(id).then(
        (answer) => hold(id, answer.ok ? answer.icons : NO_ICONS),
        () => hold(id, NO_ICONS),
      );
    }
    // `client` is a stable object held for the life of the app; `key` is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /// Only what is open. Derived rather than pruned in place, so a map is never written to state
  /// twice for the same answer - and a workspace that has closed leaves nothing behind in what
  /// callers can see.
  return useMemo(() => {
    const visible: Record<string, IconMap> = {};
    for (const id of JSON.parse(key) as string[]) {
      const map = maps[id];
      if (map !== undefined) visible[id] = map;
    }
    return visible;
  }, [key, maps]);
}
