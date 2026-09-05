import { describe, expect, it, afterEach } from "vitest";

/// The token layer, checked where it actually resolves.
///
/// jsdom computes no cascade for CSS variables the way a browser does, so this is the only place the
/// three theme states can be told apart. And the failure being guarded against is exactly the one
/// that looks fine in the theme its author was in: a token defined only inside a media query renders
/// one theme's text on the other theme's ground.

const root = () => document.documentElement;
const token = (name: string) =>
  getComputedStyle(root()).getPropertyValue(name).trim().toLowerCase();

afterEach(() => {
  root().removeAttribute("data-theme");
});

describe("design tokens", () => {
  it("resolves the light palette when nothing is stamped", () => {
    expect(token("--tp-app")).toBe("#ffffff");
    expect(token("--tp-ink")).toBe("#171717");
  });

  it("resolves the dark palette when dark is chosen explicitly", () => {
    root().setAttribute("data-theme", "dark");
    expect(token("--tp-app")).toBe("#111827");
    expect(token("--tp-ink")).toBe("#eef2f8");
  });

  it("returns to light when the choice is removed", () => {
    root().setAttribute("data-theme", "dark");
    root().removeAttribute("data-theme");
    expect(token("--tp-app")).toBe("#ffffff");
  });

  // Every token must be answered in both themes. One missing from the dark block inherits the light
  // value and paints a light-mode colour onto a dark surface - legible to nobody, and invisible to
  // whoever is working in light mode.
  it("defines every colour token in both themes", () => {
    const names = [
      "--tp-app", "--tp-panel", "--tp-sunken", "--tp-hover",
      "--tp-rule", "--tp-hairline", "--tp-menu-rule",
      "--tp-ink", "--tp-ink-2", "--tp-ink-3", "--tp-ink-4", "--tp-ink-5", "--tp-faint",
      "--tp-accent", "--tp-accent-strong", "--tp-selected", "--tp-selected-ink",
      "--tp-leaf", "--tp-danger", "--tp-danger-strong",
      "--tp-gutter", "--tp-marker", "--tp-tok-head", "--tp-tok-strong",
      "--tp-tok-code", "--tp-tok-quote", "--tp-caret-line",
      "--tp-tok-keyword", "--tp-tok-string", "--tp-tok-comment",
      "--tp-tok-number", "--tp-tok-type", "--tp-tok-func",
    ];

    const light = Object.fromEntries(names.map((n) => [n, token(n)]));
    root().setAttribute("data-theme", "dark");
    const dark = Object.fromEntries(names.map((n) => [n, token(n)]));

    expect(names.filter((n) => light[n] === "")).toEqual([]);
    expect(names.filter((n) => dark[n] === "")).toEqual([]);

    // Only the two that are deliberately shared may match across themes.
    const shared = ["--tp-accent-strong", "--tp-danger-strong"];
    const unchanged = names.filter((n) => light[n] === dark[n] && !shared.includes(n));
    expect(unchanged).toEqual([]);
  });

  it("gives Tailwind utilities the live value, not a baked-in one", () => {
    // `@theme inline` is what makes this true. Without it the utility freezes at the light value and
    // the whole dark palette changes nothing on screen.
    const probe = document.createElement("div");
    probe.className = "bg-app";
    document.body.append(probe);

    const lightBg = getComputedStyle(probe).backgroundColor;
    root().setAttribute("data-theme", "dark");
    const darkBg = getComputedStyle(probe).backgroundColor;
    probe.remove();

    expect(lightBg).toBe("rgb(255, 255, 255)");
    expect(darkBg).toBe("rgb(17, 24, 39)");
  });
});
