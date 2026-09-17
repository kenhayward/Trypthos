import { useEffect, useState } from "react";
import type { LayoutInput, LayoutRunner, Positions } from "../lib/graphLayoutTypes";

/// Positions for a graph, recomputed when the graph object changes. A layout that finishes after the
/// graph has moved on is dropped - drawing it would put the old vault's shape under the new nodes.
/// A failed layout leaves `null`, which the views show as "not drawn yet" rather than crashing.
///
/// Deviation from the brief: the brief calls `setPositions(null)` synchronously in the effect body on
/// every input change, which `react-hooks/set-state-in-effect` flags. Behaviour is identical here:
/// state stores `{ input, positions }` together, and the returned value is derived at render time -
/// `null` whenever the stored input isn't reference-equal to the current `input` - so a stale result
/// reads as absent without a state write to clear it. The effect still starts the run and still
/// ignores a result that arrives after the input has changed again (the `live` flag); it only ever
/// calls `setState` once, inside the promise callback.
export function useGraphLayout(input: LayoutInput | null, run: LayoutRunner): Positions | null {
  const [state, setState] = useState<{ input: LayoutInput | null; positions: Positions | null }>({
    input: null,
    positions: null,
  });

  useEffect(() => {
    if (input === null) return;
    let live = true;
    run(input).then(
      (result) => {
        if (live) setState({ input, positions: result });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [input, run]);

  return state.input === input ? state.positions : null;
}
