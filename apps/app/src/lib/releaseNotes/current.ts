import type { Release } from "./types";

/// Releases since the last closed epoch. THE FILE EVERY PR EDITS: add one entry at the top.
///
/// RECENT[0].version must equal /version.json - releases.test.ts fails the build otherwise.
export const RECENT: Release[] = [
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
