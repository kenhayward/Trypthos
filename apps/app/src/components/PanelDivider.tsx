import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { nextDividerWidth, nextKeyboardWidth, type Grows } from "../lib/dividerDrag";

interface Props {
  /// Which way a drag makes the panel bigger. The workspace grows rightwards, the chat leftwards.
  grows: Grows;
  width: number;
  min: number;
  max: number;
  label: string;
  onResize: (width: number) => void;
}

/// The draggable seam between a panel and the editor.
///
/// Pointer events rather than mouse events, so a pen or touch drag works the same. Capture is taken
/// on the handle itself, which is what keeps a fast drag working after the pointer has outrun the
/// 4px seam - without it the drag simply stops the moment the cursor leaves the element.
export default function PanelDivider({ grows, width, min, max, label, onResize }: Props) {
  const { t } = useTranslation();
  const start = useRef({ x: 0, width: 0 });

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { x: event.clientX, width };
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;

      onResize(
        nextDividerWidth({
          startWidth: start.current.width,
          deltaX: event.clientX - start.current.x,
          grows,
          min,
          max,
        }),
      );
    },
    [grows, min, max, onResize],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Keyboard resizing, because a drag handle that only responds to a pointer is unusable for
      // anyone who does not use one.
      const next = nextKeyboardWidth(width, event.key, {
        grows,
        min,
        max,
        coarse: event.shiftKey,
      });
      // Null for any other key: the divider must not swallow keys that belong to the app.
      if (next === null) return;

      event.preventDefault();
      onResize(next);
    },
    [grows, min, max, width, onResize],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={t("panels.resize")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      className="w-1 shrink-0 cursor-col-resize bg-rule hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    />
  );
}
