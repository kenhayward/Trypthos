# Workspace tree rows: separate the disclosure from the row, and show Obsidian's icons

**Status:** approved, not yet implemented
**Ships as:** one PR, version 0.85.0

Two changes to the same rows in the folder browser, shipped together because they touch the same
markup and would otherwise conflict.

1. **A row stops meaning two things at once.** Today one click on a folder both selects it for chat
   and expands it. The disclosure moves into a target of its own, and the rest of the row selects.
2. **A vault's folder and file icons follow Obsidian.** Where the Iconic plugin has assigned icons,
   the tree draws them instead of the generic folder and file glyphs.

A companion spec, written after this one, extends the graph to folders that are not vaults and gives
every workspace a home page. Nothing here depends on it.

---

## Why the row is being split, when it was deliberately joined

`WorkspacePanel.tsx` currently says, in a comment on the props:

> Clicking a folder both selects it and expands or collapses it - one click, because a row that
> needed two different gestures for two different meanings would need two different targets, and
> this row is one word wide.

That reasoning was sound when the only consumer of "selected" was a label. It is wrong now, because
**picking a folder for chat is a frequent, deliberate act** and it is the one gesture the user cannot
perform without a side effect. Choosing the folder chat should read collapses the folder they were
looking at, or expands one they did not want open. The cost of the second target - a narrower name
column - is smaller than the cost of an unavoidable side effect on a daily action.

This spec supersedes that comment. The comment is replaced, not deleted silently, so the next reader
finds the argument and its reversal in one place.

---

## Row anatomy and geometry

### The controls

Every row that can expand - a workspace root and a folder - becomes **two sibling controls inside one
flex container**, never nested. That follows the rule the close cross already established: a control
inside a control is a control nobody can reach with a keyboard in a predictable order.

| Control | Covers | Does |
|---|---|---|
| **Disclosure band** | A fixed 44px, starting at the row's indent | Expands or collapses |
| **Row button** | The icon, the name, and the rest of the row | Selects the folder for chat, and on a workspace root opens that root's page |
| **Close cross** | Root rows only, at the far right | Unchanged |

A **file row is unchanged**: one button, no disclosure, opens the file.

### The numbers

Rows indent 16px per level. Today the chevron sits at `depth * 16 + 4` and the folder glyph at
`depth * 16 + 24`.

```
band left    = depth * 16
band width   = 44                     (every depth, roots included)
chevron left = depth * 16 + 14        (16px glyph, up from 14px)
icon left    = depth * 16 + 44
```

So the triangle has 14px of empty band either side of it, which is what "the white space to the left
of the triangle and between the triangle and the icon" asks for, and the band is the same size and
in the same place relative to the triangle at every depth - including a workspace root, which would
otherwise be 32px because it has no indent to borrow.

**The cost is 20px of name width**, paid once, at every depth. If names read as cramped in use, the
cheapest recovery is dropping the indent step from 16px to 12px, which returns 12px at depth 3 and
more below; that is a follow-up, not part of this change.

A **file row keeps its own alignment rule** and shifts by the same 20px, so a file's icon still lines
up with the icon of a folder beside it rather than drifting out of column.

The band is **transparent**. It shows the row's hover and selection background like the rest of the
row, and gains its own hover treatment so the target is discoverable: on hover the chevron goes from
`--tp-ink-4` to `--tp-ink-2`. Nothing else marks it, because a permanently visible box around every
triangle would be noise down a long tree.

### While filtering

Filter results have nothing to collapse. Today the chevron is swapped for a blank spacer of the same
size; that stays, and **the band is not rendered as a control at all** - it becomes inert padding, so
there is no invisible target that does nothing.

---

## Click semantics, in full

| Row | Band | Icon or name |
|---|---|---|
| Workspace root, Obsidian vault | expand / collapse | select, and open the vault's graph tab |
| Workspace root, GitHub repository | expand / collapse | select, and open the repository page |
| Workspace root, plain local folder | expand / collapse | select only, until the companion spec gives it a home page |
| Folder | expand / collapse | select only |
| File | inert padding | open the file |

Right-click is unchanged everywhere: it opens the row's context menu and does not select, toggle or
open. A right-click **on the band** opens the same menu as a right-click on the row, because the band
is part of that row and a menu that appeared for two thirds of a row would be a puzzle.

---

## Keyboard and assistive technology

Two buttons per row would double the Tab stops down a tree of any size, which is a real cost to
anyone who navigates by keyboard. So:

- **The band takes `tabIndex={-1}`.** It is a real `<button>` with an accessible name
  (`workspace.expand` / `workspace.collapse`, naming the folder), so it is present in the
  accessibility tree and reachable by any tool that walks it - it is simply not in the Tab order.
- **The row button gains `ArrowRight` and `ArrowLeft`**, which expand and collapse. That is the
  standard tree pattern, and it gives the keyboard an equivalent of the band without a second stop.
- **`aria-expanded` moves to the band**, because the band is now the control that expands.
  **`aria-current` stays on the row button**, because selection is still what that button does.
  The existing comment about selection and expansion being separate facts remains true and is now
  also true of the markup.
- No `role="tree"` is introduced. The panel has never claimed to be one, and half-implementing the
  pattern - roving tabindex, type-ahead, Home and End - would be worse than the plain list of buttons
  it honestly is today. Adding it properly is out of scope and recorded below.

**This breaks existing tests on purpose.** `WorkspacePanel.test.tsx` finds rows with
`getByRole("button", { name: /docs/ })`, which will now match two buttons. Those tests are rewritten
to address the two controls separately, not worked around with a looser query.

---

## Obsidian icons

### Where they come from

Obsidian itself has **no folder icons**. They come from a community plugin. The one in use is
[Iconic](https://github.com/gfxholo/iconic), which stores its data at:

```
.obsidian/plugins/iconic/data.json
```

The only key this feature reads is `fileIcons`: a map from vault-relative path to an entry.

```jsonc
{
  "fileIcons": {
    "Projects":            { "icon": "lucide-folder-git-2" },
    "Projects/Charter.md": { "icon": "lucide-scroll-text", "color": "blue" }
  }
}
```

Folders are the keys with no file extension; files keep theirs. `icon` is either a Lucide id of the
form `lucide-<kebab-name>` or a literal emoji. `color` is optional and may be one of nine names
(`red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `pink`, `gray`), any CSS colour name,
or an `{ r, g, b }` object. Everything else in the file - tab icons, ribbon icons, the plugin's own
settings - is ignored.

### How it is read

**In the main process, through the workspace provider**, exactly as `.obsidian/app.json` already is
for the graph's "new note location". That means the boundary guard applies, a GitHub-backed vault
works through the same call, and the renderer never touches the path.

- A new IPC channel, `icons:map`, takes a workspace id and answers a validated map. It is added to
  the enumerated channel list and its argument is validated in the main process with zod, like every
  other handler.
- It is called when a workspace opens and when the workspace is refreshed. **There is no watcher.**
  Icons set in Obsidian while Trypthos is open appear after a refresh, which is the same contract the
  graph already has and the same sentence in the release notes.
- **Entries are capped at 2,000.** Above that the map is answered empty, because the payload crosses
  IPC on every open and a vault with more icon assignments than notes is a file we do not understand.

### How it is validated

A new domain module, `packages/domain/src/obsidianIcons.ts`, owns the whole contract:

- `ObsidianIconsSchema` - a zod schema over the parts that are read, tolerant of unknown keys, since
  this is a third-party format that will gain fields.
- `parseObsidianIcons(text): IconMap` - parse, validate, drop entries that do not make sense, cap.
- `iconFor(map, path): IconAssignment | null` - the lookup, keyed on the workspace-relative path.

Anything unexpected - a missing file, invalid JSON, a shape that fails the schema, a plugin version
whose format has changed - produces an **empty map and no message**. The icons are decoration; an
error banner about another application's private file would be noise the user cannot act on. The
failure is recorded once in the main process log at debug level and nowhere else.

### How they are drawn

Lucide icons are 24px stroke paths, which is exactly what the app's own `Glyph` already draws, so an
Iconic icon renders as a first-class glyph that takes the theme colour rather than a pasted-in image.

- **Dependency:** `lucide-static` (ISC), pinned. Only `icon-nodes.json` is used: 1,848 icons as
  arrays of `[element, attributes]`.
- **It is loaded lazily.** 417KB minified is far too much for the initial bundle, so the map is
  imported from a `lazy` boundary and fetched only when a workspace actually has assignments. A
  module-graph test asserts nothing eager imports it, in the same way `graphBundle.test.ts` guards
  the release-notes archive and the graph libraries.
- **Seven element types are allowed:** `path`, `circle`, `ellipse`, `line`, `polygon`, `polyline`,
  `rect`. That is every element the whole Lucide set uses. An entry naming anything else is dropped
  rather than rendered - a cheap allow-list that keeps a future version of the data from introducing
  markup nobody reviewed.
- **Emoji** render as text in a span of the same box, not through `Glyph`.
- **Where an icon is absent, nothing changes.** The row keeps the folder glyph or its file-type icon,
  which is also what happens for every non-vault workspace.

### Colour

The nine named tones resolve against the Obsidian theme, which Trypthos cannot read, so they are
mapped onto tokens of our own. Nine new tokens are added to `index.css` in all three theme blocks,
because a colour written into a component only works in the theme its author was in:

```
--tp-tone-red  --tp-tone-orange  --tp-tone-yellow  --tp-tone-green  --tp-tone-cyan
--tp-tone-blue --tp-tone-purple  --tp-tone-pink    --tp-tone-gray
```

A CSS colour name or an `{ r, g, b }` object is a value the user chose explicitly, so it is passed
through as given. That is the one place in the app where a colour does not come from a token, and it
is deliberate: the alternative is silently changing a colour somebody picked.

---

## Failure modes

| What happens | What the user sees |
|---|---|
| No Iconic plugin, or no `data.json` | Today's glyphs. No message. |
| `data.json` is invalid JSON or fails the schema | Today's glyphs. No message. |
| An entry names an icon Lucide does not have | That row keeps today's glyph. Others still work. |
| More than 2,000 entries | Today's glyphs throughout. No message. |
| The Lucide chunk fails to load | Today's glyphs. No message, and no retry loop. |
| A workspace is not a vault | Today's glyphs, because there is no file to read. |

---

## Testing

| Suite | What it proves |
|---|---|
| `obsidianIcons.test.ts` (domain) | Folder keys against file keys, every colour form, unknown fields tolerated, malformed input yields an empty map, the cap holds |
| `lucideIcon.test.tsx` (jsdom) | Each allowed element renders; a disallowed element is dropped; an unknown icon id renders nothing rather than throwing |
| `WorkspacePanel.test.tsx` (jsdom) | The band toggles and does not select; the row selects and does not toggle; a root opens its page without toggling; arrows expand and collapse; right-click still does none of the three; a filtered row has no band control |
| `WorkspacePanel.browser.test.tsx` (new) | The band measures at least 44px wide at depth 0 and depth 2, and a click at its left edge toggles while a click on the name does not. Geometry is a rendering question, so it cannot be answered in jsdom |
| `ipcHandlers.test.js` (shell) | `icons:map` validates its argument, refuses a path outside the workspace, and answers empty for a non-vault workspace |
| `iconBundle.test.ts` (module graph) | No eager module imports the Lucide map |

The browser test is the one that matters most here, because the entire point of the change is where
a click lands, and jsdom has no layout engine to answer that.

---

## Release checklist

1. `version.json` 0.85.0, and every mirror: four manifests and exactly five entries in the lock file.
2. `RECENT[0]` in `releaseNotes/current.ts`, matching that version.
3. About box: a capability row for the tree behaviour and the Obsidian icons, and **Lucide added to
   the third-party disclaimers** as a new dependency.
4. README Features row.
5. `docs/features.md` bullet, in step with the README row.
6. `docs/Architecture.md`: the new IPC channel, the new dependency, and the shape read from another
   application's data directory.
7. Deployment surface in the PR body: needs a release.

---

## Out of scope - for future reference

| Item | Why not now | What it would take |
|---|---|---|
| **A real `role="tree"`** | Half the pattern is worse than an honest list of buttons | Roving tabindex, type-ahead, Home and End, and a browser test per behaviour |
| **Iconize support** | Not the plugin in use, and its icons are SVG files in the vault rather than a known set | A second parser, plus reading and sanitising untrusted SVG, which is a security surface this app does not have |
| **Trypthos's own folder icons** | Nothing to set them from yet | A picker, and per-folder storage in settings that survives a workspace being renamed |
| **Watching the plugin's data file** | The app has never watched the disk, and the graph already has the same contract | A watcher with debouncing, feeding the same map |
| **Iconic's tab, ribbon and property icons** | Trypthos has no equivalent surfaces | Nothing, until it does |
| **Narrower indent to recover name width** | Only worth doing if the 20px is felt in use | Change one constant, and re-check the browser geometry test |
| **Colour on the icon a file row already has** | File-type icons carry meaning through shape, and recolouring them would blur it | A decision about which wins when both a type icon and an Iconic colour apply |
