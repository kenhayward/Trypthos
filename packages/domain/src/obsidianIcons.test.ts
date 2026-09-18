import { describe, expect, it } from "vitest";
import { ICON_LIMIT, iconFor, NO_ICONS, OBSIDIAN_ICONS_FILE, parseObsidianIcons } from "./obsidianIcons";

/// Iconic's file is another application's, so everything about it is untrusted: an unknown shape, a
/// colour that is not a colour, or more entries than a vault could plausibly have all mean no icons
/// rather than an error somebody has to act on.

const data = (fileIcons: unknown) => ({ fileIcons });

describe("where Iconic keeps its icons", () => {
  it("names the plugin's own data file", () => {
    expect(OBSIDIAN_ICONS_FILE).toBe(".obsidian/plugins/iconic/data.json");
  });
});

describe("reading Iconic's assignments", () => {
  it("keeps folder keys and file keys alike", () => {
    const map = parseObsidianIcons(
      data({ Projects: { icon: "lucide-folder-git-2" }, "Projects/Charter.md": { icon: "lucide-scroll-text" } }),
    );
    expect(iconFor(map, "Projects")).toEqual({ icon: "lucide-folder-git-2", colour: null });
    expect(iconFor(map, "Projects/Charter.md")).toEqual({ icon: "lucide-scroll-text", colour: null });
  });

  it("answers null for a path with no assignment", () => {
    expect(iconFor(parseObsidianIcons(data({ Projects: { icon: "lucide-folder" } })), "Ideas")).toBe(null);
  });

  it("ignores everything in the file that is not a file icon", () => {
    const map = parseObsidianIcons({
      fileIcons: { Notes: { icon: "lucide-book" } },
      tabIcons: { Something: { icon: "lucide-x" } },
      ribbonIcons: { "a-plugin:Command": { icon: "lucide-y" } },
      settings: { biggerIcons: "on" },
    });
    expect(Object.keys(map)).toEqual(["Notes"]);
  });

  // The format belongs to somebody else and will gain fields. An unknown key must not throw the
  // whole map away, or a plugin update silently removes every icon.
  it("tolerates fields it does not know", () => {
    const map = parseObsidianIcons(data({ Notes: { icon: "lucide-book", unsynced: true, somethingNew: 7 } }));
    expect(iconFor(map, "Notes")?.icon).toBe("lucide-book");
  });

  it("keeps an emoji as readily as a Lucide id", () => {
    expect(iconFor(parseObsidianIcons(data({ Ada: { icon: "\u{1F680}" } })), "Ada")?.icon).toBe("\u{1F680}");
  });

  it("drops an entry with no icon", () => {
    expect(parseObsidianIcons(data({ Ada: { icon: null }, Grace: { color: "blue" } }))).toEqual({});
  });

  it("answers nothing at all for a file it cannot make sense of", () => {
    expect(parseObsidianIcons(null)).toEqual(NO_ICONS);
    expect(parseObsidianIcons("not an object")).toEqual(NO_ICONS);
    expect(parseObsidianIcons({ fileIcons: "not a map" })).toEqual(NO_ICONS);
    expect(parseObsidianIcons({})).toEqual(NO_ICONS);
  });

  // The map crosses IPC every time a workspace opens. A file with more entries than a vault could
  // hold is a file this parser has misread, and the safe reading of a misread file is none of it.
  it("refuses a map larger than the limit", () => {
    const many: Record<string, { icon: string }> = {};
    for (let index = 0; index <= ICON_LIMIT; index += 1) many[`Folder${index}`] = { icon: "lucide-folder" };
    expect(parseObsidianIcons(data(many))).toEqual(NO_ICONS);
  });
});

describe("the colour on an assignment", () => {
  it("keeps one of Iconic's named tones", () => {
    expect(iconFor(parseObsidianIcons(data({ Ada: { icon: "lucide-book", color: "blue" } })), "Ada")?.colour).toBe("blue");
  });

  it("keeps a hex value", () => {
    expect(iconFor(parseObsidianIcons(data({ Ada: { icon: "lucide-book", color: "#3f6dd1" } })), "Ada")?.colour).toBe("#3f6dd1");
  });

  it("turns Iconic's rgb object into a colour a browser understands", () => {
    const map = parseObsidianIcons(data({ Ada: { icon: "lucide-book", color: { r: 12, g: 200, b: 255 } } }));
    expect(iconFor(map, "Ada")?.colour).toBe("rgb(12, 200, 255)");
  });

  // The value ends up in a style attribute. Anything that is not plainly a colour is dropped rather
  // than passed along to be interpreted by something else.
  it("drops a colour that is not one", () => {
    const refused: unknown[] = [
      "url(http://example.test/x)",
      "red; background: blue",
      "var(--tp-app)",
      "",
      "#12345",
      { r: 300, g: 0, b: 0 },
    ];
    for (const color of refused) {
      const map = parseObsidianIcons(data({ Ada: { icon: "lucide-book", color } }));
      expect(iconFor(map, "Ada")).toEqual({ icon: "lucide-book", colour: null });
    }
  });
});
