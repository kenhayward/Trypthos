import { useEffect, useState } from "react";
import type { IconAssignment } from "@trypthos/domain";
import { toneColour } from "../lib/iconTone";
import { isEmojiIcon, loadLucideIcons, lucideName, safeNodes } from "../lib/lucideIcons";
import type { IconNode } from "../lib/lucideIcons";

/// One icon an Obsidian vault has assigned, drawn on a tree row.
///
/// Lucide draws on the same 24-unit grid and in the same stroke as `Glyph`, so an assigned icon is a
/// first-class mark here rather than a picture pasted into a row - it takes the theme's colour like
/// everything around it, unless the user chose one in Iconic.
///
/// Falling back is a real answer, and the row hands in what to fall back to. An id the set does not
/// hold, a set that failed to load, and the moment before it arrives all leave the row with the
/// glyph it already had - which is the right thing to see, and keeps the name from jumping sideways
/// when an icon turns up late.

export default function AssignedIcon({
  assignment,
  className,
  fallback = null,
}: {
  assignment: IconAssignment;
  className: string;
  /// Drawn instead whenever there is no icon to draw - the row's own glyph.
  fallback?: React.ReactNode;
}) {
  const [nodes, setNodes] = useState<IconNode[] | null>(null);
  const name = lucideName(assignment.icon);

  useEffect(() => {
    if (name === null) return;
    let live = true;
    void loadLucideIcons().then(
      (icons) => {
        if (live) setNodes(safeNodes(icons[name]));
      },
      () => {
        // The set failed to load. The row keeps its own glyph, and nothing is said: an icon is
        // decoration, and there is nothing here for anyone to act on.
      },
    );
    return () => {
      live = false;
    };
  }, [name]);

  const colour = toneColour(assignment.colour);

  if (name === null) {
    if (!isEmojiIcon(assignment.icon)) return <>{fallback}</>;
    return (
      <span
        data-testid="assigned-icon"
        aria-hidden="true"
        style={colour === undefined ? undefined : { color: colour }}
        className={`${className} grid shrink-0 place-items-center text-[0.9em] leading-none`}
      >
        {assignment.icon}
      </span>
    );
  }

  if (nodes === null || nodes.length === 0) return <>{fallback}</>;

  return (
    <svg
      data-testid="assigned-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`${className} shrink-0`}
      style={colour === undefined ? undefined : { color: colour }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {nodes.map(([element, attributes], index) => svgNode(element, attributes, index))}
    </svg>
  );
}

/// A `switch` rather than `createElement(element, ...)`, for the same reason `SourceGlyph` is one:
/// an element added to the allow-list and forgotten here is a type error, not dynamic markup.
function svgNode(element: string, attributes: Readonly<Record<string, string>>, key: number) {
  switch (element) {
    case "path":
      return <path key={key} {...attributes} />;
    case "circle":
      return <circle key={key} {...attributes} />;
    case "ellipse":
      return <ellipse key={key} {...attributes} />;
    case "line":
      return <line key={key} {...attributes} />;
    case "polygon":
      return <polygon key={key} {...attributes} />;
    case "polyline":
      return <polyline key={key} {...attributes} />;
    case "rect":
      return <rect key={key} {...attributes} />;
    default:
      return null;
  }
}
