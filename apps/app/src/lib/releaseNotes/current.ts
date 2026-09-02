import type { Release } from "./types";

/// Releases since the last closed epoch. THE FILE EVERY PR EDITS: add one entry at the top.
///
/// RECENT[0].version must equal /version.json - releases.test.ts fails the build otherwise.
export const RECENT: Release[] = [
  {
    version: "0.8.1",
    date: "2026-09-02",
    pr: 19,
    headline: "The installed app starts",
    summary:
      "Every release before this one failed to open once installed, showing an error about a missing module and nothing else. A piece the app needs at runtime was never included in the download. It is now, and the build refuses to publish a release that is missing it.",
    fixed: [
      "The installed app opens instead of showing an error about a missing module.",
      "The download no longer carries source files it has no use for.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-09-02",
    pr: 17,
    headline: "A real folder tree, with a filter",
    summary:
      "The workspace panel is now a tree you can expand and collapse rather than one folder at a time. It shows every folder but only your markdown files, with a box to narrow them by name. If a folder cannot be read, that folder says so and offers to try again while the rest of the tree keeps working. Hidden folders like .git are left out - they are not what this panel is for.",
    added: [
      "Expand and collapse folders in place.",
      "A filter box to narrow markdown files by name.",
      "A count of the markdown files on screen.",
      "A dot beside the open file when it has unsaved changes.",
    ],
    changed: [
      "Only markdown files are listed, alongside every folder.",
      "Hidden folders and files, such as .git, are no longer shown.",
      "A folder that cannot be read reports it on its own row with a Retry, rather than as a message over the whole panel.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-09-02",
    pr: 16,
    headline: "The editor tells you where you are",
    summary:
      "The editor gains a header and a status bar. The header shows the path to the document you have open, marks it when there is something unsaved, and reports your cursor position and word count. The status bar names the format, the encoding and the line endings your file actually uses - measured from the file rather than assumed, so it says so when a file mixes them. Bulleted lists now show a real bullet in Live view instead of the hyphen you typed.",
    added: [
      "A breadcrumb showing where the open document lives.",
      "An Unsaved marker in the editor header.",
      "Cursor position and word count.",
      "A status bar naming the format, encoding and line endings of the open file.",
      "The line you are editing is highlighted in Live view.",
    ],
    changed: [
      "Bulleted lists show a bullet in Live view rather than the hyphen in the file. The file itself is unchanged.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-09-02",
    pr: 15,
    headline: "One title bar instead of two",
    summary:
      "The window now draws its own title bar, showing the name of the file you have open, with About and the window buttons on the same row. Previously there were two bars stacked on top of each other: the system's and the app's. On a Mac the usual red, amber and green buttons stay exactly where they belong.",
    added: [
      "The title bar names the file you are editing.",
    ],
    changed: [
      "The separate app header is gone; About moved into the title bar.",
      "The window is dragged by its title bar, as before.",
    ],
  },
  {
    version: "0.5.1",
    date: "2026-09-02",
    pr: 14,
    headline: "Groundwork for other languages, and a tidier macOS download",
    summary:
      "Every word the app shows now comes from one place rather than being written into the screens themselves. Nothing reads differently today; it is what makes translating Trypthos possible later, and it was worth doing before the chat panel arrives with several hundred more phrases. The macOS download also gets its processor type back in the filename.",
    changed: [
      "All text the app displays now comes from a single catalogue.",
    ],
    fixed: [
      "The macOS download is named with its processor type again, so future builds for other Mac processors cannot collide.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-09-02",
    pr: 13,
    headline: "Trypthos follows your system theme",
    summary:
      "Dark mode. Trypthos now matches whatever your operating system is set to, and switches with it while the app is open - the editor's own colours included, so the text you are reading changes with everything around it rather than staying stubbornly bright. This is the first piece of the new interface design; the layout changes it prepares for come next.",
    added: [
      "Dark mode, following your system setting.",
    ],
    changed: [
      "Every colour in the app now comes from one shared set, so the editor and the panels around it can never drift apart.",
    ],
  },
  {
    version: "0.4.4",
    date: "2026-09-02",
    pr: 12,
    headline: "The Windows download link in the update feed works",
    summary:
      "The Windows installer was published under a slightly different name from the one the update information pointed at, so anything following that link got a dead end. Nothing you can reach from the releases page was affected, and no updater exists yet - but it would have broken the first one quietly. The installer is now named so the two always agree.",
    fixed: [
      "The Windows installer is published under the name the update information refers to.",
    ],
  },
  {
    version: "0.4.3",
    date: "2026-09-02",
    pr: 11,
    headline: "Releases publish as one complete download",
    summary:
      "The 0.4.2 release was assembled by hand. The Windows and macOS builds each tried to create the release at the same moment, so two half-finished ones appeared with an installer stranded on the wrong one. Building and publishing are now separate steps, so a release is created once, with everything in it, and is downloadable straight away rather than waiting for someone to publish it.",
    fixed: [
      "A release is created once with every installer, instead of each build creating its own.",
      "Releases are published rather than left as a draft nobody can download.",
    ],
  },
  {
    version: "0.4.2",
    date: "2026-09-01",
    pr: 10,
    headline: "The installers actually build",
    summary:
      "The first attempt at cutting a release failed on both Windows and macOS before producing anything. The Electron version was written as a range rather than a fixed version, and the packaging tool needs an exact one because it downloads binaries for one specific release. Pinning it also means a rebuild of the same version ships the same runtime, rather than whatever was newest that day.",
    fixed: [
      "Release builds no longer fail before producing an installer.",
    ],
  },
  {
    version: "0.4.1",
    date: "2026-09-01",
    pr: 9,
    headline: "Tagged builds now produce a real, downloadable release",
    summary:
      "Groundwork for shipping. Cutting a release built the Windows and macOS installers but left them attached to the build job, where they expire after ninety days and cannot be linked to. They are now published as a proper release you can download from, which is also what a future in-app updater will read.",
    fixed: [
      "Installers built from a tag are published as a downloadable release rather than a temporary build attachment.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-09-01",
    pr: 8,
    headline: "Open a folder and edit real files",
    summary:
      "Trypthos can now open a folder on your machine, browse it, and edit and save the files in it. Saving checks that the file has not changed underneath you since you opened it: if it has, the save is refused and your edits stay in the editor for you to decide about, rather than one version quietly overwriting the other.",
    added: [
      "Open a folder from the workspace panel and browse it.",
      "Open a file into the editor, and save it with Ctrl+S (Cmd+S on macOS).",
      "An asterisk beside the file name while there are unsaved changes.",
      "Saves are refused when the file changed on disk since you opened it, with your edits kept.",
    ],
    changed: [
      "The scratch buffer is still there until you open a folder, so the editor is usable straight away.",
    ],
  },
  {
    version: "0.3.1",
    date: "2026-09-01",
    pr: 7,
    headline: "Headings line up properly in Live mode",
    summary:
      "Fixes a stray space that left every heading and blockquote sitting one character right of the surrounding text in Live mode. Found by a new test suite that runs in a real browser, which can check what the editor actually draws rather than only what it decides to draw.",
    fixed: [
      "Headings and blockquotes no longer sit one space right of body text in Live mode.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-09-01",
    pr: 4,
    headline: "Live mode: markdown that reads like a document and edits like text",
    summary:
      "The editor now opens in Live mode. Markdown syntax is hidden, so a heading is simply large and bold, but the line your cursor is on shows its own markers - so you can always see and change the characters you are actually typing. Nothing is rewritten: the file is identical to what Source mode shows, which is the point of doing it this way rather than with a rich-text editor.",
    added: [
      "Live mode, now the default view: headings, bold, italic, inline code, links and quotes render in place.",
      "The line your cursor is on reveals its own markdown syntax, and hides it again when you move away.",
    ],
    changed: [
      "The editor opens in Live mode rather than Source. Source and Preview are unchanged and one click away.",
      "Switching between Live and Source keeps your undo history, selection and scroll position.",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-09-01",
    pr: 3,
    headline: "The desktop app runs, and finds its own interface once installed",
    summary:
      "Groundwork for running Trypthos as a desktop app rather than in a browser tab. One command now starts both halves together, and the window retries while the interface is still starting up instead of sitting blank. Also corrects where an installed copy looks for its interface - it would have opened to an empty window.",
    fixed: [
      "An installed copy looked for its interface in the wrong place and would have opened to a blank window.",
      "The window no longer stays blank when it opens before the interface is ready; it retries and appears a moment later.",
    ],
    changed: [
      "A single command starts the app and its interface together during development.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-01",
    pr: 2,
    headline: "A real markdown editor: Source and Preview",
    summary:
      "The centre panel is now a working editor. Source shows every character of your markdown, colour-coded by role, with line numbers and undo. Preview renders the same text as prose. Switching between them never changes your file - the two views read the same bytes, which is what lets someone reading a document and someone maintaining it share it without either being surprised.",
    added: [
      "Markdown editing in the centre panel, built on CodeMirror 6.",
      "Source view: every character visible, colour-coded so markers stay dim and headings, emphasis, code and links stand out.",
      "Preview view: read-only rendered prose, with markdown sanitised before it is displayed.",
      "A view switcher in the editor header.",
    ],
    changed: [
      "The centre panel opens on a scratch buffer instead of a placeholder, so the editor can be used before folder support lands.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-01",
    pr: 1,
    headline: "Project scaffold, CI and release machinery",
    summary:
      "First code drop. Sets up the Electron shell, the React renderer with its three-panel layout, and a pure TypeScript domain package - together with the release machinery every later PR relies on: version mirrors, release notes, and the guard tests that fail the build when any of them drift.",
    added: [
      "Electron desktop shell for Windows and macOS, loading the React renderer.",
      "Three-panel layout: workspace browser, editor, and AI chat.",
      "Workspace path guard, shared by every storage backend, with the escape cases pinned by tests.",
      "Schema-versioned persistence with migrations, so stored data survives upgrades.",
      "Chat profile configuration: endpoint, model and parameters, with API keys deliberately excluded from settings files.",
      "Continuous integration on every push and pull request.",
      "In-app release notes and About box.",
    ],
  },
];
