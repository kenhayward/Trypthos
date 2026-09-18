# Workspace Tree Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the folder browser's row into a disclosure band and a select target, and draw the folder and file icons an Obsidian vault has assigned with the Iconic plugin.

**Architecture:** Every expandable row becomes two sibling controls inside one flex container, with a fixed 44px band that toggles and the rest of the row selecting. A new domain module parses Iconic's `data.json`, a new main-process channel serves the validated map through the workspace provider, and the renderer draws Lucide icon data through the existing `Glyph` from a lazily loaded map.

**Tech Stack:** TypeScript, React 19, zod, Tailwind v4, Electron CommonJS main process, vitest (jsdom + Playwright Chromium), node:test for the shell.

**Spec:** `docs/specs/workspace-tree-rows.md`

## Global Constraints

- **TDD is required.** Write the failing test, watch it fail, then the minimal code. No production code without a failing test that preceded it.
- **Test output must be pristine.** A passing run prints no errors and no warnings.
- **The renderer is untrusted.** `contextIsolation` on, `nodeIntegration` off, a narrow enumerated IPC surface. Every handler validates its arguments in the main process.
- **Every path is validated against the workspace root** after normalisation, in the one shared guard module. The renderer never names a path outside a workspace.
- **Never put real user data anywhere** - names, emails, real workspace paths, document contents - in code, comments, fixtures, docs, commit messages, issues or PRs. Invent fixtures (`Ada`, `Grace`, `Alice`).
- **No em or en dashes in user-facing text.** A plain hyphen `-`. Code, comments and internal docs are exempt.
- **Every colour resolves through a token** in `apps/app/src/index.css`, defined in all three theme blocks. The single exception is a colour the user chose in Iconic, which passes through.
- **Do not remove `reporters: ["default"]`** from either vitest config.
- **Use the editor tools, not shell heredocs,** for any file containing regex escapes or Windows paths.
- **`main` is branch-protected.** Work lands through a PR from `spec/workspace-tree-rows`.
- **Version 0.85.0** - a functional enhancement, so Minor +1 and Build reset. Bump `version.json` and all four manifests, and exactly five entries in `package-lock.json`.

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `packages/domain/src/obsidianIcons.ts` | Iconic's file name, its schema, parsing to a capped map, and the path lookup |
| `packages/domain/src/obsidianIcons.test.ts` | Its tests |
| `apps/app/src/lib/iconTone.ts` | Iconic's colour value to a CSS colour this app can draw |
| `apps/app/src/lib/iconTone.test.ts` | Its tests |
| `apps/app/src/lib/lucideIcons.ts` | The lazy Lucide map, the element and attribute allow-lists, the id to name conversion |
| `apps/app/src/lib/lucideIcons.test.ts` | Its tests |
| `apps/app/src/components/AssignedIcon.tsx` | Draws one assignment - a Lucide glyph or an emoji - or nothing |
| `apps/app/src/components/AssignedIcon.test.tsx` | Its tests |
| `apps/app/src/hooks/useWorkspaceIcons.ts` | Fetches and holds one map per open workspace |
| `apps/app/src/hooks/useWorkspaceIcons.test.ts` | Its tests |
| `apps/app/src/testing/moduleGraph.ts` | The source-file walk and import matcher, shared by the two bundle guards |
| `apps/app/src/lib/iconBundle.test.ts` | Asserts nothing eager imports the Lucide map |
| `apps/app/src/components/WorkspacePanel.browser.test.tsx` | The band's measured geometry and where a click lands |

**Modify**

| File | Change |
|---|---|
| `packages/domain/src/index.ts` | Export the new module |
| `packages/domain/src/ipc.ts` | `icons:map` in `IPC_CHANNELS`, `IconsRequest`, `IconMapSchema` |
| `apps/desktop/src/preload.js` | `workspaceIcons(workspaceId)` |
| `apps/desktop/src/ipcHandlers.js` | The `icons:map` handler |
| `apps/desktop/src/ipcHandlers.test.js` | Its tests |
| `apps/app/src/lib/workspaceClient.ts` | `workspaceIcons` on the interface and on `browserClient` |
| `apps/app/src/components/WorkspacePanel.tsx` | The row split, the geometry, the ARIA, the arrows, the icons |
| `apps/app/src/components/WorkspacePanel.test.tsx` | Rewritten interaction tests |
| `apps/app/src/App.tsx` | Wire the hook into the panel |
| `apps/app/src/index.css` | Nine tone tokens in all three theme blocks |
| `apps/app/src/lib/theme.browser.test.tsx` | The nine tokens in the inventory |
| `apps/app/src/locales/en.json` | `workspace.expand`, `workspace.collapse` |
| `apps/app/src/lib/graphBundle.test.ts` | Use the extracted helper |
| `package.json`, `package-lock.json` | `lucide-static` |
| Release files | `version.json` + 4 manifests + 5 lock entries, `releaseNotes/current.ts`, `appInfo.ts`, `README.md`, `docs/features.md`, `docs/Architecture.md` |

---

## Task 1: The Iconic file, parsed

**Files:**
- Create: `packages/domain/src/obsidianIcons.ts`
- Create: `packages/domain/src/obsidianIcons.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `OBSIDIAN_ICONS_FILE: string`, `ICON_LIMIT: number`, `NO_ICONS: IconMap`, `type IconAssignment = { icon: string; colour: string | null }`, `type IconMap = Readonly<Record<string, IconAssignment>>`, `parseObsidianIcons(raw: unknown): IconMap`, `iconFor(map: IconMap, path: string): IconAssignment | null`

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/obsidianIcons.test.ts`:

```ts
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
    for (const color of ["url(http://example.test/x)", "red; background: blue", "var(--tp-app)", "", "#12345", { r: 300, g: 0, b: 0 }]) {
      const map = parseObsidianIcons(data({ Ada: { icon: "lucide-book", color } }));
      expect(iconFor(map, "Ada")).toEqual({ icon: "lucide-book", colour: null });
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --root packages/domain obsidianIcons`
Expected: FAIL - `Failed to resolve import "./obsidianIcons"`

- [ ] **Step 3: Write the module**

Create `packages/domain/src/obsidianIcons.ts`:

```ts
import { z } from "zod";

/// The icons an Obsidian vault has had assigned with the Iconic plugin.
///
/// Obsidian itself has no folder icons. Iconic is a community plugin, so this file is another
/// application's private format: it is read, never written, and everything about it is untrusted.
/// Anything unexpected - a missing file, invalid JSON, a shape the schema refuses, a plugin version
/// that has moved on - means no icons and no message. They are decoration, and an error about
/// another application's data directory is noise the user cannot act on.

export const OBSIDIAN_ICONS_FILE = ".obsidian/plugins/iconic/data.json";

/// The map crosses IPC whenever a workspace opens, so it is bounded. A file claiming more icons than
/// a vault could plausibly hold is a file this parser has misread, and none of it is then trusted.
export const ICON_LIMIT = 2000;

export interface IconAssignment {
  /// Either a Lucide id of the form `lucide-<kebab-name>` or a literal emoji.
  icon: string;
  /// A colour the user chose: one of Iconic's nine tone names, a CSS colour name, a hex value, or an
  /// `rgb(...)` built from its object form. Null when there is none, or none that is plainly a colour.
  colour: string | null;
}

export type IconMap = Readonly<Record<string, IconAssignment>>;

export const NO_ICONS: IconMap = Object.freeze({});

const Rgb = z.object({ r: z.number(), g: z.number(), b: z.number() });

/// Loose on purpose. Iconic will gain fields, and a schema that refused an unknown one would make a
/// plugin update look like every icon being deleted.
const Entry = z.looseObject({
  icon: z.string().min(1).nullish(),
  color: z.union([z.string(), Rgb]).nullish(),
});

const IconicData = z.looseObject({ fileIcons: z.record(z.string(), Entry) });

/// A colour this app is willing to put in a style attribute.
///
/// A hex value, or a bare word - which covers Iconic's nine tone names and the 149 CSS colour names
/// alike, and is answered in `iconTone`. Everything else is dropped: the value is written by another
/// application into an attribute the browser parses, and a narrow allow-list is cheaper to be sure
/// about than a list of things to forbid.
const PLAIN_COLOUR = /^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[a-zA-Z]+)$/;

function colourOf(raw: unknown): string | null {
  if (typeof raw === "string") return PLAIN_COLOUR.test(raw) ? raw : null;
  const rgb = Rgb.safeParse(raw);
  if (!rgb.success) return null;
  const { r, g, b } = rgb.data;
  const whole = [r, g, b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
  return whole ? `rgb(${r}, ${g}, ${b})` : null;
}

export function parseObsidianIcons(raw: unknown): IconMap {
  const parsed = IconicData.safeParse(raw);
  if (!parsed.success) return NO_ICONS;

  const entries = Object.entries(parsed.data.fileIcons);
  if (entries.length > ICON_LIMIT) return NO_ICONS;

  const map: Record<string, IconAssignment> = {};
  for (const [path, entry] of entries) {
    if (path === "" || typeof entry.icon !== "string" || entry.icon === "") continue;
    map[path] = { icon: entry.icon, colour: colourOf(entry.color) };
  }
  return map;
}

/// The assignment for one workspace-relative path, or null.
///
/// Iconic keys folders by their path with no extension and files by their path with one, which is
/// exactly how this app names them too, so no translation is needed - only the workspace id has to
/// be off the front, which is the caller's job.
export function iconFor(map: IconMap, path: string): IconAssignment | null {
  return Object.prototype.hasOwnProperty.call(map, path) ? (map[path] ?? null) : null;
}
```

- [ ] **Step 4: Export it**

Add to `packages/domain/src/index.ts`, beside the other Obsidian exports:

```ts
export * from "./obsidianIcons";
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --root packages/domain obsidianIcons`
Expected: PASS, all cases.

If `z.looseObject` is not available on the pinned zod version, use `z.object({...}).passthrough()` instead and keep every test unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/obsidianIcons.ts packages/domain/src/obsidianIcons.test.ts packages/domain/src/index.ts
git commit -m "Read the Iconic plugin's icon assignments"
```

---

## Task 2: The channel

**Files:**
- Modify: `packages/domain/src/ipc.ts`
- Test: `packages/domain/src/ipc.test.ts`

**Interfaces:**
- Consumes: `IconMap` from Task 1
- Produces: `IconsRequest` (zod, `{ workspaceId: string }`), `IconMapSchema` (zod, a record of `{ icon, colour }`), `"icons:map"` in `IPC_CHANNELS`

- [ ] **Step 1: Write the failing test**

Add to `packages/domain/src/ipc.test.ts`:

```ts
describe("the icons channel", () => {
  it("is enumerated", () => {
    expect(IPC_CHANNELS).toContain("icons:map");
  });

  it("takes a workspace id and nothing else", () => {
    expect(IconsRequest.safeParse({ workspaceId: "Notes" }).success).toBe(true);
    expect(IconsRequest.safeParse({ workspaceId: "" }).success).toBe(false);
    expect(IconsRequest.safeParse({ workspaceId: "Notes", path: "../x" }).success).toBe(false);
    expect(IconsRequest.safeParse({}).success).toBe(false);
  });

  it("validates the map it answers with", () => {
    expect(IconMapSchema.safeParse({ Projects: { icon: "lucide-folder", colour: null } }).success).toBe(true);
    expect(IconMapSchema.safeParse({ Projects: { icon: "lucide-folder", colour: "blue" } }).success).toBe(true);
    expect(IconMapSchema.safeParse({ Projects: { icon: "", colour: null } }).success).toBe(false);
    expect(IconMapSchema.safeParse({ Projects: { icon: "lucide-folder" } }).success).toBe(false);
  });
});
```

Add `IconsRequest` and `IconMapSchema` to the existing import at the top of that file.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --root packages/domain ipc`
Expected: FAIL - the names are not exported.

- [ ] **Step 3: Add them**

In `packages/domain/src/ipc.ts`, add `"icons:map",` to `IPC_CHANNELS` after `"graph:refresh",`, and beside the graph schemas add:

```ts
/// The icons an open vault has assigned, by workspace id. Only an id ever crosses - never the path
/// to another application's data directory, which the main process works out for itself.
export const IconsRequest = z.object({ workspaceId: z.string().min(1) }).strict();

export const IconMapSchema = z.record(
  z.string().min(1),
  z.object({ icon: z.string().min(1), colour: z.string().nullable() }).strict(),
);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root packages/domain ipc`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/ipc.ts packages/domain/src/ipc.test.ts
git commit -m "Add the icons channel to the IPC surface"
```

---

## Task 3: Serving the map from the main process

**Files:**
- Modify: `apps/desktop/src/ipcHandlers.js`
- Modify: `apps/desktop/src/preload.js`
- Test: `apps/desktop/src/ipcHandlers.test.js`

**Interfaces:**
- Consumes: `IconsRequest`, `OBSIDIAN_ICONS_FILE`, `parseObsidianIcons`, `NO_ICONS`
- Produces: the `icons:map` handler answering `{ ok: true, icons: IconMap }`, and `workspaceIcons(workspaceId)` on the preload bridge

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/ipcHandlers.test.js`, following the shape of the existing graph handler tests:

```js
test("answers a vault's icon assignments, read through the provider", async () => {
  const harness = await openedWorkspace({
    files: {
      ".obsidian/plugins/iconic/data.json": JSON.stringify({
        fileIcons: { Projects: { icon: "lucide-folder-git-2" }, "Projects/Charter.md": { icon: "lucide-scroll-text", color: "blue" } },
      }),
    },
  });
  const answer = await harness.invoke("icons:map", { workspaceId: harness.workspaceId });
  assert.deepEqual(answer, {
    ok: true,
    icons: {
      Projects: { icon: "lucide-folder-git-2", colour: null },
      "Projects/Charter.md": { icon: "lucide-scroll-text", colour: "blue" },
    },
  });
});

test("answers an empty map when there is no icon plugin", async () => {
  const harness = await openedWorkspace({ files: {} });
  assert.deepEqual(await harness.invoke("icons:map", { workspaceId: harness.workspaceId }), { ok: true, icons: {} });
});

test("answers an empty map when the plugin's file is not JSON", async () => {
  const harness = await openedWorkspace({ files: { ".obsidian/plugins/iconic/data.json": "{ not json" } });
  assert.deepEqual(await harness.invoke("icons:map", { workspaceId: harness.workspaceId }), { ok: true, icons: {} });
});

test("refuses a malformed icons request", async () => {
  const harness = await openedWorkspace({ files: {} });
  assert.deepEqual(await harness.invoke("icons:map", { workspaceId: harness.workspaceId, path: "../secrets" }), {
    ok: false,
    reason: "bad-request",
  });
});

test("refuses an icons request for a workspace that is not open", async () => {
  const harness = await openedWorkspace({ files: {} });
  assert.deepEqual(await harness.invoke("icons:map", { workspaceId: "Nowhere" }), { ok: false, reason: "no-workspace" });
});
```

Match the existing helpers in that file - if it does not have `openedWorkspace`, use whatever the graph handler tests use to open a fake workspace and seed files, and keep the assertions exactly as above.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test apps/desktop/src/ipcHandlers.test.js`
Expected: FAIL - no handler registered for `icons:map`.

- [ ] **Step 3: Write the handler**

In `apps/desktop/src/ipcHandlers.js`, add `IconsRequest`, `OBSIDIAN_ICONS_FILE`, `parseObsidianIcons` and `NO_ICONS` to the `@trypthos/domain` require, and register the handler beside `graph:refresh`:

```js
  /// The icons a vault has had assigned in Obsidian, by workspace id.
  ///
  /// Read through the provider, exactly as `.obsidian/app.json` is for the graph, so the boundary
  /// guard applies and a repository-backed vault works through the same call. The renderer never
  /// names the plugin's directory.
  ///
  /// Every failure is an empty map. Another application's private format failing to parse is not
  /// something the user can act on, and an error banner about it would be noise.
  ipcMain.handle(
    "icons:map",
    guarded(locateById, IconsRequest, async (_request, workspace) => {
      try {
        const file = await workspace.provider.read(OBSIDIAN_ICONS_FILE);
        if (!file.ok) return { ok: true, icons: NO_ICONS };
        return { ok: true, icons: parseObsidianIcons(JSON.parse(file.content)) };
      } catch {
        return { ok: true, icons: NO_ICONS };
      }
    }),
  );
```

If `workspace.provider` is not how the other handlers reach the provider, follow whatever `graph:snapshot` and `vaultIndex.js` do - the point is that the read goes through the provider and the guard, never through `fs`.

- [ ] **Step 4: Expose it on the bridge**

In `apps/desktop/src/preload.js`, beside `refreshGraph`:

```js
  /// The icons an Obsidian vault has assigned, by workspace id. A map of paths to icon names -
  /// never a file's contents, and never the path to the plugin's own directory.
  workspaceIcons: (workspaceId) => ipcRenderer.invoke("icons:map", { workspaceId }),
```

- [ ] **Step 5: Run the tests**

Run: `node --test apps/desktop/src/ipcHandlers.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/ipcHandlers.js apps/desktop/src/preload.js apps/desktop/src/ipcHandlers.test.js
git commit -m "Serve a vault's icon assignments through the provider"
```

---

## Task 4: The nine tones

**Files:**
- Create: `apps/app/src/lib/iconTone.ts`
- Create: `apps/app/src/lib/iconTone.test.ts`
- Modify: `apps/app/src/index.css`
- Modify: `apps/app/src/lib/theme.browser.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `ICON_TONES: Record<string, string>`, `toneColour(colour: string | null): string | undefined`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/lib/iconTone.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ICON_TONES, toneColour } from "./iconTone";

/// Iconic's nine tones resolve against the Obsidian theme the vault is using, which this app cannot
/// read. They are therefore translated to tokens of our own, so a red folder is red in both themes
/// here rather than a value that only works in one.

describe("an icon's colour", () => {
  it("translates each of Iconic's nine tones to a token", () => {
    expect(Object.keys(ICON_TONES).sort()).toEqual(
      ["blue", "cyan", "gray", "green", "orange", "pink", "purple", "red", "yellow"],
    );
    for (const token of Object.values(ICON_TONES)) expect(token.startsWith("var(--tp-tone-")).toBe(true);
  });

  it("uses the token for a named tone", () => {
    expect(toneColour("red")).toBe("var(--tp-tone-red)");
    expect(toneColour("BLUE")).toBe("var(--tp-tone-blue)");
  });

  it("passes a value the user chose through as given", () => {
    expect(toneColour("#3f6dd1")).toBe("#3f6dd1");
    expect(toneColour("rebeccapurple")).toBe("rebeccapurple");
    expect(toneColour("rgb(12, 200, 255)")).toBe("rgb(12, 200, 255)");
  });

  // No colour means the icon takes the colour of the row it sits in, like every other glyph.
  it("says nothing when there is no colour", () => {
    expect(toneColour(null)).toBe(undefined);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --root apps/app iconTone`
Expected: FAIL - cannot resolve `./iconTone`

- [ ] **Step 3: Write the module**

Create `apps/app/src/lib/iconTone.ts`:

```ts
/// What colour an Iconic assignment is drawn in.
///
/// Iconic's nine named tones resolve against the Obsidian theme the vault is using. This app cannot
/// read that theme, so each name is translated to a token of our own, answered in both themes - a
/// hex written here would be right in one theme and wrong in the other.
///
/// Anything else is a value the user chose explicitly, so it is passed through as given. That is
/// the one place in this app where a colour does not come from a token, and it is deliberate: the
/// alternative is quietly changing a colour somebody picked.

export const ICON_TONES: Record<string, string> = {
  red: "var(--tp-tone-red)",
  orange: "var(--tp-tone-orange)",
  yellow: "var(--tp-tone-yellow)",
  green: "var(--tp-tone-green)",
  cyan: "var(--tp-tone-cyan)",
  blue: "var(--tp-tone-blue)",
  purple: "var(--tp-tone-purple)",
  pink: "var(--tp-tone-pink)",
  gray: "var(--tp-tone-gray)",
};

export function toneColour(colour: string | null): string | undefined {
  if (colour === null) return undefined;
  return ICON_TONES[colour.toLowerCase()] ?? colour;
}
```

- [ ] **Step 4: Add the tokens**

In `apps/app/src/index.css`, add to the light `:root` block beside `--tp-graph-dim`:

```css
  /* Iconic's nine tones. The plugin resolves these against the Obsidian theme in use, which this
     app cannot read, so they are answered here instead - and in both themes, because an icon set
     in Obsidian is read in whichever theme Trypthos happens to be in. */
  --tp-tone-red: #dc2626;
  --tp-tone-orange: #c2410c;
  --tp-tone-yellow: #a16207;
  --tp-tone-green: #15803d;
  --tp-tone-cyan: #0e7490;
  --tp-tone-blue: #2f6bed;
  --tp-tone-purple: #7c3aed;
  --tp-tone-pink: #be185d;
  --tp-tone-gray: #737373;
```

And in **both** dark blocks - the `@media (prefers-color-scheme: dark)` one and the `[data-theme="dark"]` one - the same names with:

```css
  --tp-tone-red: #f87171;
  --tp-tone-orange: #fb923c;
  --tp-tone-yellow: #fbbf24;
  --tp-tone-green: #4ade80;
  --tp-tone-cyan: #22d3ee;
  --tp-tone-blue: #60a5fa;
  --tp-tone-purple: #a78bfa;
  --tp-tone-pink: #f472b6;
  --tp-tone-gray: #9ca3af;
```

- [ ] **Step 5: Add them to the token inventory**

In `apps/app/src/lib/theme.browser.test.tsx`, add to the `names` array:

```ts
      "--tp-tone-red", "--tp-tone-orange", "--tp-tone-yellow", "--tp-tone-green", "--tp-tone-cyan",
      "--tp-tone-blue", "--tp-tone-purple", "--tp-tone-pink", "--tp-tone-gray",
```

That test asserts every listed token is answered in both themes and differs between them, which each of these does.

- [ ] **Step 6: Run both**

Run: `npx vitest run --root apps/app iconTone` then `npx vitest run --root apps/app --config vitest.browser.config.ts theme.browser`
Expected: PASS for both.

- [ ] **Step 7: Commit**

Use the byte-preserving remix script before committing, because `index.css` is stored with mixed line endings and the editor tools flatten it:

```bash
python C:/Users/kenha/AppData/Local/Temp/claude/D--Repositories-Trypthos/6f280747-2f1d-442b-b5da-eaf04edf099c/scratchpad/remix.py apps/app/src/index.css apps/app/src/lib/theme.browser.test.tsx
git add apps/app/src/lib/iconTone.ts apps/app/src/lib/iconTone.test.ts apps/app/src/index.css apps/app/src/lib/theme.browser.test.tsx
git commit -m "Answer Iconic's nine tones with tokens of our own"
```

Check `git diff --stat` before committing: `index.css` should show about 25 changed lines, not 800. If it shows the whole file, the line endings were flattened and the remix script has not been run.

---

## Task 5: Lucide, loaded lazily and drawn safely

**Files:**
- Create: `apps/app/src/lib/lucideIcons.ts`
- Create: `apps/app/src/lib/lucideIcons.test.ts`
- Create: `apps/app/src/components/AssignedIcon.tsx`
- Create: `apps/app/src/components/AssignedIcon.test.tsx`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: `IconAssignment` from Task 1, `toneColour` from Task 4
- Produces: `lucideName(icon: string): string | null`, `isEmojiIcon(icon: string): boolean`, `safeNodes(raw: unknown): IconNode[]`, `loadLucideIcons(): Promise<Record<string, unknown>>`, and `<AssignedIcon assignment={...} className="..." />`

- [ ] **Step 1: Add the dependency**

```bash
npm install --save-exact lucide-static@1.47.0
```

`lucide-static` is ISC licensed and has no `exports` field, so `lucide-static/icon-nodes.json` resolves. Only that one file is used: 1,848 icons as arrays of `[element, attributes]`.

If `npm install` rewrites unrelated entries in `package-lock.json`, check the diff and keep only the `lucide-static` addition plus the five version entries; a loose install must not churn dependency resolution.

- [ ] **Step 2: Write the failing test for the module**

Create `apps/app/src/lib/lucideIcons.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isEmojiIcon, loadLucideIcons, lucideName, safeNodes } from "./lucideIcons";

/// Lucide's data is ours, from a pinned dependency, so this is not a sanitiser. It is an allow-list,
/// which is a cheaper thing to be sure about: a future version of the set that introduced an element
/// or an attribute nobody had reviewed would be dropped rather than rendered.

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
    expect(safeNodes([["script", { d: "x" }], ["foreignObject", {}], ["image", { href: "http://example.test/x" }]])).toEqual([]);
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
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run --root apps/app lucideIcons`
Expected: FAIL - cannot resolve `./lucideIcons`

- [ ] **Step 4: Write the module**

Create `apps/app/src/lib/lucideIcons.ts`:

```ts
/// Lucide's icons, which is what Iconic's ids name.
///
/// **Lazy, always.** The set is 1,848 icons and 417KB minified - far too much for the initial
/// bundle, and needed only by a vault that has actually assigned icons. `iconBundle.test.ts` is what
/// keeps it that way, because a static import here would type-check and render perfectly while
/// putting the whole set on every page load.
///
/// The allow-lists below are not a sanitiser. The data is ours, from a pinned dependency, and these
/// seven elements and sixteen attributes are everything the whole set uses today. They are here so
/// that a future version introducing markup nobody reviewed is dropped rather than drawn.

export type IconNode = readonly [string, Readonly<Record<string, string>>];

const ELEMENTS = new Set(["path", "circle", "ellipse", "line", "polygon", "polyline", "rect"]);

const ATTRIBUTES = new Set([
  "cx", "cy", "d", "fill", "height", "points", "r", "rx", "ry", "width", "x", "x1", "x2", "y", "y1", "y2",
]);

/// Iconic writes `lucide-<kebab-name>`. The pattern is narrow deliberately: the name becomes a key
/// in a lookup, and a name with a slash or a dot in it is a name this app has misread.
const LUCIDE_ID = /^lucide-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function lucideName(icon: string): string | null {
  return LUCIDE_ID.exec(icon)?.[1] ?? null;
}

/// Anything that is not a Lucide id is drawn as text, which is what an emoji assignment is.
export function isEmojiIcon(icon: string): boolean {
  return lucideName(icon) === null;
}

export function safeNodes(raw: unknown): IconNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes: IconNode[] = [];
  for (const node of raw) {
    if (!Array.isArray(node) || node.length < 2) return [];
    const [element, attributes] = node as [unknown, unknown];
    if (typeof element !== "string") return [];
    if (!ELEMENTS.has(element)) continue;
    if (attributes === null || typeof attributes !== "object") continue;
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(attributes as Record<string, unknown>)) {
      if (ATTRIBUTES.has(name) && typeof value === "string") kept[name] = value;
    }
    nodes.push([element, kept]);
  }
  return nodes;
}

let loading: Promise<Record<string, unknown>> | null = null;

/// The whole set, fetched once. The promise is cached rather than the result, so two rows asking at
/// the same moment share one request instead of racing.
export function loadLucideIcons(): Promise<Record<string, unknown>> {
  loading ??= import("lucide-static/icon-nodes.json").then(
    (module) => (module.default ?? module) as Record<string, unknown>,
  );
  return loading;
}
```

- [ ] **Step 5: Run the module tests**

Run: `npx vitest run --root apps/app lucideIcons`
Expected: PASS

- [ ] **Step 6: Write the failing test for the component**

Create `apps/app/src/components/AssignedIcon.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AssignedIcon from "./AssignedIcon";

/// What an assignment looks like on a row. The icon is decoration beside a name that says the same
/// thing, so it is hidden from assistive technology exactly as every other glyph in the app is.

const mark = () => document.querySelector('[data-testid="assigned-icon"]');

describe("an assigned icon", () => {
  it("draws a Lucide icon as real paths", async () => {
    render(<AssignedIcon assignment={{ icon: "lucide-calendar-days", colour: null }} className="size-3.5" />);
    await waitFor(() => expect(mark()?.querySelectorAll("path, rect, circle, line, polygon, polyline, ellipse").length).toBeGreaterThan(0));
    expect(mark()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws an emoji as text", () => {
    render(<AssignedIcon assignment={{ icon: "\u{1F680}", colour: null }} className="size-3.5" />);
    expect(screen.getByTestId("assigned-icon").textContent).toBe("\u{1F680}");
  });

  it("takes the colour the user chose", async () => {
    render(<AssignedIcon assignment={{ icon: "lucide-calendar-days", colour: "red" }} className="size-3.5" />);
    await waitFor(() => expect(mark()?.getAttribute("style")).toContain("var(--tp-tone-red)"));
  });

  // An id the set does not hold must leave the row with the glyph it already had, rather than a gap
  // where an icon should be.
  it("draws nothing for an icon Lucide does not have", async () => {
    const { container } = render(
      <AssignedIcon assignment={{ icon: "lucide-not-a-real-icon", colour: null }} className="size-3.5" />,
    );
    await waitFor(() => expect(container.querySelector('[data-testid="assigned-icon"]')).toBe(null));
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run --root apps/app AssignedIcon`
Expected: FAIL - cannot resolve `./AssignedIcon`

- [ ] **Step 8: Write the component**

Create `apps/app/src/components/AssignedIcon.tsx`:

```tsx
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
/// Rendering nothing is a real answer. An id the set does not hold, or a set that failed to load,
/// leaves the row with the glyph it already had, which is the right thing to see.

export default function AssignedIcon({
  assignment,
  className,
}: {
  assignment: IconAssignment;
  className: string;
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
    if (!isEmojiIcon(assignment.icon)) return null;
    return (
      <span
        data-testid="assigned-icon"
        aria-hidden="true"
        style={colour === undefined ? undefined : { color: colour }}
        className={`${className} shrink-0 grid place-items-center text-[0.9em] leading-none`}
      >
        {assignment.icon}
      </span>
    );
  }

  if (nodes === null || nodes.length === 0) return null;

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
      {nodes.map(([element, attributes], index) =>
        // The element name is one of seven the allow-list holds, and every attribute is one of
        // sixteen, so this is a fixed set of SVG primitives rather than arbitrary markup.
        createSvgNode(element, attributes, index),
      )}
    </svg>
  );
}

function createSvgNode(element: string, attributes: Readonly<Record<string, string>>, key: number) {
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
```

A `switch` rather than `createElement(element, ...)`, for the same reason `SourceGlyph` is one: an element name added to the allow-list and forgotten here is a type error rather than dynamic markup.

- [ ] **Step 9: Run the component tests**

Run: `npx vitest run --root apps/app AssignedIcon`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json apps/app/src/lib/lucideIcons.ts apps/app/src/lib/lucideIcons.test.ts apps/app/src/components/AssignedIcon.tsx apps/app/src/components/AssignedIcon.test.tsx
git commit -m "Draw Lucide icons from a lazily loaded set"
```

---

## Task 6: Keeping the Lucide set out of the initial bundle

**Files:**
- Create: `apps/app/src/testing/moduleGraph.ts`
- Create: `apps/app/src/lib/iconBundle.test.ts`
- Modify: `apps/app/src/lib/graphBundle.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `sourceFiles(dir: string): string[]`, `offenders(root: string, pattern: RegExp, allowed: ReadonlySet<string>): string[]`, `STATIC_LOAD: string`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/lib/iconBundle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";
import { offenders, STATIC_LOAD } from "../testing/moduleGraph";

/// Lucide's icon set stays out of the initial bundle.
///
/// It is 417KB minified and wanted only by a vault that has assigned icons. Nothing but who imports
/// what enforces that: a static import of the JSON type-checks, renders and passes every other test
/// while putting 1,848 icons on every page load. So `lucideIcons.ts` is the only module allowed to
/// name it, and it reaches it through `import(...)`.

const SRC = repoPath("apps", "app", "src");

const ICON_ONLY = new Set(["lib/lucideIcons.ts"]);

const LUCIDE_IMPORT = new RegExp(`^\\s*${STATIC_LOAD}["']lucide-static(?:\\/[^"']*)?["']`, "m");

describe("the Lucide set stays out of the initial bundle", () => {
  it("is named only by the module that loads it lazily", () => {
    expect(offenders(SRC, LUCIDE_IMPORT, ICON_ONLY)).toEqual([]);
  });

  it("would catch a static import if one appeared", () => {
    expect(LUCIDE_IMPORT.test('import nodes from "lucide-static/icon-nodes.json";')).toBe(true);
    expect(LUCIDE_IMPORT.test('import "lucide-static";')).toBe(true);
    expect(LUCIDE_IMPORT.test('export * from "lucide-static";')).toBe(true);
    expect(LUCIDE_IMPORT.test('import type { IconNode } from "lucide-static";')).toBe(false);
    expect(LUCIDE_IMPORT.test('const icons = await import("lucide-static/icon-nodes.json");')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --root apps/app iconBundle`
Expected: FAIL - cannot resolve `../testing/moduleGraph`

- [ ] **Step 3: Extract the shared helper**

Create `apps/app/src/testing/moduleGraph.ts` by moving `STATIC_LOAD`, `sourceFiles` and `offenders` out of `graphBundle.test.ts`, with `offenders` taking its root and its allowed set as arguments:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripComments } from "./stripComments";

/// Walking the renderer's source to ask what imports what.
///
/// Shared by the bundle guards, which all ask the same question about different libraries: is this
/// reached eagerly by anything that is not allowed to reach it eagerly? Two copies of the import
/// pattern would eventually disagree, and the one that was wrong would be the one that silently
/// stopped catching anything.

/// Every way a module can be pulled in at load time, and no way it cannot.
///
/// Three branches, because a static import wears three faces: `import x from "y"`, the side-effect
/// `import "y"`, and the re-export `export * from "y"` - which loads the module just as eagerly
/// while looking nothing like an import. `import type` and `export type` are excluded: they vanish
/// at compile time and cost the bundle nothing. `import("y")` has no leading `import` keyword at the
/// start of a line and so cannot match, which is the whole point.
export const STATIC_LOAD = String.raw`(?:import\s+(?!type\b)[^;]*?from\s+|import\s+|export\s+(?!type\b)[^;]*?from\s+)`;

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__screenshots__") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

export function offenders(root: string, pattern: RegExp, allowed: ReadonlySet<string>): string[] {
  return sourceFiles(root)
    .map((file) => ({ file: relative(root, file).split(sep).join("/"), text: stripComments(readFileSync(file, "utf8")) }))
    .filter(({ file, text }) => pattern.test(text) && !allowed.has(file))
    .map(({ file }) => file);
}
```

Then rewrite `graphBundle.test.ts` to import `STATIC_LOAD` and `offenders` from it, delete its local copies, and call `offenders(SRC, LIBRARY_IMPORT, GRAPH_ONLY)` and `offenders(SRC, GRAPH_MODULE_IMPORT, GRAPH_ONLY)`. Every assertion in that file stays exactly as it is.

- [ ] **Step 4: Run both guards**

Run: `npx vitest run --root apps/app Bundle`
Expected: PASS for `graphBundle` and `iconBundle`.

- [ ] **Step 5: Prove the guard catches a real regression**

Temporarily add `import nodes from "lucide-static/icon-nodes.json";` to the top of `apps/app/src/components/WorkspacePanel.tsx`, run `npx vitest run --root apps/app iconBundle`, confirm it FAILS naming that file, then remove the import and confirm it passes again. A guard that has never failed is a guard nobody has tested.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/testing/moduleGraph.ts apps/app/src/lib/iconBundle.test.ts apps/app/src/lib/graphBundle.test.ts
git commit -m "Keep the Lucide set out of the initial bundle"
```

---

## Task 7: Fetching one map per workspace

**Files:**
- Create: `apps/app/src/hooks/useWorkspaceIcons.ts`
- Create: `apps/app/src/hooks/useWorkspaceIcons.test.ts`
- Modify: `apps/app/src/lib/workspaceClient.ts`

**Interfaces:**
- Consumes: `IconMap`, `NO_ICONS` from Task 1
- Produces: `useWorkspaceIcons(client: IconsClient, workspaceIds: readonly string[]): Readonly<Record<string, IconMap>>`, and `workspaceIcons(workspaceId): Promise<IconsResult>` on `WorkspaceClient`

- [ ] **Step 1: Add the client method**

In `apps/app/src/lib/workspaceClient.ts`, beside `refreshGraph` on the interface:

```ts
  /// The icons an Obsidian vault has had assigned, by workspace id. A map of workspace-relative
  /// paths to icon names - never a file's contents.
  workspaceIcons(workspaceId: string): Promise<IconsResult>;
```

with the result type beside the other result types:

```ts
export type IconsResult = { ok: true; icons: IconMap } | Failure;
```

`IconMap` comes from `@trypthos/domain`. Add `workspaceIcons: async () => unavailable(),` to `browserClient`, and add `"workspaceIcons"` to the `IconsClient` pick:

```ts
export type IconsClient = Pick<WorkspaceClient, "workspaceIcons">;
```

- [ ] **Step 2: Write the failing test**

Create `apps/app/src/hooks/useWorkspaceIcons.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceIcons } from "./useWorkspaceIcons";

/// One map per open workspace, fetched once when it opens.
///
/// There is no watcher, deliberately: icons set in Obsidian while Trypthos is open appear after a
/// refresh, which is the same contract the graph already has.

const client = (icons: Record<string, unknown>) => ({
  workspaceIcons: vi.fn(async (id: string) =>
    id in icons ? { ok: true as const, icons: icons[id] as never } : { ok: false as const, reason: "no-workspace" as const },
  ),
});

describe("a workspace's icons", () => {
  it("fetches one map for each open workspace", async () => {
    const assignments = { Notes: { Projects: { icon: "lucide-folder", colour: null } } };
    const fake = client(assignments);
    const { result } = renderHook(() => useWorkspaceIcons(fake, ["Notes"]));
    await waitFor(() => expect(result.current.Notes).toEqual(assignments.Notes));
    expect(fake.workspaceIcons).toHaveBeenCalledWith("Notes");
  });

  it("asks once per workspace, not once per render", async () => {
    const fake = client({ Notes: {} });
    const { result, rerender } = renderHook(({ ids }) => useWorkspaceIcons(fake, ids), {
      initialProps: { ids: ["Notes"] },
    });
    await waitFor(() => expect(result.current.Notes).toEqual({}));
    rerender({ ids: ["Notes"] });
    rerender({ ids: ["Notes"] });
    expect(fake.workspaceIcons).toHaveBeenCalledTimes(1);
  });

  it("forgets a workspace that has been closed", async () => {
    const fake = client({ Notes: { A: { icon: "lucide-a", colour: null } }, Ideas: {} });
    const { result, rerender } = renderHook(({ ids }) => useWorkspaceIcons(fake, ids), {
      initialProps: { ids: ["Notes", "Ideas"] },
    });
    await waitFor(() => expect(Object.keys(result.current).sort()).toEqual(["Ideas", "Notes"]));
    rerender({ ids: ["Ideas"] });
    await waitFor(() => expect(Object.keys(result.current)).toEqual(["Ideas"]));
  });

  // A refusal is not an error here. A workspace with no icon plugin, a repository, a folder that is
  // not a vault at all - every one of them answers this way, and every one means no icons.
  it("holds an empty map when the shell refuses", async () => {
    const { result } = renderHook(() => useWorkspaceIcons(client({}), ["Notes"]));
    await waitFor(() => expect(result.current.Notes).toEqual({}));
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run --root apps/app useWorkspaceIcons`
Expected: FAIL - cannot resolve `./useWorkspaceIcons`

- [ ] **Step 4: Write the hook**

Create `apps/app/src/hooks/useWorkspaceIcons.ts`:

```ts
import { useEffect, useState } from "react";
import { NO_ICONS } from "@trypthos/domain";
import type { IconMap } from "@trypthos/domain";
import type { IconsClient } from "../lib/workspaceClient";

/// The icon assignments for every open workspace, fetched once each as they open.
///
/// **No watcher.** Icons set in Obsidian while Trypthos is open appear after a refresh, which is the
/// contract the graph already has and the sentence the release notes already carry.
///
/// A refusal is not an error. A folder that is not a vault, a vault with no icon plugin and a
/// repository all answer the same way, and they all mean the tree keeps its own glyphs.

export function useWorkspaceIcons(
  client: IconsClient,
  workspaceIds: readonly string[],
): Readonly<Record<string, IconMap>> {
  const [maps, setMaps] = useState<Readonly<Record<string, IconMap>>>({});
  const key = workspaceIds.join("\u0000");

  useEffect(() => {
    let live = true;
    const ids = key === "" ? [] : key.split("\u0000");

    // Dropping what has been closed happens whether or not any fetch is needed, so a workspace that
    // has gone leaves nothing of itself behind in memory.
    setMaps((held) => {
      const kept: Record<string, IconMap> = {};
      for (const id of ids) if (id in held) kept[id] = held[id]!;
      return Object.keys(kept).length === Object.keys(held).length ? held : kept;
    });

    for (const id of ids) {
      void client.workspaceIcons(id).then(
        (answer) => {
          if (!live) return;
          setMaps((held) => (id in held ? held : { ...held, [id]: answer.ok ? answer.icons : NO_ICONS }));
        },
        () => {
          if (live) setMaps((held) => (id in held ? held : { ...held, [id]: NO_ICONS }));
        },
      );
    }

    return () => {
      live = false;
    };
    // `client` is a stable object from the module scope; `key` is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return maps;
}
```

If `react-hooks/set-state-in-effect` refuses the `setMaps` call in the effect body, move the pruning into the same `then` callbacks and keep the assertions unchanged - the rule is active in this repo and has forced this shape before.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --root apps/app useWorkspaceIcons`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/hooks/useWorkspaceIcons.ts apps/app/src/hooks/useWorkspaceIcons.test.ts apps/app/src/lib/workspaceClient.ts
git commit -m "Fetch one icon map per open workspace"
```

---

## Task 8: Splitting the row

**Files:**
- Modify: `apps/app/src/components/WorkspacePanel.tsx`
- Modify: `apps/app/src/components/WorkspacePanel.test.tsx`
- Modify: `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `DisclosureBand` and the new `indent`/`band` geometry, used by Task 9

- [ ] **Step 1: Add the strings**

In `apps/app/src/locales/en.json`, under `workspace`:

```json
    "expand": "Expand {{name}}",
    "collapse": "Collapse {{name}}",
```

- [ ] **Step 2: Write the failing tests**

Rewrite the interaction tests in `apps/app/src/components/WorkspacePanel.test.tsx`. Replace the bodies of `"selects a folder and expands it in one click"` and `"toggles the root, and points chat at it, in one click"` with these, and add the rest:

```tsx
describe("choosing a folder without opening it", () => {
  it("selects a folder and leaves it as it was", async () => {
    const panel = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "docs" }));
    expect(panel.onSelectFolder).toHaveBeenCalledWith("Diariz/docs");
    expect(panel.onToggleFolder).not.toHaveBeenCalled();
  });

  it("opens a folder from its band without changing what chat is mapping", async () => {
    const panel = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Expand docs" }));
    expect(panel.onToggleFolder).toHaveBeenCalledWith("Diariz/docs");
    expect(panel.onSelectFolder).not.toHaveBeenCalled();
  });

  it("names the band for what it would do next", async () => {
    renderPanel({ expanded: ["Diariz/docs"] });
    expect(screen.getByRole("button", { name: "Collapse docs" })).toBeTruthy();
  });

  it("carries the expanded state on the band, and the selection on the row", async () => {
    const panel = renderPanel({ selectedFolder: "Diariz/docs", expanded: ["Diariz/docs"] });
    expect(screen.getByRole("button", { name: "Collapse docs" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "docs" }).getAttribute("aria-current")).toBe("true");
    expect(panel.onToggleFolder).not.toHaveBeenCalled();
  });

  // Two buttons per row would double the Tab stops down a tree of any size, so the band is out of
  // the Tab order and the arrows do its job instead - the standard tree gesture.
  it("keeps the band out of the tab order", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Expand docs" }).getAttribute("tabindex")).toBe("-1");
  });

  it("expands and collapses with the arrow keys", async () => {
    const panel = renderPanel();
    screen.getByRole("button", { name: "docs" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(panel.onToggleFolder).toHaveBeenCalledWith("Diariz/docs");
  });
});

describe("a workspace root's two controls", () => {
  it("opens the root's page from the row, and does not expand it", async () => {
    const panel = renderPanel({ workspaces: [RESEARCH] });
    await userEvent.click(screen.getByRole("button", { name: "Research" }));
    expect(panel.onOpenGraphPage).toHaveBeenCalledWith("Research");
    expect(panel.onSelectFolder).toHaveBeenCalledWith("Research");
    expect(panel.onToggleFolder).not.toHaveBeenCalled();
  });

  it("expands the root from its band, and opens nothing", async () => {
    const panel = renderPanel({ workspaces: [RESEARCH] });
    await userEvent.click(screen.getByRole("button", { name: "Expand Research" }));
    expect(panel.onToggleFolder).toHaveBeenCalledWith("Research");
    expect(panel.onOpenGraphPage).not.toHaveBeenCalled();
    expect(panel.onSelectFolder).not.toHaveBeenCalled();
  });

  it("still closes from the cross, and only that", async () => {
    const panel = renderPanel({ workspaces: [RESEARCH] });
    await userEvent.click(screen.getByRole("button", { name: "Close Research" }));
    expect(panel.onCloseWorkspace).toHaveBeenCalledWith("Research");
    expect(panel.onToggleFolder).not.toHaveBeenCalled();
    expect(panel.onSelectFolder).not.toHaveBeenCalled();
  });
});

describe("the band while filtering", () => {
  // Filter results have nothing to collapse, so there is no control - not a control that does
  // nothing, which is worse than none at all.
  it("offers no band on a filter result", async () => {
    renderPanel({ filter: "doc" });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Expand|Collapse/ })).toBe(null));
  });
});

describe("right-clicking a row", () => {
  it("opens the menu from the band as it does from the row, and selects nothing", async () => {
    const panel = renderPanel();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Expand docs" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(panel.onSelectFolder).not.toHaveBeenCalled();
    expect(panel.onToggleFolder).not.toHaveBeenCalled();
  });
});
```

Adapt `renderPanel` and the fixture names to whatever that file already uses - the assertions are the contract, the harness is not. Also update the two existing indent tests to the new numbers: a row's icon now sits at `depth * 16 + 44`.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run --root apps/app WorkspacePanel`
Expected: FAIL - there is no button named `Expand docs`, and clicking the row still toggles.

- [ ] **Step 4: Add the geometry and the band**

In `apps/app/src/components/WorkspacePanel.tsx`, replace the `indent` helper and the `Chevron`/`ChevronSpace` pair:

```tsx
/// Rows indent by depth. The value is inline because it is computed; everything else is a class.
///
/// Everything from the icon rightwards starts after the disclosure band, so a row's content begins
/// at its own indent plus the band's width. The band itself is positioned by `band`, below.
const indent = (depth: number) => ({ paddingLeft: `${depth * INDENT + BAND}px` });

const INDENT = 16;

/// Wide enough to hit, and the same at every depth including a workspace root.
///
/// The triangle sits in the middle of it with 14px of empty band either side, which is what makes
/// this a target rather than a 16px glyph. It costs 20px of name width at every depth; if that is
/// ever felt, the cheapest recovery is a 12px indent step, not a narrower band.
const BAND = 44;

const band = (depth: number) => ({ left: `${depth * INDENT}px`, width: `${BAND}px` });
```

Then add the band component, replacing `Chevron`:

```tsx
/// The control that opens and closes a row, and the only one that does.
///
/// A row used to be one button that both selected a folder and expanded it. That was deliberate -
/// the comment said a row one word wide could not carry two gestures - and it was wrong once
/// choosing the folder chat reads became a daily act, because there was then no way to choose one
/// without expanding or collapsing it as a side effect.
///
/// `tabIndex={-1}` with the arrows on the row button instead: two buttons per row would double the
/// Tab stops down a tree of any size. It is a real button with a real name, so it is in the
/// accessibility tree; it is simply not a second stop on the way past.
function DisclosureBand({
  depth,
  open,
  name,
  onToggle,
}: {
  depth: number;
  open: boolean;
  name: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = open ? t("workspace.collapse", { name }) : t("workspace.expand", { name });

  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      title={label}
      style={band(depth)}
      className="group absolute inset-y-0 z-10 grid place-items-center rounded-md"
    >
      <Glyph className={open ? "size-4 rotate-90 text-ink-4 group-hover:text-ink-2" : "size-4 text-ink-4 group-hover:text-ink-2"}>
        <path d="M9 6l6 6-6 6" />
      </Glyph>
    </button>
  );
}
```

`ChevronSpace` is deleted: the band's width is now part of every row's padding, so a filtered row lines up without one.

- [ ] **Step 5: Rebuild the two rows**

`WorkspaceRow`: wrap the existing flex container so it is `relative`, render `<DisclosureBand depth={0} .../>` inside it when not filtering, drop the `Chevron`/`ChevronSpace` from the row button, and change the row button's `onClick` to the select-and-open half only. Its `aria-expanded` goes; `aria-current` stays. Add the arrow handler:

```tsx
        onKeyDown={(event) => {
          if (filtering) return;
          if (event.key === "ArrowRight" && !expanded) {
            event.preventDefault();
            onToggle();
          } else if (event.key === "ArrowLeft" && expanded) {
            event.preventDefault();
            onToggle();
          }
        }}
```

`FolderRow`: the same, with `depth={row.depth}` and `open={row.expanded}`, wrapped in a `relative` flex container because it has no container today.

Split each row's callback in two at the call site in the panel body. For the workspace root:

```tsx
                  onOpen={() => {
                    onSelectFolder(workspace.id);
                    // A repository's row is its home, so clicking it opens its page. Opening a tab
                    // that is already open only switches to it, so a second click costs nothing.
                    if (workspace.ref.kind === "github") onOpenRepoPage(workspace.id);
                    // A vault's row is its home too: clicking it opens the vault's graph.
                    if (workspace.ref.kind === "local" && workspace.vault === true) onOpenGraphPage(workspace.id);
                  }}
                  onToggle={() => {
                    if (!filtering) void onToggleFolder(workspace.id);
                  }}
```

and for a folder:

```tsx
                      onOpen={() => onSelectFolder(row.node.id)}
                      onToggle={() => {
                        if (!filtering) void onToggleFolder(row.node.id);
                      }}
```

Rename the props on both components from `onToggle` to `onOpen` and `onToggle` accordingly, and pass the band's `onContextMenu` the same handler the row has, so a right-click anywhere on the row opens one menu.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --root apps/app WorkspacePanel`
Expected: PASS. Then `npm run lint` and `npm run typecheck`, both clean.

- [ ] **Step 7: Commit**

```bash
python C:/Users/kenha/AppData/Local/Temp/claude/D--Repositories-Trypthos/6f280747-2f1d-442b-b5da-eaf04edf099c/scratchpad/remix.py apps/app/src/components/WorkspacePanel.tsx apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/locales/en.json
git add apps/app/src/components/WorkspacePanel.tsx apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/locales/en.json
git commit -m "Give the disclosure a target of its own, so selecting a folder leaves it alone"
```

---

## Task 9: The band, measured

**Files:**
- Create: `apps/app/src/components/WorkspacePanel.browser.test.tsx`

**Interfaces:**
- Consumes: the geometry from Task 8
- Produces: nothing

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/components/WorkspacePanel.browser.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { page, userEvent } from "@vitest/browser/context";
import { describe, expect, it, vi } from "vitest";
import WorkspacePanel from "./WorkspacePanel";

/// Where a click lands, which is the whole point of the change and the one thing jsdom cannot
/// answer. jsdom has no layout engine, so every box it reports is zero and a test of this there
/// would be a test of the polyfill.

const BAND = 44;

describe("the disclosure band", () => {
  it("is wide enough to hit at every depth", async () => {
    await page.viewport(900, 700);
    const { getByRole } = render(<Harness />);
    for (const name of ["Expand Notes", "Expand docs", "Expand guides"]) {
      const box = getByRole("button", { name }).getBoundingClientRect();
      expect({ name, wide: box.width >= BAND, tall: box.height >= 24 }).toEqual({ name, wide: true, tall: true });
    }
  });

  it("toggles from its left edge, where the triangle is not", async () => {
    await page.viewport(900, 700);
    const { getByRole, toggled } = render(<Harness />);
    const band = getByRole("button", { name: "Expand docs" });
    const box = band.getBoundingClientRect();
    await userEvent.click(band, { position: { x: 3, y: box.height / 2 } });
    expect(toggled).toHaveBeenCalledWith("Notes/docs");
  });

  it("does not toggle when the name is clicked, however close to the triangle", async () => {
    await page.viewport(900, 700);
    const { getByRole, toggled, selected } = render(<Harness />);
    await userEvent.click(getByRole("button", { name: "docs" }), { position: { x: 2, y: 10 } });
    expect(selected).toHaveBeenCalledWith("Notes/docs");
    expect(toggled).not.toHaveBeenCalled();
  });
});
```

`Harness` renders `WorkspacePanel` with an invented three-level tree - a workspace `Notes`, a folder `docs`, a folder `guides` inside it - and exposes `toggled` and `selected` as `vi.fn()`. Build it from the props the jsdom test file already assembles, so there is one description of the panel's props and not two.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --root apps/app --config vitest.browser.config.ts WorkspacePanel.browser`
Expected: FAIL first because `Harness` does not exist, then pass once it does - so write the harness, confirm it fails on a deliberately wrong `BAND` of 60, and set it back to 44.

- [ ] **Step 3: Run the whole browser suite**

Run: `npm run test:browser`
Expected: PASS, every file.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/components/WorkspacePanel.browser.test.tsx
git commit -m "Measure the disclosure band where it is actually laid out"
```

---

## Task 10: Drawing the icons on the rows

**Files:**
- Modify: `apps/app/src/components/WorkspacePanel.tsx`
- Modify: `apps/app/src/components/WorkspacePanel.test.tsx`
- Modify: `apps/app/src/App.tsx`

**Interfaces:**
- Consumes: `useWorkspaceIcons` (Task 7), `AssignedIcon` (Task 5), `iconFor` (Task 1), the rows (Task 8)
- Produces: nothing

- [ ] **Step 1: Write the failing test**

Add to `apps/app/src/components/WorkspacePanel.test.tsx`:

```tsx
describe("icons a vault has assigned in Obsidian", () => {
  const icons = { Notes: { docs: { icon: "\u{1F4D8}", colour: null }, "docs/Ada.md": { icon: "\u{1F680}", colour: "red" } } };

  it("draws a folder's assigned icon in place of the folder glyph", async () => {
    renderPanel({ icons, expanded: ["Notes/docs"] });
    const row = screen.getByRole("button", { name: "docs" });
    expect(row.querySelector('[data-testid="assigned-icon"]')?.textContent).toBe("\u{1F4D8}");
  });

  it("draws a file's assigned icon in place of the file glyph", async () => {
    renderPanel({ icons, expanded: ["Notes/docs"] });
    const row = screen.getByRole("button", { name: "Ada.md" });
    expect(row.querySelector('[data-testid="assigned-icon"]')?.textContent).toBe("\u{1F680}");
  });

  it("leaves a row with no assignment exactly as it was", async () => {
    renderPanel({ icons, expanded: ["Notes/docs"] });
    const row = screen.getByRole("button", { name: "Grace.md" });
    expect(row.querySelector('[data-testid="assigned-icon"]')).toBe(null);
  });

  // A workspace root keeps the mark that says where it came from. Which provider a workspace is
  // from matters more on that row than any icon, and Iconic has no entry for a vault's own root.
  it("leaves a workspace root's provider mark alone", async () => {
    renderPanel({ icons: { Notes: { "": { icon: "\u{1F4D8}", colour: null } } } });
    const row = screen.getByRole("button", { name: "Notes" });
    expect(row.querySelector("[data-mark]")).toBeTruthy();
    expect(row.querySelector('[data-testid="assigned-icon"]')).toBe(null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --root apps/app WorkspacePanel`
Expected: FAIL - the panel takes no `icons` prop.

- [ ] **Step 3: Thread the maps through**

Add `icons?: Readonly<Record<string, IconMap>>` to `WorkspacePanel`'s props, defaulting to `{}`. In the panel body, work out each row's assignment with `splitQualified` and `iconFor`, and hand it to the row:

```tsx
                const assigned = (id: string) => {
                  const split = splitQualified(id);
                  const map = icons[workspace.id];
                  return split === null || map === undefined ? null : iconFor(map, split.path);
                };
```

In `FolderRow` and `FileRow`, replace the hard-coded `Glyph` with:

```tsx
        {assignment === null ? (
          <Glyph className="size-3.5 shrink-0 text-leaf">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
          </Glyph>
        ) : (
          <AssignedIcon assignment={assignment} className="size-3.5" />
        )}
```

keeping each row's existing error and disabled colouring ahead of the assignment - a folder that failed to list still shows that it failed, because what is wrong with a row matters more than its decoration.

`WorkspaceRow` is not changed: a root keeps its provider mark.

- [ ] **Step 4: Wire the hook in**

In `apps/app/src/App.tsx`, beside where the panel's other props are assembled:

```tsx
  const workspaceIcons = useWorkspaceIcons(client, state.workspaces.map((workspace) => workspace.id));
```

and pass `icons={workspaceIcons}` to `<WorkspacePanel>`. Use whatever the file already calls the workspace client.

- [ ] **Step 5: Run everything**

Run: `npx vitest run --root apps/app WorkspacePanel`, then `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`.
Expected: PASS throughout, with no warnings printed.

- [ ] **Step 6: Commit**

```bash
python C:/Users/kenha/AppData/Local/Temp/claude/D--Repositories-Trypthos/6f280747-2f1d-442b-b5da-eaf04edf099c/scratchpad/remix.py apps/app/src/components/WorkspacePanel.tsx apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/App.tsx
git add apps/app/src/components/WorkspacePanel.tsx apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/App.tsx
git commit -m "Draw the icons a vault has assigned in Obsidian"
```

---

## Task 11: The release

**Files:**
- Modify: `version.json`, `package.json`, `apps/app/package.json`, `apps/desktop/package.json`, `packages/domain/package.json`, `package-lock.json`
- Modify: `apps/app/src/lib/releaseNotes/current.ts`
- Modify: `apps/app/src/lib/appInfo.ts`
- Modify: `README.md`, `docs/features.md`, `docs/Architecture.md`

- [ ] **Step 1: Bump the version**

0.84.1 to **0.85.0** - a functional enhancement, so Minor +1 and Build reset. Change `version.json`, the four manifests, and **exactly five** entries in `package-lock.json`: the top-level `version`, `packages[""]`, `packages["apps/app"]`, `packages["apps/desktop"]`, `packages["packages/domain"]`. Count the matches of `"version": "0.84.1"` before and after; if there are more than five, a dependency shares the string and a find-and-replace has silently rewritten it.

- [ ] **Step 2: Add the release entry**

At the top of `RECENT` in `apps/app/src/lib/releaseNotes/current.ts`, with `pr` set to the number `gh pr create` will report - confirm it rather than assuming, since it is usually the last issue number plus one:

```ts
  {
    version: "0.85.0",
    date: "<the day it is written>",
    pr: 0,
    headline: "Pick a folder for chat without opening it, and see your Obsidian icons",
    summary:
      "Clicking a folder in the browser used to do two things at once: point chat at it, and open or close it. Now the triangle has a target of its own, and clicking the icon or the name selects the folder and leaves it exactly as it was. The triangle is larger, and the area around it counts as part of it, so it is easier to hit. Arrow keys open and close a folder too. On top of that, a vault whose folders and notes have icons assigned with Obsidian's Iconic plugin now shows those icons in the tree instead of the plain folder and file marks, in the colour you chose. Icons set in Obsidian while Trypthos is open appear after a refresh.",
    added: [
      "Icons assigned in Obsidian with the Iconic plugin are shown on folders and files in the browser.",
      "Left and Right arrows open and close the folder a row is on.",
    ],
    changed: [
      "Clicking a folder's icon or name selects it for chat without opening or closing it. The triangle, and the space around it, is what opens and closes now.",
      "The disclosure triangle is larger, with a wider area around it to click.",
    ],
  },
```

- [ ] **Step 3: Update the About box**

In `apps/app/src/lib/appInfo.ts`, edit the **Workspace browser** capability row to say that the triangle opens a folder while the icon or name selects it, and add Obsidian's assigned icons. Add to `DISCLAIMERS`:

```ts
  "Icons assigned in an Obsidian vault are drawn with the Lucide icon set, loaded only when a vault that uses them is open.",
```

- [ ] **Step 4: Update the README and the feature list**

Update the **Workspace browser** row in `README.md`'s Features table and the matching bullet in `docs/features.md`, in lockstep, saying the same two things in the same words.

- [ ] **Step 5: Update the architecture doc**

In `docs/Architecture.md`: add `icons:map` to the IPC channel list and adjust the count sentence if there is one, note `lucide-static` as an external dependency, and record that the app reads one file from another application's data directory - Iconic's `data.json` - read-only, through the provider and the boundary guard, with every failure meaning no icons.

- [ ] **Step 6: Run the guards**

Run: `npx vitest run --root apps/app versionMirrors releases i18nKeys`
Expected: PASS. Then the whole suite: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`.

- [ ] **Step 7: Check the diff for line-ending churn**

```bash
git diff --stat
```

Every file should show a change proportional to the edit. If one shows its whole length, run the remix script on it before committing.

- [ ] **Step 8: Commit, push and open the PR**

```bash
git add -A
git commit -m "Release 0.85.0"
git push -u origin spec/workspace-tree-rows
```

Then `gh pr create` with a body that covers: what changed and why, the reversal of the one-button row and the argument it answers, that Obsidian has no folder icons of its own so this reads a community plugin's file and degrades silently, the new dependency, the tests that hold each rule, and a deployment-surface line saying it needs a release.

---

## Self-review

**Spec coverage.** Row anatomy, Task 8. The 44px geometry and the 16px triangle, Task 8, measured in Task 9. Click semantics, Tasks 8 and 10. Keyboard and ARIA, Task 8. The Iconic file and its schema, Task 1. Reading it in the main process, Tasks 2 and 3. Lazy Lucide and the allow-list, Tasks 5 and 6. Colour, Task 4. Failure modes, covered by a test in whichever task owns each one. Testing table, Tasks 1 through 10. Release checklist, Task 11.

**Gaps found and closed while reviewing.** The spec's `iconBundle.test.ts` needed a shared walker or a second copy of the import pattern, so Task 6 extracts one. The spec did not say what happens to `ChevronSpace`; Task 8 deletes it, because the band's width is now in every row's padding. The spec did not say whether a workspace root gets an assigned icon; Task 10 says it does not, and tests that, because a root's mark says which provider it came from and that matters more there.

**Names used consistently throughout:** `parseObsidianIcons`, `iconFor`, `IconMap`, `IconAssignment` (`icon`, `colour` - British spelling on ours, `color` only where Iconic's own field is read), `NO_ICONS`, `ICON_LIMIT`, `OBSIDIAN_ICONS_FILE`, `IconsRequest`, `IconMapSchema`, `workspaceIcons`, `IconsResult`, `IconsClient`, `useWorkspaceIcons`, `toneColour`, `ICON_TONES`, `lucideName`, `isEmojiIcon`, `safeNodes`, `loadLucideIcons`, `AssignedIcon`, `DisclosureBand`, `INDENT`, `BAND`, `band`, `indent`.
