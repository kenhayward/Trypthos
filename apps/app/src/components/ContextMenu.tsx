import { useEffect, useRef, type ReactNode } from "react";

/// A right-click menu, drawn at the pointer.
///
/// One implementation for every right-click menu in the app - the tab strip's and the workspace's -
/// so dismissing one behaves the same wherever it is: a click outside, or Escape. Drawn here rather
/// than popped natively, following `OpenFilesMenu` and `ChatHistoryMenu`, so it reads the same
/// tokens as the rest of the window and can be tested without a shell.
///
/// Fixed to the pointer, like a menu rather than a dropdown: it is about the thing under the cursor,
/// and anchoring it to a container would put it somewhere else entirely once that has scrolled.
export default function ContextMenu({
  label,
  x,
  y,
  onDismiss,
  children,
}: {
  /// What the menu is about, for a screen reader.
  label: string;
  x: number;
  y: number;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Listeners exist only while a menu is on screen - this component is not rendered otherwise - so
  // there is nothing on the document for a menu nobody opened.
  useEffect(() => {
    function onDocument(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onDismiss();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }

    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-44 rounded-md border border-rule bg-app p-1 shadow-menu"
    >
      {children}
    </div>
  );
}

/// One entry in a `ContextMenu`.
export function ContextMenuItem({
  onClick,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  /// Why an entry is greyed, when it is. A disabled entry that does not say why reads as broken.
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="block w-full rounded px-2 py-1 text-left text-ui text-ink hover:bg-hover disabled:text-ink-4 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
