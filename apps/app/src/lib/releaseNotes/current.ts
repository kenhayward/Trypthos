import type { Release } from "./types";

/// Releases since the last closed epoch. THE FILE EVERY PR EDITS: add one entry at the top.
///
/// RECENT[0].version must equal /version.json - releases.test.ts fails the build otherwise.
export const RECENT: Release[] = [
  {
    version: "0.38.0",
    date: "2026-09-05",
    pr: 80,
    headline: "Preview colours code blocks too, and so do chat replies",
    summary:
      "Code blocks were coloured in Source and Live but not in Preview, so the same document looked different depending on how you were reading it. Preview now colours them, in the same colours, from the same list of file types - and a fence naming a language you have not turned on still reads as a code block, exactly as before. Replies in the chat panel get the same treatment, which is where it may matter most: an answer that includes a snippet now reads like code rather than like a wall of monospace. The colouring appears a moment after the text, because the language is fetched only when something needs it - the same way the editor has always behaved. Nothing about your document changes: the code is untouched down to the character, and anything that looks like markup inside a code block stays text.",
    added: [
      "Fenced code blocks are coloured in Preview.",
      "Fenced code blocks in chat replies are coloured the same way.",
    ],
    fixed: [
      "The same document no longer looks different in Source and Preview.",
    ],
  },
  {
    version: "0.37.0",
    date: "2026-09-05",
    pr: 79,
    headline: "Chat knows what kind of file it is looking at",
    summary:
      "Chat has been told, on every turn, that it was inside a markdown editor looking at a markdown document. That was true until Trypthos started opening other things, and since then asking about a Python file got you an answer phrased as though it were prose - matching heading depth and list markers in a file that has neither. The turn carrying your document now says what kind of file it is when it is not markdown, and the built-in instructions tell the model what to do about it: answer about it as that kind of file, write anything it proposes in that file's own language rather than in markdown, and use only the two kinds of change that can be placed in a file without headings. It will say so rather than guess if neither fits. If you have written your own instructions in Settings, yours are untouched - this changes only the built-in ones, so it reaches you if you have never edited them. Two smaller things follow from the same change: the strip along the bottom of the editor now names the type of the file you are in rather than always saying Markdown, and the chat panel no longer describes the folder as a list of markdown files, which it stopped being when you could turn other types on.",
    changed: [
      "The document sent to chat says what kind of file it is, when it is not markdown.",
      "The built-in instructions tell the model how to answer about, and how to propose changes to, a file that is not markdown.",
      "The status bar names the open document's type instead of always saying Markdown.",
      "The chat panel and its settings no longer call the folder's contents markdown files.",
    ],
  },
  {
    version: "0.36.0",
    date: "2026-09-05",
    pr: 78,
    headline: "Code inside your notes is coloured too",
    summary:
      "A fenced code block in a markdown document is now coloured by whatever language its fence names, using exactly the same colours a file of that language gets on its own. Write three backticks and python, and what follows reads as Python. The tags you would expect all work: the short ones like py, ts, rs and sh, and the written-out ones like typescript, kotlin and c++. This follows your File types setting rather than working for everything: a fence is coloured only if you have turned that language on, so the setting governs the inside of a document as well as which files appear on the left. A fence naming a language you have not turned on still reads as a code block, in the code colour markdown has always given it - nothing is lost, it simply is not broken up by role. One thing this does not yet reach: Preview still shows code blocks as plain monospace, because it renders through a different path from the editor. Source and Live have it.",
    added: [
      "Fenced code blocks in markdown are coloured by the language on the fence, in Source and Live.",
      "Short tags and written-out names both work: py and python, ts and typescript, c++ and cpp.",
    ],
    changed: [
      "A fence is coloured only if its language is turned on in File types, like everything else there.",
    ],
  },
  {
    version: "0.35.0",
    date: "2026-09-05",
    pr: 76,
    headline: "Twenty-two more file types, and a Utility group",
    summary:
      "The File types page is now the full list. Markup and data gains TOML and INI files, and the CSS row covers SCSS, Sass and LESS as well. Programming languages gains Python, Shell, PowerShell, SQL, Rust, Go, C and C++, C#, Java and Kotlin, PHP and Ruby. A new Utility group holds the things that turn up beside a project rather than inside it: diffs and patches, Dockerfiles, Makefiles, LaTeX, R, Lua, Perl, Swift, Scala and Dart. As before, every one of them is off until you turn it on, and turning one on is what makes those files appear in the folder browser at all. Some rows carry more than one language where the difference is not one you would want to tick a box about: CSS covers four stylesheet dialects, Java covers Kotlin, and C covers C++. Trypthos works out which from the file's name. Two rows are matched by whole filenames rather than extensions, because Dockerfile and Makefile do not have any. Makefile is the one type with no colouring, because no grammar for it exists - it is there so the file opens at all, which is the same reason Plain text is there. None of this makes Trypthos slower to start: a language is fetched only the first time you open a file that needs it, so the twenty-two here cost about 14 KB at startup between them.",
    added: [
      "TOML and INI files, and SCSS, Sass and LESS alongside CSS.",
      "Python, Shell, PowerShell, SQL, Rust, Go, C and C++, C#, Java and Kotlin, PHP and Ruby.",
      "A Utility group: diffs and patches, Dockerfile, Makefile, LaTeX, R, Lua, Perl, Swift, Scala and Dart.",
      "Dockerfile and Makefile are recognised by name, since neither has an extension.",
    ],
  },
  {
    version: "0.34.0",
    date: "2026-09-05",
    pr: 75,
    headline: "Six more file types, in colour",
    summary:
      "The File types page now offers JSON, YAML, XML and SVG, HTML, CSS, and JavaScript and TypeScript, alongside markdown and plain text. Turn one on and those files appear in the folder browser, open in the editor, and are coloured by role the way markdown already was - keywords, strings, comments, numbers, types and names, in colours that follow your light or dark theme rather than being painted on top of it. JavaScript and TypeScript are one choice rather than four: .js, .ts, .jsx and .tsx are the same language wearing different hats, and Trypthos works out which from the file's name. A file that is not markdown opens in Source and stays there. Live and Preview are markdown ideas - Live hides markdown punctuation and Preview renders markdown as prose - so neither means anything over a stylesheet, and the view buttons are simply not drawn for a document with one view. The formatting toolbar goes with them, since its buttons write markdown. Two things also change while you edit: lines no longer wrap in a file that is not prose, because in code the column a character sits in is information, and spelling is no longer checked there, because every identifier in a source file would otherwise be underlined in red. Trypthos also starts faster than it did: each language is fetched only when you open a file that needs it, and moving markdown onto the same footing took about a fifth off what the app loads at startup.",
    added: [
      "JSON, YAML, XML and SVG, HTML, CSS, and JavaScript and TypeScript on the File types page.",
      "Syntax colouring by role for all of them, from the same palette as the rest of the app, in both themes.",
      "TypeScript and JSX are recognised from the file name rather than needing choices of their own.",
    ],
    changed: [
      "A file with one view no longer shows the view buttons, and the formatting toolbar appears only for markdown.",
      "Lines wrap and spelling is checked only in prose - not in code, where both get in the way.",
      "Languages load when a file needs one, so the app loads about a fifth less at startup than before.",
    ],
  },
  {
    version: "0.33.0",
    date: "2026-09-05",
    pr: 74,
    headline: "Choose which kinds of file Trypthos shows you",
    summary:
      "Settings has a new page, File types, listing the kinds of file Trypthos takes an interest in. Markdown is always on and cannot be turned off, and this release adds Plain text - .txt, .text and .nfo - which you turn on yourself. Nothing changes until you do: upgrading leaves you with exactly the folder browser you had yesterday. A type that is turned off is not simply uncoloured, it is absent - its files do not appear in the folder browser, clicking a link to one does nothing, and chat is neither shown them nor allowed to read them. That is worth knowing before you turn one on, because pointing Trypthos at a folder full of that type makes the list on the left a great deal longer. The footer under the folder browser now says which types are on - the type's name when there is one, a count when there are several - and clicking it goes straight to the page that changes them. This is the groundwork for source code, configuration and log files, which arrive with their syntax colouring in later releases.",
    added: [
      "A File types page in Settings, listing every kind of file Trypthos can show and what each one matches.",
      "Plain text as the first type you can turn on: .txt, .text and .nfo.",
      "The folder browser's footer names the types being shown, and opens the page that changes them.",
    ],
    changed: [
      "Markdown is drawn as always on rather than left off the page, because it is what Trypthos is.",
      "Which files chat is offered, and may ask to read, follows the same setting as the folder browser.",
    ],
  },
  {
    version: "0.32.1",
    date: "2026-09-05",
    pr: 73,
    headline: "A file Trypthos cannot open safely is now refused rather than mangled",
    summary:
      "Trypthos decided whether it could open a file by looking at its name, and nothing else. That was a guess, and when it was wrong it was destructive: rename a picture or a zip file to end in .md, open it, and every byte Trypthos could not read became a question mark on screen. Press Ctrl+S and those question marks were written over the original file, which was then gone. The same went for any file written in an encoding other than UTF-8 - what Windows PowerShell writes by default, for instance - and a very large file could stop the window responding altogether. Trypthos now looks at a file before it opens it. A file that is not text, a file in an encoding it cannot read, and a file larger than 16 MB are each refused with a message saying which of the three it is, and the file is left exactly as it was. A byte order mark - an invisible marker some programs put at the start of a file - now survives being opened and saved, where before it was quietly dropped and showed up as a change to a file you had not changed.",
    fixed: [
      "A file that is not text is refused rather than opened as question marks and saved back over the original.",
      "A file in an encoding other than UTF-8 is refused rather than opened with every unreadable character replaced.",
      "A file larger than 16 MB is refused, with its size named, rather than taken on until the window stops responding.",
      "A byte order mark at the start of a file survives opening and saving instead of being dropped.",
    ],
  },
  {
    version: "0.32.0",
    date: "2026-09-05",
    pr: 65,
    headline: "A formatting toolbar in Source, and a guide to the markdown Trypthos speaks",
    summary:
      "Source view now has a row of buttons above the document for every piece of markdown Trypthos renders: bold, italic, strikethrough and inline code; links and images; the first three heading levels; quotes, bulleted, numbered and task lists; code blocks, tables and horizontal rules. The buttons work with what you are doing rather than only inserting characters. A heading button acts on the line your cursor is on whether or not anything is selected - press it once to make the line a heading, press the same level again to turn it back into a paragraph, or press a different level to change it. Bold, italic, strikethrough and inline code wrap the text you have selected, and pressing the same button again with that text still selected takes the markers off; with nothing selected they act on the word your cursor is in. The list buttons convert one kind of list into another rather than adding a second marker. The toolbar is in Source only, where the markers it writes are visible, and one press is one undo step. The Help menu now also carries a Markdown Syntax Guide: it opens in a tab like any document, shows every construct with an example and says which flavour of markdown Trypthos supports, which is GitHub Flavored Markdown. The guide is part of the app rather than a file in your folder, so it is read-only and is never saved anywhere.",
    added: [
      "A formatting toolbar above the document in Source view, with a button for every markdown construct Trypthos renders.",
      "Heading buttons act on the current line and toggle between levels; character formatting wraps the selection, or the word the cursor is in.",
      "A second press removes what the first added, so every button is a toggle.",
      "Markdown Syntax Guide on the Help menu, opening in a read-only tab, with examples and the flavour of markdown named.",
    ],
  },
  {
    version: "0.31.0",
    date: "2026-09-05",
    pr: 64,
    headline: "Open a folder or a file straight from File Explorer",
    summary:
      "On Windows, Trypthos can add itself to File Explorer's right-click menu: Open folder in Trypthos on a folder or on the space inside one, and Open in Trypthos on a markdown file. It also appears in Explorer's Open with list. Turn it on from the Window page of Settings, and off again the same way - nothing is written outside your own user account, so it needs no administrator rights. On Windows 11 the entries sit under Show more options rather than on the first menu, and Settings says so beside the switch. Opening a folder opens it as your workspace; opening a file opens the folder it lives in and the file itself, because every document Trypthos edits lives inside one open folder. If Trypthos is already running, whatever you open arrives in the window you already have: a file in the folder you are in becomes another tab, and one from elsewhere opens that folder instead, asking about unsaved work first exactly as opening a folder from the button does. macOS has no equivalent yet.",
    added: [
      "A switch on the Window page of Settings that adds Trypthos to the File Explorer right-click menu, for folders and for markdown files.",
      "Trypthos appears in Explorer's Open with list for markdown files.",
      "Opening a file or folder from Explorer while Trypthos is running uses the window you already have.",
    ],
  },
  {
    version: "0.30.0",
    date: "2026-09-05",
    pr: 63,
    headline: "A list of every open file, at the end of the tabs",
    summary:
      "With enough files open, the tab strip scrolls and some of them are out of sight. There is now a button at the end of the strip, just before the Unsaved pill and the view buttons, that lists every open file: the file's name with the folder it lives in underneath, the one you are looking at highlighted, and a dot beside any with unsaved changes. Choose one and you go straight to it. The tabs themselves have not changed - this is simply another way to reach a file when its tab has scrolled away.",
    added: [
      "A list of every open file, from the button at the end of the tab strip.",
      "Each entry names the file and the folder it is in, and marks unsaved changes.",
    ],
  },
  {
    version: "0.29.1",
    date: "2026-09-05",
    pr: 62,
    headline: "The Dismiss button on a message now dismisses it",
    summary:
      "When something goes wrong - a file that is no longer there, a save refused because the file changed on disk - a message appears under the title bar with a Dismiss button beside it. Pressing Dismiss did nothing at all, so the only way to clear a message about something that failed was to do something else that worked. It now clears the message, and leaves everything else exactly as it was: the file you are in, what you have typed, and whether it is saved.",
    fixed: ["Dismiss now clears the message under the title bar."],
  },
  {
    version: "0.29.0",
    date: "2026-09-05",
    pr: 60,
    headline: "Open as many files as you like, and switch between them",
    summary:
      "Until now Trypthos held one document at a time: opening a second file closed the first, and if you had unsaved changes it stopped to ask you about them. Files now open in tabs along the top of the editor, the way they do in an editor like VS Code. Click a file in the folder browser and it opens in a new tab; click one that is already open and you go straight to it, with everything you had typed still there and nothing read back over the top of it. Each tab shows the file's own name, with the full path on hover, and two files with the same name grow just enough folder to tell them apart. Close a tab with its x, with a middle click, or with Ctrl+W (Cmd+W on macOS) - and if that file has unsaved changes, the prompt now names the file it is asking about, which matters when several are unsaved at once. Coming back to a tab puts you where you left it, at the same line and the same place in the document. The editor's header made room for the tabs: the file name moved to its tab, the caret position and word count moved down to the status bar, and the Live, Source and Preview buttons are now icons, with their names on hover.",
    added: [
      "Files open in tabs, with the file name on the tab and the full path on hover.",
      "Clicking a file that is already open goes to its tab instead of reopening it.",
      "Close a tab with its x, a middle click, or Ctrl+W (Cmd+W on macOS).",
      "A dot on a tab marks a file with unsaved changes that you are not looking at.",
      "Returning to a tab puts the caret and the view back where you left them.",
      "The folder browser marks every open file, and the one on screen more strongly.",
    ],
    changed: [
      "The prompt about unsaved changes names the file it is asking about.",
      "The editor header now shows only whether the file is saved and how you are viewing it; the file name is on its tab.",
      "The caret position and word count moved to the status bar.",
      "Live, Source and Preview are icons rather than words, with their names on hover.",
    ],
  },
  {
    version: "0.28.0",
    date: "2026-09-04",
    pr: 59,
    headline: "Links go where they point, and say where that is",
    summary:
      "Clicking a link in Preview used to load the page over the top of Trypthos, with no address bar and no back button to get out of it again. Links now do what you would expect. A web address opens in your own browser and leaves Trypthos exactly where it was. A link to another markdown file in the open folder opens that file in the editor, just as clicking it in the folder browser would - and if the file has been renamed, moved or deleted since the link was written, you are told rather than left wondering. Hovering any link shows where it goes before you click it, which is how you can tell a file in your folder from a page on the internet. This works in the rendered prose of Preview, in the chat panel's replies and in the About box; in Live mode, where link text is still text you can edit, hold Ctrl (Cmd on macOS) and click to follow one. Links Trypthos will not follow - a picture, a PDF, anything pointing outside your folder - now do nothing at all rather than taking the app somewhere it cannot come back from.",
    added: [
      "Links to markdown files in the open folder open that file in the editor.",
      "Hovering a link shows its target.",
      "Ctrl+click (Cmd+click on macOS) follows a link in Live mode.",
    ],
    fixed: [
      "Clicking a link no longer loads the page over the app. Web addresses open in your browser.",
    ],
  },
  {
    version: "0.27.2",
    date: "2026-09-04",
    pr: 57,
    headline: "The editor header names the file, and stops drawing over itself",
    summary:
      "With a long folder name, the path in the editor header printed on top of itself - the parts ran together into unreadable text and spilled over the view buttons beside them. The header now shows the file's own name, cut short with an ellipsis when even that does not fit, so it is clear the name goes on. The whole path is still there on hover, and the tree beside it still shows where the file lives.",
    fixed: [
      "The editor header no longer draws the path over itself when the folder names are long.",
    ],
    changed: [
      "The editor header shows the file name rather than the whole path, with the path on hover.",
    ],
  },
  {
    version: "0.27.1",
    date: "2026-09-04",
    pr: 55,
    headline: "Unsaved changes are no longer thrown away in silence",
    summary:
      "Editing a file and then opening another one, opening another folder, or closing the window discarded the edits without a word. All three now ask first, offering Save, Don't Save and Cancel - and Cancel leaves everything exactly as it was, the same file, the same text, still unsaved. If you choose Save and the save cannot be made, because the file changed on disk since you opened it, nothing is discarded and nothing closes: the conflict is reported and your text is still in the editor, which is the point of asking. Keeping Trypthos running in the tray still closes nothing, so it does not ask - the window hides and your document is still open behind it.",
    fixed: [
      "Opening another file, opening another folder or closing the window now asks before discarding unsaved changes.",
    ],
  },
  {
    version: "0.27.0",
    date: "2026-09-04",
    pr: 53,
    headline: "A context dial over the chat box",
    summary:
      "A small ring at the end of the chat scope bar shows how full the model's context is with everything the next question will carry: the system prompt, the document or your selection, any attached files, the folder outline, the conversation so far, and what you have typed but not yet sent. Hover it for the numbers. Every figure is an estimate and says so - counting tokens exactly needs the provider's own tokeniser, and an endpoint only reports its count after the request, which is too late to be useful. The total comes from a new Context window box on each chat model in Settings; leave it empty if you do not know your endpoint's window and the dial shows the amount without pretending to know how much is left. Also fixed: Folder and Attach a file sat a couple of pixels out of line with each other.",
    added: [
      "A context dial on the chat scope bar, with the amount and the total on hover.",
      "A Context window box on each chat model, used to work out how full the context is.",
    ],
    fixed: [
      "Folder and Attach a file now line up with each other on the chat scope bar.",
    ],
  },
  {
    version: "0.26.1",
    date: "2026-09-04",
    pr: 52,
    headline: "The system prompt gets the whole page, and every text field gets its menu",
    summary:
      "The system prompt is the longest thing anyone edits in Trypthos, and it was being edited through a ten-row window in the middle of a page with empty space below it. The box now takes the full width of the page and all the height that is left, so you can see what you are changing. Its explanation moved up beside the System prompt heading, where it reads before the box rather than off the bottom of a page you have already scrolled. Separately, the right-click menu now offers undo and redo alongside cut, copy, paste and select all, in every field you can type in - and the prose you write outside the document is spellchecked too, so your questions to chat and the system prompt get the same underlines and the same corrections the editor has. Where your system's language has no dictionary, Trypthos falls back to another dialect of it, then to English, rather than quietly checking nothing at all.",
    added: [
      "Undo and redo on the right-click menu, in every text field.",
      "Spellchecking in the chat box and the system prompt, not only in the document.",
    ],
    changed: [
      "The system prompt box fills the AI & system prompt page instead of being a small box in the middle of it.",
    ],
  },
  {
    version: "0.26.0",
    date: "2026-09-04",
    pr: 51,
    headline: "Settings is a proper window now, with a page per subject",
    summary:
      "Preferences was one small scrolling box with everything in it: themes, tray behaviour, every chat model, the folder file limit and the whole system prompt, stacked in a column. It is now a near-fullscreen Settings window with a rail down the left and a page per subject - Appearance, Window, Chat models, AI & system prompt, Editor and About. Chat models get a page of their own: the models are listed as cards, the rail lists them too while you are there, and editing one opens its form on its own rather than several forms at once. About moved in as a page, so there is one About in the app instead of a separate box. Settings still apply the moment you choose them, with no Save button to forget - a chat model is still the exception, because its fields are only valid together. New with the Editor page: choose the view documents open in, so if you work in Source you no longer switch to it on every file.",
    added: [
      "A Settings window with a navigation rail and a page per subject, replacing the single scrolling Preferences box.",
      "An Editor page, where you choose whether documents open in Live, Source or Preview.",
      "Escape closes Settings.",
    ],
    changed: [
      "About is a page in Settings rather than a box of its own. The title bar and the Help menu open it there.",
      "The system prompt and the folder file limit moved to their own AI & system prompt page, away from the model list.",
    ],
  },
  {
    version: "0.25.0",
    date: "2026-09-04",
    pr: 49,
    headline: "The chat panel waits until you have a model to chat with",
    summary:
      "A fresh installation opened with a chat panel that could not answer anything, because no model had been configured yet - a third of the window given over to an invitation to go and set one up. The panel is now absent until you configure your first model in Preferences, and appears by itself the moment you do; the editor takes the width until then. Preferences has a Show the chat panel switch in its Chat models section for the times that rule gets it wrong: turn it off for a plain editor and folder browser even with models configured, or on to keep the panel while you are still setting one up. Existing settings are untouched - if you have a model configured, the panel is where it has always been.",
    added: [
      "A Show the chat panel setting in Preferences, under Chat models.",
    ],
    changed: [
      "The chat panel is hidden until a model is configured, and appears as soon as one is.",
    ],
  },
  {
    version: "0.24.0",
    date: "2026-09-04",
    pr: 48,
    headline: "The tray icon is the app icon, and a second launch brings the window back",
    summary:
      "The notification-area icon is now the same green tile as the taskbar, Start menu and Dock, drawn from the same artwork rather than a separate glyph made to resemble it. On Windows it ships as a multi-size icon so the notification area picks a crisp size for your display scaling instead of shrinking one image; on macOS it is a menu-bar template that adapts to light and dark. Separately, launching Trypthos while it was already running hidden in the tray did nothing visible - the window stayed hidden with no taskbar button. A second launch now brings the window back whether it was minimised or hidden.",
    changed: [
      "The tray icon is the app icon itself, in every size Windows scaling asks for, and a matching menu-bar template on macOS.",
    ],
    fixed: [
      "Launching Trypthos while it is hidden in the tray now shows the window instead of doing nothing.",
    ],
  },
  {
    version: "0.23.1",
    date: "2026-09-04",
    pr: 46,
    headline: "Windows updates actually download now",
    summary:
      "Checking for an update on Windows and choosing to download it did not download anything - it always fell back to opening the releases page in your browser, every time, regardless of your connection. The in-app updater never told electron-updater to check for an update before asking it to download one, which it refuses to do, so the download always failed silently and fell back to the same fallback macOS uses. Downloading now works the way it was meant to: electron-updater fetches and applies the update in place, ready on your next restart.",
    fixed: [
      "Downloading an update on Windows now actually downloads it, instead of always opening the releases page.",
    ],
  },
  {
    version: "0.23.0",
    date: "2026-09-04",
    pr: 44,
    headline: "The tray icon matches the new design",
    summary:
      "The notification-area icon was left out of the app-icon redesign and still showed the old thin, unfilled outline next to the new bold taskbar icon. It now uses the same flat, solid-fill treatment the app icon itself uses at its smallest sizes - a filled page shape with the rule lines cut through as notches - so the tray reads as the same design rather than a different, older one.",
    changed: [
      "The tray icon is now a bold, filled glyph matching the new app icon's style.",
    ],
  },
  {
    version: "0.22.0",
    date: "2026-09-03",
    pr: 43,
    headline: "Updates download themselves",
    summary:
      "Finding a new version used to mean a trip to the releases page to find and click the right file. Trypthos now fetches the correct installer itself and opens it: on Windows that means the installer runs and replaces the app on your next restart, exactly as before. On macOS - which cannot update itself in place without a signed build - it downloads the disk image and mounts it, so the only thing left to do is drag it into Applications rather than hunting for the download first. If nothing has been published for your platform yet, or the download does not go through, Trypthos still falls back to opening the releases page rather than leaving you stuck.",
    fixed: [
      "Checking for an update now downloads and opens the right installer automatically.",
    ],
  },
  {
    version: "0.21.0",
    date: "2026-09-03",
    pr: 43,
    headline: "A real app icon, on both platforms",
    summary:
      "Trypthos has its own icon now, instead of the default one Electron ships. Same page-with-a-folded-corner mark the tray icon and the workspace tree already use, in a rounded-square tile on Windows and Apple's own inset, floating shape on macOS - same diagonal green gradient, same page-fold glyph, drawn to each platform's own conventions rather than one image stretched to fit both. It appears everywhere an icon does: the taskbar, the Start menu, the installer, the desktop shortcut, the Dock and Finder. The smallest sizes use a simplified, flat-coloured version, because the gradient and the folded corner both stop reading as anything but noise once the icon gets that small.",
    added: [
      "A designed app icon for the taskbar, Start menu, installer, Dock and Finder.",
    ],
  },
  {
    version: "0.20.0",
    date: "2026-09-03",
    pr: 41,
    headline: "The model can read the files you offer it",
    summary:
      "With Folder switched on, the model is shown the markdown files in your folder and can now ask to read one, then another, until it has what it needs - and the panel says which file it is reading while it does. It can only read files on that list: anything else is refused and it is told so. The list is the top level of your folder only, and how many files it names is up to you in Preferences, ten by default. Every entry is a file the model might ask for, so a longer list is a more capable chat and a more expensive one. This needs an endpoint that supports tool calling; without one, Folder works as it did and you attach files yourself.",
    added: [
      "The model can read files from the folder list, one at a time, and keep going.",
      "The panel says which file is being read.",
      "Choose how many of the folder's files the model is shown, in Preferences.",
    ],
    changed: [
      "The folder list is the top level of your folder only, rather than every subfolder.",
    ],
    fixed: [
      "A failed request now ends the reply instead of leaving the panel waiting for ever.",
    ],
  },
  {
    version: "0.19.0",
    date: "2026-09-03",
    pr: 40,
    headline: "Chat can look beyond the document you have open",
    summary:
      "A row above the message box now shows what chat can see. Attach another file and it is sent in full alongside your document, so you can ask how two notes relate without pasting one into the other. Turn on Folder and Trypthos sends the LIST of markdown files in your folder - the paths, never the contents - so the model can say which one it would need and you can attach it. Your document still comes first: if everything will not fit, the file you are editing keeps its place and an attachment is shortened rather than pushing it out. Nothing is included unless you ask for it, because a reply that quietly read five files, or quietly did not, is one you cannot judge.",
    added: [
      "Attach other markdown files to a conversation, sent in full.",
      "Optionally send the list of files in your folder, so the model can ask for one.",
      "A row above the message box showing exactly what chat can see.",
    ],
    changed: [
      "Starting a new conversation clears its attachments rather than carrying them over.",
    ],
  },
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
