import { describe, expect, it, vi } from "vitest";
import { GRAPH_TOKENS, observeTheme, PICTOGRAMS, readGraphPalette } from "./graphTheme";

describe("the graph's palette", () => {
  it("reads every colour from a theme token", () => {
    const style = { getPropertyValue: (name: string) => ` value-of${name} ` };
    const palette = readGraphPalette(style, "Segoe UI");
    expect(palette.font).toBe("Segoe UI");
    for (const [key, token] of Object.entries(GRAPH_TOKENS)) {
      expect(token.startsWith("--tp-")).toBe(true);
      expect(palette[key as keyof typeof GRAPH_TOKENS]).toBe(`value-of${token}`);
    }
  });

  it("notices an explicit theme being chosen", async () => {
    const changed = vi.fn();
    const stop = observeTheme(changed);
    document.documentElement.setAttribute("data-theme", "dark");
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.documentElement.removeAttribute("data-theme");
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe("the pictograms drawn in node discs", () => {
  it("has an SVG data URI with a fixed size for every kind", () => {
    for (const kind of ["note", "attachment", "ghost", "tag"] as const) {
      const uri = PICTOGRAMS[kind];
      expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
      const svg = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
      expect(svg).toContain('width="64"');
      expect(svg).toContain('height="64"');
    }
  });
});
