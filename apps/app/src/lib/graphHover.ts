import type { GraphPalette } from "./graphTheme";

/// The box drawn behind a selected or hovered node's label.
///
/// Sigma has one of these already and it cannot be themed: `drawDiscNodeHover` fills the box with a
/// literal `#FFF` and then writes the label in whatever `labelColor` says. That pairing only works
/// in a light theme - in dark mode it puts the label's pale grey on white and the name of the node
/// the user just clicked becomes the one thing they cannot read.
///
/// The geometry below is Sigma's, deliberately: a box that merges into the node's disc, so the only
/// thing that changes is where the colours come from. The black drop shadow it drew is gone, since
/// a black shadow says nothing on a dark ground; a one-pixel rule around the box does the same work
/// in both themes.

/// What Sigma hands a hover renderer, narrowed to what this one reads.
export interface HoverNode {
  x: number;
  y: number;
  size: number;
  label: string | null;
}

export interface HoverSettings {
  labelSize: number;
  labelWeight: string;
}

const PADDING = 2;

export function drawNodeHover(
  context: CanvasRenderingContext2D,
  data: HoverNode,
  settings: HoverSettings,
  palette: GraphPalette,
): void {
  const size = settings.labelSize;
  context.font = `${settings.labelWeight} ${size}px ${palette.font}`;
  context.fillStyle = palette.surface;
  context.strokeStyle = palette.edge;
  context.lineWidth = 1;

  if (typeof data.label === "string") {
    const boxWidth = Math.round(context.measureText(data.label).width + 5);
    const boxHeight = Math.round(size + 2 * PADDING);
    const radius = Math.max(data.size, size / 2) + PADDING;
    const angle = Math.asin(boxHeight / 2 / radius);
    const xDelta = Math.sqrt(Math.abs(radius ** 2 - (boxHeight / 2) ** 2));

    context.beginPath();
    context.moveTo(data.x + xDelta, data.y + boxHeight / 2);
    context.lineTo(data.x + radius + boxWidth, data.y + boxHeight / 2);
    context.lineTo(data.x + radius + boxWidth, data.y - boxHeight / 2);
    context.lineTo(data.x + xDelta, data.y - boxHeight / 2);
    context.arc(data.x, data.y, radius, angle, -angle);
    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = palette.ink;
    context.fillText(data.label, data.x + data.size + 3, data.y + size / 3);
    return;
  }

  // No label to sit behind, so the halo is all there is - and it still has to show which node is
  // selected.
  context.beginPath();
  context.arc(data.x, data.y, data.size + PADDING, 0, Math.PI * 2);
  context.closePath();
  context.fill();
  context.stroke();
}
