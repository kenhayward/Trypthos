import { useEffect, useRef, useCallback } from "react";
import type { LayoutRunner, Positions } from "./graphLayoutTypes";
import LayoutWorker from "./graphLayout.worker?worker&inline";

/// A promise per layout request, answered by the inline worker. One worker per graph view, disposed
/// with it.
export function createWorkerLayout(): { run: LayoutRunner; dispose(): void } {
  const worker = new LayoutWorker();
  const waiting = new Map<number, { resolve: (positions: Positions) => void; reject: (error: Error) => void }>();
  let next = 0;

  worker.onmessage = (event: MessageEvent<{ id: number; positions: Positions }>) => {
    waiting.get(event.data.id)?.resolve(event.data.positions);
    waiting.delete(event.data.id);
  };
  worker.onerror = () => {
    for (const { reject } of waiting.values()) reject(new Error("The graph layout failed."));
    waiting.clear();
  };

  return {
    run: (input) =>
      new Promise((resolve, reject) => {
        const id = next++;
        waiting.set(id, { resolve, reject });
        worker.postMessage({ id, input });
      }),
    dispose: () => {
      worker.terminate();
      waiting.clear();
    },
  };
}

/// The layout runner a graph view uses: the one a test injects, or a worker of its own.
///
/// Deviation from the brief: the brief's version keeps the runner in `useState` and calls `setRun`
/// from inside the effect that creates the worker, which `react-hooks/set-state-in-effect` flags.
/// Behaviour is identical here, but the worker lives in a ref created lazily in the effect (so
/// StrictMode's second mount gets a live one, same as the brief), and callers get a stable function
/// that waits for the worker via a microtask queue rather than a piece of render state that changes
/// out from under them. Returning `null` until the worker exists is not needed by any caller - the
/// stable function simply defers the underlying call until the worker is ready.
export function useLayoutRunner(injected: LayoutRunner | undefined): LayoutRunner | null {
  const workerRef = useRef<{ run: LayoutRunner; dispose(): void } | null>(null);
  const readyRef = useRef<{ resolve: () => void; promise: Promise<void> }>(makeGate());

  useEffect(() => {
    if (injected !== undefined) return;
    const worker = createWorkerLayout();
    workerRef.current = worker;
    readyRef.current.resolve();
    return () => {
      worker.dispose();
      workerRef.current = null;
      readyRef.current = makeGate();
    };
  }, [injected]);

  const ownRun = useCallback<LayoutRunner>(async (input) => {
    await readyRef.current.promise;
    return workerRef.current!.run(input);
  }, []);

  if (injected !== undefined) return injected;
  return ownRun;
}

function makeGate(): { resolve: () => void; promise: Promise<void> } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
