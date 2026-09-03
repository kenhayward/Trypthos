import type { Release } from "./types";

/// Releases since the last closed epoch. THE FILE EVERY PR EDITS: add one entry at the top.
///
/// RECENT[0].version must equal /version.json - releases.test.ts fails the build otherwise.
export const RECENT: Release[] = [
  {
    version: "0.18.0",
    date: "2026-09-03",
    pr: 39,
    headline: "Conversations you can keep",
    summary:
      "Chats no longer disappear when you close Trypthos. Save one from the button at the top of the panel and it is kept, named after the question that started it, so there is no dialog asking you to think of a title. The clock icon beside it lists what you have saved, with the file each conversation was about, and lets you reopen or delete any of them. Saving a conversation you reopened updates it rather than making a second copy; clearing the panel starts a fresh one. Conversations are plain files in Trypthos's own folder, never in the folder you are editing - so nothing appears in a tree you curate, and nothing lands in a synced folder you did not ask to sync.",
    added: [
      "Save a conversation, and reopen it later.",
      "A list of saved conversations, showing the file each was about.",
      "Delete a saved conversation.",
    ],
    changed: [
      "A conversation that was about a file no longer in the open folder still opens, and says so.",
    ],
  },
  {
    version: "0.17.0",
    date: "2026-09-03",
    pr: 37,
    headline: "A more reliable way for chat to propose changes",
    summary:
      "If your endpoint supports tool calling, Trypthos can now use it to ask for document changes, and it is markedly more dependable than describing the format in words. Tick \"This endpoint supports tool calling\" on the model in Preferences to turn it on. Measured against one local model asking for a summary before a heading: without it, roughly half of attempts produced no usable proposal at all; with it, every attempt did. It is off by default and stays that way, because there is no way to ask an endpoint whether it supports tools - several accept the request, ignore it, and reply in prose, which looks exactly like a model that chose not to use one. Nothing else changes: you get the same card, the same Apply button, and the same single undo.",
    added: [
      "Tool calling as a second way for chat to propose document changes, per model.",
    ],
    changed: [
      "Models configured before this release keep the previous behaviour until you turn it on.",
    ],
    fixed: [
      "The About box shows its feature list as a table, rather than as unrendered markdown.",
    ],
  },
  {
    version: "0.16.0",
    date: "2026-09-03",
    pr: 36,
    headline: "Menus, and a right-click that does what you expect",
    summary:
      "Trypthos now has File, Edit, Tools and Help menus. On Windows they sit in the title bar, because the window draws its own; clicking one opens a real system menu, with the platform's own shortcuts and its own cut, copy and paste. On a Mac they appear where they belong, in the menu bar at the top of the screen, with Settings in the application menu as that platform expects. Right-clicking text now opens a proper menu too: cut, copy, paste and select all, greyed out when they would do nothing - and over a misspelled word, a list of corrections and the option to add the word to your dictionary. Spelling now works in the editor as well as in chat.",
    added: [
      "File, Edit, Tools and Help menus, native on both platforms.",
      "A right-click menu on any text, with cut, copy, paste and select all.",
      "Spelling corrections on right-click, and the option to add a word to your dictionary.",
      "Check for Updates is now on the Help menu as well as the tray icon.",
    ],
    changed: [
      "The editor is spellchecked, which it was not before.",
    ],
  },
  {
    version: "0.15.1",
    date: "2026-09-03",
    pr: 34,
    headline: "Document changes now actually appear",
    summary:
      "Asking chat to change your document gave you a written answer, or nothing at all, instead of a card with an Apply button. Three separate causes, all fixed. The instructions that teach the model how to propose a change were copied into your settings the first time you ran 0.14.0, so improving them later reached nobody who already had that copy; Trypthos now remembers that you have not written your own prompt rather than keeping a copy of the one it gave you, and a prompt you have edited is still left exactly as you wrote it. Trypthos was also too strict about how a model closes a proposed change, and rejected perfectly good ones over the placement of three backticks. And when a model finishes without writing an answer - which reasoning models genuinely do - you now get a short explanation and can unfold what it was thinking, rather than an empty space.",
    fixed: [
      "Chat proposes document changes on an installation upgraded from an earlier version.",
      "Improvements to the built-in system prompt now reach existing installations.",
      "A proposed change is recognised however the model closes it, or if it forgets to.",
      "A reply that arrives with no answer says so, instead of showing an empty message.",
    ],
    added: [
      "When a model thinks but does not answer, its thinking can be unfolded and read.",
    ],
    changed: [
      "A system prompt you have not edited is no longer copied into your settings file.",
      "A proposed change becomes a card once the reply has finished, not part-way through it.",
    ],
  },
  {
    version: "0.15.0",
    date: "2026-09-03",
    pr: 32,
    headline: "Chat can write into your document, once you say so",
    summary:
      "Ask for a change rather than an answer - a summary inserted before a heading, a section rewritten, a selected passage replaced - and the reply comes back as a card showing exactly what would be written and where. Nothing reaches your document until you press Apply, and one Ctrl+Z takes it back. If the heading it was aimed at has been renamed or deleted in the meantime, the card says so instead of offering a button, and if two headings share a name it refuses to guess between them. A model that gets the format wrong costs you a copy and paste rather than the answer: the block stays on screen as ordinary markdown.",
    added: [
      "Chat can propose changes to the open document, shown as a card you apply or ignore.",
      "Insert before or under a heading, replace a section, replace the selection, or add to the end.",
      "An applied change is a single undo step.",
    ],
    changed: [
      "The default system prompt now explains how to propose a change.",
    ],
  },
  {
    version: "0.14.0",
    date: "2026-09-03",
    pr: 31,
    headline: "Chat can see what you are working on",
    summary:
      "Ask a question and Trypthos now sends the model your document along with it. If you have selected a passage it sends just that, because selecting text and then asking a question is a clear way of saying which part you mean. Otherwise it sends the whole open file. With nothing open it sends nothing, and chat behaves as it did before. Preferences also gains a system prompt, which ships with a default written for reading and writing markdown: it asks for answers in your document's own conventions, and for a rewrite to come back as the text itself rather than wrapped in an explanation. Edit it freely, clear it if your endpoint has its own, and reset it if you change your mind.",
    added: [
      "Chat sends the open document with your question, or just the passage you have selected.",
      "A system prompt in Preferences, with a default written for markdown work.",
      "Reset the system prompt to the default, or clear it entirely.",
    ],
    changed: [
      "A very large document is shortened before it is sent, and the model is told it was.",
    ],
  },
  {
    version: "0.13.0",
    date: "2026-09-02",
    pr: 30,
    headline: "The chat panel works",
    summary:
      "Ask a question in the right-hand panel and the answer streams back as the model writes it. Pick which model answers from the menu at the top of the panel, stop a reply part-way with the same button you sent it with, and clear the thread to start again. Trypthos talks to your endpoint directly - there is no Trypthos server in between, and your API key never leaves the part of the app that stores it. What the panel does not do yet is see your document: it answers from the conversation alone. Sending it the open file, your selection and the folder around them is the next piece of work.",
    added: [
      "A working chat panel: ask a question, watch the reply stream in.",
      "Choose which model answers from the picker at the top of the panel.",
      "Stop a reply part-way through, or clear the conversation and start again.",
      "Replies render as markdown, including code blocks.",
    ],
    changed: [
      "The panel says when no model is configured, and offers to open Preferences.",
    ],
  },
  {
    version: "0.12.0",
    date: "2026-09-02",
    pr: 29,
    headline: "Set up the AI models you want to chat with",
    summary:
      "Preferences now has a Chat models section. Add as many models as you like - each one is a name you choose, the address of an OpenAI-compatible endpoint, and the model slug that endpoint expects - and mark the one new chats should start on. Your API key is encrypted by Windows or macOS and stored outside your settings file, so a settings file you copy or attach to a bug report carries no key with it. Trypthos cannot show a stored key back to you, which is deliberate: it can tell you a key is stored, and you can replace or remove it. The chat panel that uses all this comes next.",
    added: [
      "A Chat models section in Preferences: add, edit and remove models.",
      "Each model has a name, an endpoint, a model slug, and optional temperature and token limits.",
      "Mark which model new chats start on.",
      "Store an API key per endpoint, encrypted by your operating system.",
    ],
    changed: [
      "Removing a model, or pointing it somewhere else, deletes the API key nothing uses any more.",
    ],
  },
  {
    version: "0.11.1",
    date: "2026-09-02",
    pr: 28,
    headline: "You will actually be told when there is an update",
    summary:
      "The update notification never appeared on Windows: notifications have to identify themselves in a particular way, and Trypthos was not doing it, so every one was quietly discarded. It now does. And if your notifications are switched off entirely, the tray icon says an update is available instead of the news being lost altogether.",
    fixed: [
      "Update notifications appear on Windows instead of being silently discarded.",
      "With notifications switched off, the tray menu offers the update rather than saying nothing.",
    ],
  },
  {
    version: "0.11.0",
    date: "2026-09-02",
    pr: 26,
    headline: "Preferences: choose your theme, and what closing does",
    summary:
      "A Preferences dialog, reached from the cog in the title bar. Choose light, dark, or follow your system - and if you follow your system, Trypthos keeps following it while it is open rather than deciding once at startup. You can also make closing the window keep Trypthos running in the notification area instead of quitting. Everything you had set is carried forward.",
    added: [
      "A Preferences dialog, from the cog in the title bar.",
      "Choose Light, Dark, or follow your system theme.",
      "Optionally keep Trypthos running in the notification area when you close the window.",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-09-02",
    pr: 25,
    headline: "Trypthos tells you when there is a new version",
    summary:
      "On starting up, Trypthos quietly checks whether a newer version has been published. If there is one you get a notification; click it and the update downloads and installs itself. There is also a Trypthos icon in the notification area - right-click it for Check for Updates, which asks before downloading and tells you either way. If you are up to date, startup says nothing at all.",
    added: [
      "A check for a newer version when the app starts, with a notification if one is found.",
      "A Trypthos icon in the notification area, with Check for Updates and Quit.",
    ],
    changed: [
      "On macOS, where Trypthos cannot yet update itself, it offers to open the releases page instead.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-09-02",
    pr: 23,
    headline: "Resize the panels, and Trypthos remembers",
    summary:
      "Drag the seams between the panels to resize them, or hide either side panel entirely and bring it back from the edge. Trypthos now remembers how you left things - panel sizes, which panels were hidden, and the folder you had open, which reopens on the next launch. If the window is too narrow for everything, the side panels give up their space rather than the editor.",
    added: [
      "Drag the seam beside a panel to resize it, or use the arrow keys once it has focus.",
      "Hide either side panel and bring it back from a strip at the edge.",
      "Panel sizes, hidden panels and the open folder are remembered between launches.",
    ],
    changed: [
      "In a narrow window the side panels shrink first, so the editor keeps a usable width.",
    ],
  },
  {
    version: "0.8.2",
    date: "2026-09-02",
    pr: 22,
    headline: "Opening a file behaves like opening a file",
    summary:
      "Two things that made a freshly opened file look like one you had already been working on. It now opens at the top rather than wherever you had scrolled the previous file to, and it is only marked Unsaved once you actually change something.",
    fixed: [
      "A file opens at the top instead of at the previous file's scroll position.",
      "The Unsaved marker appears only after a change, rather than the moment a file is opened.",
    ],
  },
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
