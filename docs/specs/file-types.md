# Spec: file types beyond markdown

**Status: specified, not built.** Nothing in this document describes code that exists today. It is
the design the work is measured against, written before the first line of it, so that six pull
requests land as one coherent feature rather than six local decisions.

Trypthos opens markdown. This specifies opening the other files that live beside a user's notes -
configuration, data, logs, and source code - with syntax colouring, under a setting that says which
types the app takes an interest in.

## The framing decision, taken first

The request was for "plugins". This spec deliberately does not build plugins, and the wording matters
because it changes what the settings page is for.

CodeMirror's language packages are already lazy. Every entry in `@codemirror/language-data` is a
`LanguageDescription` whose `load()` is a dynamic `import()`, which Vite code-splits without being
asked; an unused language costs nothing at startup whether or not a checkbox is ticked. So a checkbox
labelled "plugin" would appear to control download weight while actually controlling nothing of the
sort.

What it does control is **scope**: which files appear in the folder tree, which files the app will
open, and which files chat can see. Point Trypthos at a source repository with Python enabled and the
left panel gains several hundred rows. That is the decision the user is making, so the page is called
**File types**, the rows name file types, and the help text talks about what appears in the tree.

Second consequence of the same reasoning: **do not depend on `@codemirror/language-data` wholesale.**
It describes 143 languages and drags in around twenty `@codemirror/lang-*` packages plus 2.4 MB of
legacy stream modes, none of them chosen. A hundred and forty-three checkboxes is not a settings
page. Trypthos carries a **curated catalogue** instead: each entry has a translated label, a
deliberate dependency, and its own dynamic import. Same lazy-loading ergonomics, a list a person can
read, and every dependency is a decision somebody made.

## What already exists, and where the seam is

The centre panel is one CodeMirror 6 view created once and fed transactions
(`components/DocumentEditor.tsx`, named `MarkdownEditor.tsx` when this was written). It already reconfigures two `Compartment`s - Live mode and
read-only - on a document switch, without rebuilding the view and losing undo history. **A language
compartment is that same pattern a third time**, which is why this feature is cheap rather than
structural.

Markdown-only is expressed in exactly one place, `isMarkdownFile` in
`packages/domain/src/workspaceTree.ts`, with five consumers:

| Consumer | What it decides |
| --- | --- |
| `apps/app/src/lib/treeRows.ts` | Which files appear in the folder tree |
| `packages/domain/src/markdownLink.ts` | Which relative links are offered as openable |
| `apps/desktop/src/workspaceOutline.js` | Which files chat's folder outline names |
| `apps/desktop/src/launchTarget.js` | Which files Explorer may hand the app |
| `apps/desktop/src/explorerIntegration.js` | Which extensions the Explorer verb is registered on |

The first three widen. **The last two do not** - see "The operating system is not part of this".

Three of the packages a curated catalogue would want are **already installed**: `@codemirror/lang-html`,
`lang-css` and `lang-javascript` arrive transitively through `@codemirror/lang-markdown`. HTML, CSS,
JavaScript, TypeScript and JSX therefore cost nothing to install, only a lazy chunk when first
opened. They still need explicit entries in `apps/app/package.json`; importing a transitive
dependency directly is a phantom dependency, and it breaks the day the intermediate package drops it.

## Architecture

The split follows `editorMode.ts`: the rules that a stored setting must agree with live in the
domain, and the part that is the renderer's own business lives in the renderer.

| Module | Holds | Must not |
| --- | --- | --- |
| `packages/domain/src/fileTypes.ts` | The catalogue as data, and the pure resolution over it | import CodeMirror, or anything from the renderer |
| `apps/app/src/lib/languageLoaders.ts` | `Record<FileTypeId, () => Promise<LanguageSupport>>` | be imported by any eagerly-loaded module |
| `apps/app/src/components/SettingsFileTypes.tsx` | The grouped checkboxes | know any extension by heart |

### The catalogue, as data

```
interface FileType {
  id: FileTypeId;            // also the key of its loader, and what settings persists
  labelKey: string;          // i18n key, never wording
  group: FileTypeGroup;      // how the settings page arranges the rows
  extensions: readonly string[];   // lowercase, no leading dot
  filenames: readonly string[];    // exact matches: "Dockerfile", "Makefile"
  modes: readonly EditorMode[];    // which views the header offers
  kind: "prose" | "plain" | "code";
}
```

Four things about that shape are load-bearing:

- **`filenames` exists from the start.** `Dockerfile` and `Makefile` have no extension, and
  retrofitting a second matching rule through every call site later is the expensive version of
  this.
- **`modes` is per type, not global.** Live and Preview are markdown constructs: Live hides markdown
  punctuation, Preview renders markdown through `marked`. Every other type is `["source"]`, and the
  header offers only what the type lists. `settings.editor.defaultViewMode` applies where the mode
  exists and is ignored where it does not.
- **`kind` drives editing affordances**, and one flag drives three because all three follow from the
  same question. `prose` wraps lines and spellchecks; `plain` does neither; `code` does neither and
  adds bracket closing and indent-on-input. A log file is `plain` rather than `prose` precisely
  because wrapping a log is wrong.
- **`id` is also the loader key.** One type, one loader. Where one npm package serves several types
  the loaders both import it and Vite emits one chunk.

The pure surface over it: `fileTypeFor(name, enabled)`, `openableExtensions(enabled)`,
`modesFor(type)`. `isMarkdownFile` becomes `fileTypeFor(name, ["markdown"])` and is deleted.

### The loaders, and the rule that keeps them lazy

```
export const LANGUAGE_LOADERS: Record<FileTypeId, LanguageLoader | null> = {
  markdown: () => import("@codemirror/lang-markdown").then(...),
  text: null,
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  ...
};
```

`null` is a real answer, not a gap: plain text needs no highlighting, and CodeMirror's default is
already exactly that.

**Nothing eagerly loaded may import a `lang-*` package.** This is the rule that keeps the whole
design honest, and it is invisible when broken: an `import { python } from "@codemirror/lang-python"`
at the top of `DocumentEditor.tsx` type-checks, renders perfectly, passes every other test, and puts
a grammar table on every cold start. **Assert it with a module-graph test**, the way the release
notes archive is already asserted out of the initial bundle.

### Applying a language to the view

The compartment is reconfigured on a document switch, in two steps, and the order matters:

1. Reconfigure to `[]` **synchronously, with the document swap**. The previous file's parser must
   never see the new file's text.
2. Start the loader. When it resolves, reconfigure again **only if the editor is still showing the
   document the load was started for** - capture `documentId` at request time and compare. Without
   that guard, switching tabs quickly applies Python to a YAML file, and the failure is
   timing-dependent and therefore intermittent.

**A loader that rejects leaves the file open with no highlighting.** A corrupt chunk must not blank
the centre panel. Test it.

Markdown is not special-cased in this mechanism, with one wrinkle: `markdown()` takes its
`codeLanguages` at construction, so when the enabled set changes the markdown extension is rebuilt
like any other. That falls out of putting it in the compartment rather than in the base
configuration, which is a change from today.

### Colour

`lib/editorTheme.ts` currently defines six markdown tags against CSS variables. Code needs the
standard `@lezer/highlight` set: `keyword`, `string`, `comment`, `number`, `typeName`, `function`,
`operator`, `propertyName`, `bool`, `null`, `regexp`, `className`.

**Extend the existing `HighlightStyle` rather than adding a second one.** Markdown tags and code tags
barely collide, one style is one thing to reason about, and - the real reason - a single style means
fenced code inside a markdown document is coloured by the same rules as a standalone source file, for
free.

Six or so new tokens go into `apps/app/src/index.css` in all three theme blocks
(`--color-tok-keyword`, `--color-tok-string`, `--color-tok-comment`, `--color-tok-number`,
`--color-tok-type`, `--color-tok-func`). A hex in `editorTheme.ts` would be a second palette that only
ever matches in the theme its author was in; `theme.browser.test.tsx` already asserts every token
resolves in both themes and extends to cover these.

The organising idea from Source mode survives unchanged: **colour stands in for meaning, it does not
apply formatting**. Nothing is bolded or resized.

### Settings

```
fileTypes: { enabled: string[] }
```

Top level, not under `editor`: it governs the folder tree, the link resolver and chat's folder
outline as much as the editing surface. `SETTINGS_VERSION` goes to 11 with a migration seeding
`["markdown"]`.

- **Ids, not extensions.** A type can gain an extension in a later release without a migration.
- **`z.array(z.string())`, filtered against the catalogue at read time - never `z.enum`.** A strict
  enum means a settings file written by a newer build fails to parse on an older one and takes the
  whole list with it, which is the trap `ChatProfileSchema` already documents from the other
  direction. An unknown id is dropped on read and left alone on write.
- **Defaults are `["markdown"]`, for both a fresh install and a migration.** Adding a setting must
  not change what an existing installation does, and a fresh install disagreeing with an upgraded one
  is a second kind of wrong. Every type beyond markdown, plain text included, is a deliberate opt-in.
- **Markdown is pinned.** The row is drawn, checked, and disabled. It is what the app is.

Two behaviours to settle rather than discover:

- **Disabling a type does not close an open tab.** Closing somebody's document from a settings toggle
  is hostile. The file stays open and editable; it leaves the tree, and loses its colouring the next
  time it is opened.
- **No restart.** Settings already flow through React state; the tree re-reads and the compartment
  reconfigures.

Because the default changes nothing visible, discoverability rests on the release notes and on one
line in the workspace footer, which today says it counts markdown files: it should say markdown is
the only type turned on, and where to change that.

## The read boundary, which is the actual risk

`apps/desktop/src/localWorkspace.js` reads with `fs.readFile(path, "utf8")` - no size check, no
content check. That is defensible for markdown and indefensible once `.log` is on the list. Two of
these three are **latent bugs today**, because `isMarkdownFile` tests an extension and nothing else:
a binary named `notes.md` already opens, and already corrupts on save.

- **Size cap.** Check `stat.size` in the main process before reading; refuse above 16 MB with a
  message naming the size. A 400 MB log freezes the renderer and can take it out of memory
  altogether. The cap is a constant in the domain so both processes and the message agree.
- **Binary refusal.** A NUL byte in the first 8 KB means refuse. Reading bytes as UTF-8 substitutes
  replacement characters, and **saving that back destroys the file**. This is the only item in this
  spec that can lose a user's data, which is why it lands before any new type does.
- **Encoding.** Everything is UTF-8. Preserve a UTF-8 BOM across a read/write round trip rather than
  silently stripping it, and refuse UTF-16 rather than mangling it - Windows PowerShell writes UTF-16
  logs by default, so `.log` walks directly into this.

Line endings need no work but should be stated: the write path writes the string it was given, so a
file's endings survive. That matters more for code than for prose, where a normalising save would
produce an enormous spurious diff in a repository.

## Editing behaviour, by kind

| | prose | plain | code |
| --- | --- | --- | --- |
| Line wrapping | on | off | off |
| Spellcheck | on | off | off |
| Bracket closing, indent on input | no | no | yes |
| Modes offered | as listed | source | source |

`EditorView.lineWrapping` and the `spellcheck` content attribute are both unconditional today; both
become compartments. The spellcheck one is not cosmetic - every identifier in a source file gets a
red underline otherwise.

**Tab stays as it is.** `defaultKeymap` omits `indentWithTab`, so Tab moves focus. That is the
accessible behaviour and this spec keeps it, in code files too. `indentOnInput` and `closeBrackets`
(already installed, via `@codemirror/autocomplete`) cover the ergonomics that actually matter.

## The operating system is not part of this

**Do not extend the Explorer verbs or the file associations beyond markdown.** Writing
`HKCU\Software\Classes\SystemFileAssociations\.py\shell\Trypthos` is a far larger claim on a user's
machine than the same key for `.md`, and it is a claim the settings page's wording does not make. The
setting governs what Trypthos shows; it does not govern what Windows hands it.

`launchTarget.js` therefore keeps its `MARKDOWN` list, and keeps the comment explaining that the two
lists are the same on purpose: accepting more than was registered means acting on arguments the app
never asked to receive.

## Chat

Three changes, or chat degrades quietly rather than loudly:

- `DEFAULT_SYSTEM_PROMPT` says "a markdown editor... help the user read, summarise and write markdown
  documents", and the edit-block protocol assumes markdown. A `.py` file gets markdown-flavoured
  advice. The prompt gains a sentence about the type of the open document, and the context payload
  carries its `FileTypeId`.
- `workspaceOutline.js` filters on `isMarkdownFile`. Pointed at a source repository with types
  enabled, the outline becomes thousands of paths and `chat.folderFileLimit` becomes load-bearing in
  a way it is not today. The outline respects the same enabled set.
- A model's reply about a source file is still **data, not instructions**, exactly as a markdown file
  is. Nothing here changes that, and nothing here should read as though a code file is more
  trustworthy than a note.

## The catalogue

Grouped as the settings page groups them. Every row is off by default except markdown.

**Documents**

| Type | Matches | Kind |
| --- | --- | --- |
| Markdown (pinned) | `md markdown mkd mdown` | prose |
| Plain text | `txt text nfo` | prose |
| Logs and data | `log csv tsv` | plain |

**Markup and data** - all near-free; HTML, CSS and JavaScript are already installed

| Type | Matches | Package |
| --- | --- | --- |
| JSON | `json jsonc map webmanifest` | `lang-json` |
| YAML | `yaml yml` | `lang-yaml` |
| TOML | `toml` | legacy mode |
| INI and properties | `ini properties cfg conf` | legacy mode |
| XML and SVG | `xml svg xsd xsl` | `lang-xml` |
| HTML | `html htm` | installed |
| CSS | `css scss less` | installed |

**Programming languages**

| Type | Matches | Package |
| --- | --- | --- |
| JavaScript and TypeScript | `js mjs cjs jsx ts mts cts tsx` | installed |
| Python | `py pyw pyi` | `lang-python` |
| Shell | `sh bash zsh ksh` | legacy mode |
| PowerShell | `ps1 psm1 psd1` | legacy mode |
| SQL | `sql` | `lang-sql` |
| Rust | `rs` | `lang-rust` |
| Go | `go` | `lang-go` |
| C and C++ | `c h cpp hpp cc cxx` | `lang-cpp` |
| C# | `cs` | legacy mode |
| Java and Kotlin | `java kt kts` | `lang-java`, legacy mode |
| PHP | `php` | `lang-php` |
| Ruby | `rb` | legacy mode |

PowerShell earns its place on a Windows-first app that a general-purpose list would rank far lower.

**Utility** - small legacy stream modes, genuinely useful beside notes

| Type | Matches |
| --- | --- |
| Diff and patch | `diff patch` |
| Dockerfile | filename `Dockerfile` |
| Makefile | filename `Makefile`, `makefile` |
| LaTeX | `tex ltx` |
| R, Lua, Perl, Swift, Scala, Dart | `r lua pl swift scala dart` |

### Extension collisions

Several extensions are claimed by more than one language, and the catalogue must name one owner for
each. `.m` is Objective-C, Octave and Mathematica; `.v` is Verilog and Coq; `.h` is C and C++; `.cfg`
is INI and TTCN. **Assert "no two types claim the same extension or filename" as one equality over
the whole catalogue** - per-type checks are the trap, since every type can be well-formed while the
set still collides.

Exclude Troff outright: `language-data` has it claiming `.1` through `.9`.

### Out of scope, deliberately

- **An HTML preview.** Rendering a workspace file's HTML executes its scripts inside the renderer.
  That is a security surface, not a feature.
- **`.docx` and `.pdf`.** A converter, not a highlighter. Different feature, different spec.
- **`.ipynb`.** JSON on disk, but a user who opens one expects cells.
- **Anything binary**, per the read boundary above.
- **A rich-text or second editing engine**, for the reasons already recorded in `CLAUDE.md`. Nothing
  here introduces a serialiser.

## What must be tested, and where

The jsdom suite cannot answer a rendering question - CodeMirror decides what to draw by measuring
text, and jsdom's geometry returns zeros. So the split is the usual one, and the interesting
assertions land on both sides.

**Domain (pure):** catalogue invariants as one equality over the whole set - no duplicate extension,
no duplicate filename, every id has a label key, every id in `DEFAULT_SETTINGS` exists, every id has
a loader entry. Resolution cases: `archive.md.bak`, a dotfile, `.tar.gz`, uppercase `.PY`, a name
that is all extension. Migration: an old settings file arrives with `["markdown"]` and nothing else
changed; a file naming an unknown id loads with that id dropped and the rest intact.

**Renderer (jsdom):** the settings page renders every catalogue row, markdown's checkbox is disabled,
toggling writes ids; the tree lists a `.py` file only when Python is enabled; disabling a type leaves
an open tab open; the header offers three modes for markdown and one for everything else.

**Renderer (browser):** a `.py` document actually shows coloured tokens, and shows none when the type
is disabled. Both themes resolve every new token. A rejecting loader leaves the document readable.

**Module graph:** the domain catalogue imports no CodeMirror; no eagerly-imported module imports a
`lang-*` package.

**Shell (node):** the size cap refuses before reading; a NUL byte in the first 8 KB refuses; a BOM
survives a read/write round trip; UTF-16 is refused rather than mangled.

## Phased implementation

Six pull requests. Each is independently shippable and independently useful, and the order is chosen
so that the thing which can lose data lands before the thing which makes it likely.

Every phase needs a release: Trypthos is wholly local, so a change reaches a user only through a new
installer.

### Phase 1 - the read boundary

**A fix, against the app as it stands.** A binary named `notes.md` opens today and corrupts on save;
a 400 MB `.md` freezes the renderer today. Neither needs a new file type to happen, which is why this
is first and why it starts as a GitHub issue like any other bug.

Size cap, NUL-byte refusal, BOM preservation, UTF-16 refusal - all in `localWorkspace.js`, with the
constants and the failure reasons in the domain so the renderer's message and the shell's check
cannot disagree. Tests in the node suite. Version: Build +1.

### Phase 2 - the seam and the settings page

`fileTypes.ts` with the catalogue's shape and exactly two entries, markdown and plain text.
`isMarkdownFile` deleted and its three widening consumers moved over. `fileTypes.enabled` in
settings at version 11. `SettingsFileTypes.tsx`, a new rail section, the i18n keys, the workspace
footer wording.

No new dependencies, no bundle change, no visible change until somebody ticks Plain text. That is the
point: the whole seam is proven with one type whose loader is `null`. Version: Minor +1.

### Phase 3 - per-type editor behaviour, and the free types

The language compartment with its two-step reconfigure and its document-identity guard. The
generalised `HighlightStyle` and its new CSS tokens. `modes` honoured by `EditorHeader`. Wrapping and
spellcheck by `kind`; `closeBrackets` and `indentOnInput` for `code`.

Ships the types that cost nothing to install: HTML, CSS, JavaScript and TypeScript, plus JSON, YAML
and XML for one small package each. The module-graph test lands here, with the first thing it could
catch. Version: Minor +1.

### Phase 4 - the language catalogue

The remaining programming languages and the utility types, one dependency each, in two or three
batches if the diff gets unwieldy. Mechanically repetitive by design: phase 3 built the machine, and
a new type is a catalogue row, a loader, a label and a test.

Watch the packaged installer size across this phase and record it, since this is where it moves.
Version: Minor +1 per batch.

### Phase 5 - fenced code inside markdown

`markdown({ codeLanguages })` fed from the enabled catalogue, so a fenced block in a user's own notes
is coloured by the same rules as a standalone file. For the audience Trypthos actually has, this is
plausibly the most valuable phase in the list, and by this point it is a few lines against machinery
that already exists.

Preview renders through `marked`, not CodeMirror, so its fenced blocks are a separate question -
answer it in this phase or explicitly defer it, but do not leave Source and Preview quietly
disagreeing about whether code is coloured. Version: Minor +1.

### Phase 6 - chat catches up

The system prompt learns that the open document has a type; the context payload carries it; the
folder outline respects the enabled set. Without this, the feature works and chat keeps answering as
though every file were a note. Version: Minor +1.

## Reversal conditions

Two things would reopen decisions taken here rather than merely extend them:

- **If users start asking Trypthos to be their editor for a source repository**, the curated
  catalogue stops paying for itself and `@codemirror/language-data` with a search field becomes the
  better answer. That is a different product, and the tell is people asking for languages nobody
  would keep beside their notes.
- **If a file type ever needs to render rather than colour** - a preview of something that is not
  markdown - re-read "The editor is one surface with three views" in `CLAUDE.md` before designing it.
  The invariant that a mode is a view and never a transform is what makes the current design safe,
  and a renderer that round-trips would break it silently.
