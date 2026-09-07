import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FindDialog from "./FindDialog";

/// Dragging the find panel, in a real browser.
///
/// The only place it can be asked. The gesture measures its own box and the box of the panel it
/// floats over - `offsetLeft`, `offsetParent`, `clientWidth` - and jsdom answers all of those with
/// zero or null, so the drag cannot even begin there. Where it LANDS is decided by
/// `nextDialogPosition`, which is pure and tested without any of this; what is here is that the
/// measuring and the wiring are right.

/// The panel the dialog floats over.
///
/// It FILLS the viewport rather than taking a fixed size, because the browser runner's viewport is
/// narrow: a panel wider than the window puts half the dialog outside it, where `elementFromPoint`
/// answers null and a pointer could not reach it either. Everything below moves the panel by small
/// amounts for the same reason - there is not much room, and the clamp is a separate test.
function Floating({ onMove = vi.fn() }: { onMove?: (at: { left: number; top: number }) => void }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  return (
    <main style={{ position: "fixed", inset: 0 }}>
      <FindDialog
        tab="document"
        onTabChange={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        regex={false}
        onRegexChange={vi.fn()}
        caseSensitive={false}
        onCaseSensitiveChange={vi.fn()}
        position={position}
        onMove={(at) => {
          setPosition(at);
          onMove(at);
        }}
        scope=""
        status={{ kind: "idle" }}
        onSearch={vi.fn()}
        onStep={vi.fn()}
        onClose={vi.fn()}
      />
    </main>
  );
}

const dialog = () => screen.getByRole("dialog");
const grip = () => screen.getByTestId("find-drag-handle");

const press = (target: EventTarget, type: string, at: { x: number; y: number }) =>
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: at.x,
      clientY: at.y,
    }),
  );

describe("Dragging the find panel", () => {
  /// The test that would have caught the first attempt at this.
  ///
  /// The grab strip began life as an invisible overlay above the tab row, and every test passed
  /// because they all dispatched the press straight AT the handle. A real pointer never reaches an
  /// element another positioned element paints over, so in the running app the panel could not be
  /// dragged at all - it selected text instead. Hit-testing is the claim, so hit-testing is what is
  /// asserted.
  it("starts from whatever a pointer actually lands on in the strip", async () => {
    render(<Floating />);
    const before = dialog().getBoundingClientRect();

    // Where a user would actually aim: level with the tabs, in the gap between the last of them and
    // the close cross. Computed from the real boxes rather than guessed, because a point in the
    // padding ABOVE the row is not where this went wrong - the first attempt put the handler on an
    // invisible overlay that the positioned tab row painted over, so a press level with the tabs
    // reached them instead and selected text rather than moving the panel.
    const lastTab = screen.getByRole("tab", { name: "Find in Files" }).getBoundingClientRect();
    const cross = screen.getByRole("button", { name: "Close find" }).getBoundingClientRect();
    const aim = { x: (lastTab.right + cross.left) / 2, y: lastTab.top + lastTab.height / 2 };
    expect(aim.x).toBeGreaterThan(lastTab.right);

    // The press goes to whatever is REALLY under that point, not to the handle by name: targeting
    // the handle directly is what let the first attempt pass while being unreachable in the app.
    const under = document.elementFromPoint(aim.x, aim.y);
    expect(under).not.toBeNull();
    expect(under?.closest("button")).toBeNull();

    press(under!, "mousedown", aim);
    press(window, "mousemove", { x: aim.x - 30, y: aim.y + 60 });
    press(window, "mouseup", { x: aim.x - 30, y: aim.y + 60 });

    await vi.waitFor(() =>
      expect(Math.round(dialog().getBoundingClientRect().top - before.top)).toBe(60),
    );
  });

  it("moves with the pointer", async () => {
    render(<Floating />);
    const before = dialog().getBoundingClientRect();

    // Grabbed somewhere inside the strip rather than at its corner, so the assertion below is about
    // how far the POINTER travelled and not about where it was picked up.
    const grabbed = { x: before.left + 20, y: before.top + 10 };
    press(grip(), "mousedown", grabbed);
    press(window, "mousemove", { x: grabbed.x - 40, y: grabbed.y + 140 });
    press(window, "mouseup", { x: grabbed.x - 40, y: grabbed.y + 140 });

    // Waited for: the listener is a plain window handler rather than a React one, so the state it
    // sets is outside any batch React would flush before this line.
    await vi.waitFor(() => {
      const after = dialog().getBoundingClientRect();
      expect(Math.round(after.left - before.left)).toBe(-40);
      expect(Math.round(after.top - before.top)).toBe(140);
    });
  });

  // The first drag has to begin from wherever the stylesheet had put it. Taken from the `position`
  // prop, which is null until it has been moved once, it would jump to the top left on the first
  // pixel of the very first drag.
  it("begins from where the stylesheet left it, not from the corner", async () => {
    render(<Floating />);
    const before = dialog().getBoundingClientRect();
    expect(before.left).toBeGreaterThan(0);

    press(grip(), "mousedown", { x: before.left + 20, y: before.top + 10 });
    press(window, "mousemove", { x: before.left + 21, y: before.top + 10 });
    press(window, "mouseup", { x: before.left + 21, y: before.top + 10 });

    await vi.waitFor(() =>
      expect(Math.round(dialog().getBoundingClientRect().left - before.left)).toBe(1),
    );
  });

  // A dialog dragged off the edge is a dialog with no way back: it has no chrome of its own, so the
  // only thing that could return it is the drag it can no longer be given.
  it("cannot be dragged out of the panel", async () => {
    render(<Floating />);
    const before = dialog().getBoundingClientRect();

    press(grip(), "mousedown", { x: before.left + 20, y: before.top + 10 });
    press(window, "mousemove", { x: -5000, y: -5000 });
    press(window, "mouseup", { x: -5000, y: -5000 });

    await vi.waitFor(() => {
      const panel = document.querySelector("main")!.getBoundingClientRect();
      const after = dialog().getBoundingClientRect();
      expect(Math.round(after.left)).toBe(Math.round(panel.left));
      expect(Math.round(after.top)).toBe(Math.round(panel.top));
    });
  });

  it("stops when the button is released", async () => {
    render(<Floating />);
    const before = dialog().getBoundingClientRect();

    const grabbed = { x: before.left + 20, y: before.top + 10 };
    press(grip(), "mousedown", grabbed);
    press(window, "mousemove", { x: grabbed.x - 40, y: grabbed.y + 40 });
    press(window, "mouseup", { x: grabbed.x - 40, y: grabbed.y + 40 });
    await vi.waitFor(() =>
      expect(Math.round(dialog().getBoundingClientRect().left - before.left)).toBe(-40),
    );
    const settled = dialog().getBoundingClientRect();

    press(window, "mousemove", { x: 10, y: 10 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dialog().getBoundingClientRect().left).toBe(settled.left);
  });

  // The strip is the row the tabs are on, so the panel gains a grab area without gaining a title
  // bar. The buttons on that row have to keep working.
  it("leaves the controls on the same row clickable", async () => {
    const onMove = vi.fn();
    render(<Floating onMove={onMove} />);

    const files = screen.getByRole("tab", { name: "Find in Files" });
    const box = files.getBoundingClientRect();
    press(files, "mousedown", { x: box.left + 2, y: box.top + 2 });
    press(window, "mousemove", { x: box.left + 40, y: box.top + 40 });
    press(window, "mouseup", { x: box.left + 40, y: box.top + 40 });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onMove).not.toHaveBeenCalled();
  });
});
