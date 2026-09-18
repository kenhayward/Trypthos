import { describe, expect, it } from "vitest";
import { isEmojiIcon, loadLucideIcons, lucideName, safeNodes } from "./lucideIcons";

/// Lucide's data is ours, from a pinned dependency, so this is not a sanitiser. It is an allow-list,
/// which is a cheaper thing to be sure about: a future version of the set that introduced an element
/// or an attribute nobody had reviewed would be dropped rather than drawn.

describe("reading an Iconic icon id", () => {
  it("takes the Lucide name off a lucide- id", () => {
    expect(lucideName("lucide-folder-git-2")).toBe("folder-git-2");
    expect(lucideName("lucide-calendar-days")).toBe("calendar-days");
  });

  it("refuses anything that is not one", () => {
    expect(lucideName("\u{1F680}")).toBe(null);
    expect(lucideName("lucide-")).toBe(null);
    expect(lucideName("lucide-../../etc/passwd")).toBe(null);
    expect(lucideName("lucide-Folder")).toBe(null);
    expect(lucideName("folder")).toBe(null);
  });

  it("tells an emoji from a Lucide id", () => {
    expect(isEmojiIcon("\u{1F680}")).toBe(true);
    expect(isEmojiIcon("lucide-folder")).toBe(false);
  });
});

describe("the nodes an icon is drawn from", () => {
  it("keeps every element Lucide actually uses", () => {
    const nodes = safeNodes([
      ["path", { d: "M8 2v3" }],
      ["circle", { cx: "12", cy: "12", r: "4" }],
      ["ellipse", { cx: "1", cy: "2", rx: "3", ry: "4" }],
      ["line", { x1: "1", y1: "2", x2: "3", y2: "4" }],
      ["polygon", { points: "1,2 3,4" }],
      ["polyline", { points: "1,2 3,4" }],
      ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
    ]);
    expect(nodes).toHaveLength(7);
  });

  it("drops an element that is not on the list", () => {
    expect(
      safeNodes([
        ["script", { d: "x" }],
        ["foreignObject", {}],
        ["image", { href: "http://example.test/x" }],
      ]),
    ).toEqual([]);
  });

  it("drops an attribute that is not on the list", () => {
    expect(safeNodes([["path", { d: "M8 2v3", onload: "x", href: "http://example.test/x" }]])).toEqual([
      ["path", { d: "M8 2v3" }],
    ]);
  });

  it("answers nothing for a shape it does not recognise", () => {
    expect(safeNodes(null)).toEqual([]);
    expect(safeNodes("path")).toEqual([]);
    expect(safeNodes([["path"]])).toEqual([]);
    expect(safeNodes([[1, {}]])).toEqual([]);
  });
});

describe("the icon set itself", () => {
  it("loads once and holds names Iconic will ask for", async () => {
    const first = await loadLucideIcons();
    expect(await loadLucideIcons()).toBe(first);
    expect(safeNodes(first["folder-git-2"]).length).toBeGreaterThan(0);
    expect(safeNodes(first["calendar-days"]).length).toBeGreaterThan(0);
    expect(first["not-an-icon-that-exists"]).toBe(undefined);
  });
});
