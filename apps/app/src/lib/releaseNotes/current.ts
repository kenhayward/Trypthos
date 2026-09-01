import type { Release } from "./types";

/// Releases since the last closed epoch. THE FILE EVERY PR EDITS: add one entry at the top.
///
/// RECENT[0].version must equal /version.json - releases.test.ts fails the build otherwise.
export const RECENT: Release[] = [
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
