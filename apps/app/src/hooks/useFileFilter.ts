import { useCallback, useEffect, useRef, useState } from "react";
import type { FilterRequest } from "@trypthos/domain";
import type { FilterResult } from "../lib/workspaceClient";

/// The folder browser's filter box.
///
/// **A filter is a search, not a sieve.** It asks the shell to walk every open folder for names that
/// match, so it finds files inside folders nobody has expanded - which is the only way a filter over
/// a lazily-listed tree can mean what a user expects it to mean. The rows it draws are built by
/// `matchRows` from the paths that come back.
///
/// Its own hook rather than part of `useWorkspace`: the state here is a question in flight - a timer,
/// a generation counter, an answer that may already be stale - and none of it belongs beside the
/// documents, their revisions and the prompts about unsaved work.

export type FilterStatus =
  | { kind: "idle" }
  | { kind: "searching" }
  | {
      kind: "results";
      /// Qualified paths, in the order the folders were opened.
      paths: readonly string[];
      /// True when a search stopped at its budget. An answer cut short has to say so.
      truncated: boolean;
    };

export interface FilterSurroundings {
  /// The open folders, in the order they were opened. One search per folder, since each is a tree
  /// of its own with its own provider behind it.
  workspaces: readonly { id: string }[];
  filterFiles: (request: FilterRequest) => Promise<FilterResult>;
}

/// How long the typing has to settle before a walk starts.
///
/// Every keystroke would otherwise be a walk of every open folder. Long enough that typing a word
/// costs one search rather than four, short enough that it still feels like filtering - the box
/// itself never waits for any of this, since what the user typed is state of its own.
const SETTLE_MS = 250;

export function useFileFilter(where: FilterSurroundings) {
  const [filter, setText] = useState("");
  /// The search in progress or last finished, and the answers that have come back for it so far.
  ///
  /// The filter travels with it so `status` can be DERIVED rather than stored: an answer about
  /// something other than what is in the box means a search is still out, which is exactly what
  /// "searching" means. A second piece of state saying the same thing is a second thing that can
  /// disagree - and setting it would be a state update inside an effect, which React now warns is
  /// how a render loop starts.
  ///
  /// One slot per open folder, filled as each folder's walk finishes, so a quick local folder's
  /// matches are on screen while a slow cloud folder is still being listed. `run` names the search
  /// the slots belong to, since the same text can be asked again over a different set of folders.
  const [answer, setAnswer] = useState<{
    run: number;
    query: string;
    slots: readonly (FilterResult | undefined)[];
  } | null>(null);

  /// Which question is outstanding.
  ///
  /// An answer that arrives after the user has typed something else is an answer to a question they
  /// have abandoned, and applying it would put the wrong list under the box. Counted rather than
  /// compared by text, because the same text can be asked twice - clearing the box and retyping it.
  const generation = useRef(0);

  const query = filter.trim();
  const { workspaces } = where;

  /// The call into the shell, read when a search actually runs.
  ///
  /// A ref rather than a dependency: the window writes this callback inline, so it is a new function
  /// on every render. An effect that keyed on it would search, set state, re-render and search
  /// again - React answers that with "Maximum update depth exceeded", which is how it was found.
  /// Assigned in an effect rather than during render, because a render can be discarded or run
  /// twice; the search reads it from inside a timer, long after the commit.
  const filterFiles = useRef(where.filterFiles);
  useEffect(() => {
    filterFiles.current = where.filterFiles;
  }, [where.filterFiles]);

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;

    if (query === "") return;

    const timer = setTimeout(() => {
      // In parallel: they are separate folders behind separate providers, and one slow cloud
      // folder should not hold up the local one beside it - so each answer is applied as it comes.
      workspaces.forEach((workspace, index) => {
        void filterFiles.current({ path: workspace.id, filter: query }).then((result) => {
          if (generation.current !== mine) return;
          setAnswer((prev) => {
            const slots = prev !== null && prev.run === mine ? [...prev.slots] : [];
            slots[index] = result;
            return { run: mine, query, slots };
          });
        });
      });
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [query, workspaces]);

  const setFilter = useCallback((text: string) => setText(text), []);

  let status: FilterStatus = { kind: "searching" };
  if (query === "") {
    status = { kind: "idle" };
  } else if (answer !== null && answer.query === query && answer.slots.some((slot) => slot !== undefined)) {
    const paths: string[] = [];
    let truncated = false;
    for (const slot of answer.slots) {
      // A folder that has gone since it was opened is skipped rather than failing the filter:
      // its own row in the tree is where a folder that cannot be listed says so, and taking the
      // other folders' matches away would be answering a different question badly.
      if (slot === undefined || !slot.ok) continue;
      paths.push(...slot.paths);
      truncated = truncated || slot.truncated;
    }
    status = { kind: "results", paths, truncated };
  }

  return { filter, setFilter, status };
}
