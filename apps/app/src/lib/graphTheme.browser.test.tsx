import { afterEach, describe, expect, it } from "vitest";
import { GRAPH_TOKENS, readGraphPalette } from "./graphTheme";

/// The graph's palette, checked where the tokens actually resolve.
///
/// Two rules live here, and both are invisible when broken in the theme their author was working in.
///
/// **Every colour Sigma is handed must be opaque.** Sigma draws in WebGL and blends with
/// `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)` - premultiplied alpha - while the colours it is
/// given are not premultiplied. A value at 7% alpha is therefore drawn at very nearly full strength.
/// That is worse than a faint mistake: the token that fades the graph back behind a selection came
/// out louder than the nodes and edges the selection was meant to pick out.
///
/// **A dimmed colour must be nearer the background than the colour it replaces.** "Dim" is a claim
/// about a relationship, not a hue, and the relationship runs in opposite directions in the two
/// themes - which is exactly why a hardcoded value here would be right in one and wrong in the other.

const root = () => document.documentElement;

afterEach(() => {
  root().removeAttribute("data-theme");
});

const probe = document.createElement("span");

/// A token's value as the browser resolves it, always as `rgb(...)` or `rgba(...)`.
function resolve(value: string): string {
  probe.style.color = "";
  probe.style.color = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}

function channels(value: string): { r: number; g: number; b: number; a: number } {
  const parts = resolve(value)
    .replace(/^rgba?\(|\)$/g, "")
    .split(/[\s,/]+/)
    .filter((part) => part !== "")
    .map(Number);
  const [r = 0, g = 0, b = 0, a = 1] = parts;
  return { r, g, b, a };
}

/// Relative luminance, so "nearer the background" can be measured rather than eyeballed.
function luminance(value: string): number {
  const { r, g, b } = channels(value);
  const linear = (channel: number) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

const contrast = (one: string, other: string) => {
  const [first, second] = [luminance(one), luminance(other)];
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

const palette = () => readGraphPalette(getComputedStyle(root()), "x");

/// The ground everything is drawn on, read straight from the token rather than through the palette.
const ground = () => luminance(getComputedStyle(root()).getPropertyValue("--tp-app").trim());

const themes = ["light", "dark"] as const;

describe("the graph's palette", () => {
  it("hands Sigma nothing translucent, in either theme", () => {
    for (const theme of themes) {
      root().setAttribute("data-theme", theme);
      const colours = palette();
      const translucent = (Object.keys(GRAPH_TOKENS) as (keyof typeof GRAPH_TOKENS)[]).filter(
        (key) => channels(colours[key]).a !== 1,
      );
      expect({ theme, translucent }).toEqual({ theme, translucent: [] });
    }
  });

  it("fades a node towards the background rather than away from it", () => {
    for (const theme of themes) {
      root().setAttribute("data-theme", theme);
      const colours = palette();
      const behind = ground();
      const away = (colour: string) => Math.abs(luminance(colour) - behind);
      for (const key of ["note", "attachment", "ghost", "tag"] as const) {
        expect({ theme, key, dimmer: away(colours.dim) < away(colours[key]) }).toEqual({ theme, key, dimmer: true });
      }
    }
  });

  it("fades an edge towards the background rather than away from it", () => {
    for (const theme of themes) {
      root().setAttribute("data-theme", theme);
      const colours = palette();
      const behind = ground();
      const away = (colour: string) => Math.abs(luminance(colour) - behind);
      expect({ theme, dimmer: away(colours.dimEdge) < away(colours.edge) }).toEqual({ theme, dimmer: true });
    }
  });

  // The box behind a selected node's label. Sigma's own hover renderer fills it with a literal white
  // and writes the label in the ordinary label colour, which in dark mode is pale grey on white.
  it("writes a selected node's label on a surface it can be read against", () => {
    for (const theme of themes) {
      root().setAttribute("data-theme", theme);
      const colours = palette();
      expect({ theme, readable: contrast(colours.ink, colours.surface) >= 4.5 }).toEqual({ theme, readable: true });
      expect({ theme, outlined: contrast(colours.edge, colours.surface) > 1.1 }).toEqual({ theme, outlined: true });
    }
  });
});
