import { computeLayout } from "./graphLayout";
import type { LayoutInput, Positions } from "./graphLayoutTypes";

/// Runs the layout off the renderer's main thread. Loaded as an inline (blob) worker, so it needs no
/// separate file at runtime - a module worker loaded from file:// is refused in the packaged app.

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; input: LayoutInput }>) => void) | null;
  postMessage(message: { id: number; positions: Positions }): void;
};

scope.onmessage = (event) => {
  scope.postMessage({ id: event.data.id, positions: computeLayout(event.data.input) });
};
