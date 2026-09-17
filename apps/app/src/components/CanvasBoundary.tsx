import { Component } from "react";
import type { ReactNode } from "react";

/// A floor under the graph canvas, which arrives as a chunk fetched when it is first needed.
///
/// `GraphCanvas` catches what Sigma throws while it is coming up, but it cannot catch the two
/// things that happen before it exists: a dynamic import that fails, and a throw while React is
/// rendering the component itself. Both would otherwise unmount everything above them - the graph
/// tab with its filters, or the local pane and the tree it sits under - so the whole panel
/// disappears because one chunk did not arrive.
///
/// A class, because that is the only kind of component React lets catch an error. It keeps no
/// message of its own: the caller has `t` in hand and passes the wording in.

export interface CanvasBoundaryProps {
  message: string;
  children: ReactNode;
}

export default class CanvasBoundary extends Component<CanvasBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="flex h-full w-full items-center justify-center bg-app p-4 text-center text-sm text-danger">{this.props.message}</p>
    );
  }
}
