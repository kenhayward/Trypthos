import type { Release } from "./types";

/// Every release already covered by an epoch. Grows without bound and must NEVER reach the initial
/// bundle: only the epoch drill-down page may import this module, and the barrel must not re-export
/// it. bundleBoundary.test.ts asserts that directly, because nothing else would catch it - an eager
/// `import { ARCHIVE }` type-checks, renders correctly, and passes every other test while putting
/// the whole history on every page load.
export const ARCHIVE: Release[] = [
  {
    version: "0.92.0",
    date: "2026-09-27",
    pr: 204,
    headline: "Find stays where you are reading",
    summary:
      "Finding something while you read a document in Preview no longer drags you into an editable view to show the answer. The search now follows the view you are in: in Live or Source it marks matches over the source as before, and in Preview it marks them in the rendered prose right where you were reading. Because it searches what is on screen, a query aimed at markdown's own characters - a # heading marker, a pair of asterisks - finds nothing in Preview, where those characters are not drawn; the same query still finds them in Source. Maths, diagrams and embedded notes are drawn rather than shown as text, so Preview does not search inside them, and a phrase that wraps onto a new line in the source is still found as one. Switching views while a find is open clears its results, since offsets measured against one view would sit over nothing in the other. Find in Files is unchanged: its hits are source offsets, so opening one of them brings the file into an editable view.",
    changed: [
      "Find now searches and highlights within Preview instead of switching you to Live or Source - it marks matches in the rendered prose where you were reading.",
    ],
  },
  {
    version: "0.91.1",
    date: "2026-09-26",
    pr: 202,
    headline: "The Paste as markdown menu item shows its shortcut",
    summary:
      "The right-click menu's Paste as markdown item now displays the key that performs it - Ctrl+Shift+V (Cmd on macOS) - beside its label, like Save and Find show theirs. The shortcut itself is unchanged; this makes it visible where you would look for it.",
    fixed: [
      "The right-click menu's Paste as markdown item shows its Ctrl+Shift+V (Cmd on macOS) shortcut next to the label.",
    ],
  },
  {
    version: "0.91.0",
    date: "2026-09-26",
    pr: 199,
    headline: "A keyboard shortcut for Paste as markdown",
    summary:
      "The Paste as markdown command now has a keyboard shortcut - Ctrl+Shift+V (Cmd on macOS). With your caret in an editable markdown document, in Live or Source view, it converts what you copied and lands it at the caret as one undo step. With the focus anywhere else it does nothing, so a habit from another app cannot write into a document you are not looking at.",
    added: [
      "Ctrl+Shift+V (Cmd on macOS) pastes the clipboard as markdown while your caret is in an editable markdown document - the same conversion the toolbar button and right-click menu offer.",
    ],
  },
  {
    version: "0.90.0",
    date: "2026-09-26",
    pr: 198,
    headline: "Paste as markdown in the right-click menu",
    summary:
      "The Paste as markdown command is now reachable from the editor's right-click menu as well as from the Source view toolbar. Right-click inside a document - in Live or Source view - and choose it to paste what you copied with its structure kept: headings become # headings, lists keep their markers, code blocks arrive fenced and tables stay tables. The item appears only where it would land, over an editable markdown document; right-clicking anywhere else - the chat box, a settings field - shows the usual menu without it, so a paste can never end up in a document you were not looking at. As with the button, one press is one Ctrl+Z.",
    added: [
      "The editor's right-click menu offers Paste as markdown in Live and Source view, beside cut, copy, paste and select all.",
    ],
  },
  {
    version: "0.89.0",
    date: "2026-09-25",
    pr: 197,
    headline: "Paste a spreadsheet range as a markdown table",
    summary:
      "The Paste as markdown button on the Source view toolbar now turns a range copied from Excel or Google Sheets into a markdown table. The range's first row becomes the header, columns of numbers are right-aligned, a line break inside a cell is kept as a break, and merged cells keep the columns lined up. Colours, fonts, borders and number formats are left behind, and numbers arrive exactly as the sheet displayed them. A single cell pastes as its text. Tab-separated text from programs that offer nothing richer becomes a table as well.",
    added: [
      "Paste as markdown turns a range copied from Excel or Google Sheets into a markdown table, with its first row as the header and numbers right-aligned.",
      "Tab-separated text on the clipboard pastes as a table.",
    ],
  },
  {
    version: "0.88.0",
    date: "2026-09-25",
    pr: 196,
    headline: "Paste as markdown understands Word",
    summary:
      "The Paste as markdown button on the Source view toolbar now handles text copied from Word - on Windows or macOS, Word for the web, or Google Docs - as well as from web pages and chat replies. Headings, bulleted and numbered lists (nested as they were, and starting at the same number), bold, italic, strikethrough, quotations and tables come across as markdown, and text in a monospaced font becomes code. Everything markdown has no way to say - fonts, sizes, colours, underline, spacing and page breaks - is left behind rather than turning into stray characters. Pictures copied out of a Word document are left out, since Word only puts a temporary file on the clipboard. Tables from any source now use their first row as the header instead of an empty one.",
    added: [
      "Paste as markdown converts text copied from Word, Word for the web and Google Docs, keeping headings, lists, emphasis, quotations, tables and code.",
    ],
    changed: [
      "A pasted table with no header row uses its first row as the header, instead of gaining an empty one.",
    ],
  },
  {
    version: "0.87.3",
    date: "2026-09-25",
    pr: 195,
    headline: "Diagrams drawn in Mermaid's new look",
    summary:
      "Mermaid diagrams in Preview are now drawn by Mermaid 12, in its new default look: rounded, softly coloured shapes for sequence and other diagrams, cleaner lines, and a new layout engine that arranges flowcharts and similar diagrams with fewer crossing lines. The dark theme has its own matching palette. Your diagrams' text is unchanged - only how they are drawn - so a diagram may take up a little more or less room than before.",
    changed: [
      "Mermaid diagrams are drawn in Mermaid 12's new look and layout, in light and dark.",
    ],
  },
  {
    version: "0.87.2",
    date: "2026-09-25",
    pr: 194,
    headline: "Library updates, including Electron and React",
    summary:
      "Brings the libraries Trypthos is built on up to date: Electron 44.4.2, which carries the latest Chromium security fixes, React 19.3, and patch releases of the editor (CodeMirror), the markdown renderer (marked) and its sanitiser (DOMPurify). Nothing should look or behave differently. The test tooling moves to Vitest 5, which changes nothing you can see.",
    changed: [
      "Electron updated to 44.4.2 and React to 19.3, with patch releases of CodeMirror, marked, DOMPurify, i18next and zod.",
    ],
  },
  {
    version: "0.87.1",
    date: "2026-09-25",
    pr: 193,
    headline: "Long runs of spaces or tabs no longer freeze the app",
    summary:
      "A heading line holding a long run of spaces or tabs could stop the app responding for seconds, or indefinitely: a few thousand were enough. It showed up when chat inserted text after a heading, and when a note embedded a heading from another note. Several smaller slowdowns of the same kind are gone too - on documents chat appends to, on replies with many blank lines, and on addresses or paths full of slashes. All of these now take time in proportion to the text.",
    fixed: [
      "A heading line with a long run of spaces or tabs no longer freezes chat edits or embedded headings.",
      "Appending with chat, reading a reply, and checking an address or path no longer slow down on long runs of one character.",
    ],
  },
  {
    version: "0.87.0",
    date: "2026-09-25",
    pr: 184,
    headline: "Paste as markdown keeps the formatting of text copied from a chat reply",
    summary:
      "Copying part of a rendered chat reply - from Claude or anything else that shows formatted text - and pasting it into a markdown file used to give you plain text: headings became ordinary lines, list markers and code fences disappeared, and paragraphs could arrive run together on one line. The formatting toolbar in Source view now has a Paste as markdown button at its end. It reads the formatted copy on the clipboard and writes it back as markdown, keeping headings, lists, code blocks with their language, links, emphasis and tables, and leaving out the Copy buttons that sit on copied code blocks. If the clipboard holds only plain text, which is what a reply's own Copy button gives you, that is pasted as it is. Ctrl+V is unchanged and still pastes plain text.",
    added: [
      "A Paste as markdown button on the Source view toolbar, which pastes copied formatted text as markdown with its structure kept.",
    ],
  },
  {
    version: "0.86.1",
    date: "2026-09-18",
    pr: 183,
    headline: "Live mode no longer leaves part of a document as raw markdown",
    summary:
      "Live mode could leave part of a document looking like raw markdown - hashes before headings, asterisks around bold text, the full address of every link - until you moved the caret. It happened when the editor had not finished reading a document by the time it was first drawn, which is more likely in a long document, or on a busy computer with even a short one: whatever it read afterwards was never given its formatting. It is now formatted as soon as the editor has read it, without waiting for you to click.",
    fixed: [
      "Live mode formats the whole document once it has been read, instead of leaving the part read last as raw markdown until the caret moves.",
    ],
  },
  {
    version: "0.86.0",
    date: "2026-09-18",
    pr: 182,
    headline: "A home page for every folder, and a graph for any folder whose notes link",
    summary:
      "Clicking any workspace's name in the folder browser now opens one page for it, whatever kind it is: its name, what it is and where it lives, how many notes, links and attachments it holds, its README, and its graph. The graph and the README each get the whole page in turn, with one control to move between them, because a graph zooms with the wheel and a README scrolls with it. A page with only one of the two shows just that one, and a folder with neither says so in words. The graph is no longer only for Obsidian vaults: any folder on this machine whose markdown files link to each other has one, and the local graph under the folder browser follows notes in any folder too. Build and dependency folders such as node_modules, dist and build are left out, and so is anything the folder's own .gitignore excludes, so a project folder's graph shows its own writing rather than its dependencies. A very large folder's graph stops at 5,000 notes and says so. GitHub repositories keep their details at the top of their page, with their README below, and still have no graph. Each page's tab is named for its folder.",
    added: [
      "A home page for every workspace, opened by clicking its name, with its README and its graph.",
      "A graph for any local folder whose notes link to each other, not only an Obsidian vault.",
      "The local graph under the folder browser follows notes in any local folder.",
    ],
    changed: [
      "A GitHub repository's page and a vault's graph are now the same kind of page, with the repository's details at the top.",
      "A folder's graph leaves out build and dependency folders, and whatever its .gitignore excludes.",
      "The counts at the foot of the graph moved to the top of the page, so they are said once.",
    ],
  },
  {
    version: "0.85.0",
    date: "2026-09-18",
    pr: 181,
    headline: "Pick a folder for chat without opening it, and see your Obsidian icons",
    summary:
      "Clicking a folder in the browser used to do two things at once: point chat at it, and open or close it. Choosing which folder chat reads is something you do often and deliberately, and it was the one thing you could not do without the tree moving under you. The triangle now has a target of its own, wide enough to hit without aiming and reaching into the space either side of it, and clicking the icon or the name selects the folder and leaves it exactly as it was. The triangle itself is larger. Left and Right arrows open and close the folder a row is on, so nothing needs the mouse. On top of that, a vault whose folders and notes have icons assigned with Obsidian's Iconic plugin now shows those icons in the browser instead of the plain folder and file marks, in the colour you chose there. Icons set in Obsidian while Trypthos is open appear after a refresh.",
    added: [
      "Icons assigned in Obsidian with the Iconic plugin are drawn on folders and files in the browser, in the colour chosen there.",
      "Left and Right arrows open and close the folder a row is on.",
    ],
    changed: [
      "Clicking a folder's icon or name selects it for chat without opening or closing it. The triangle, and the space around it, is what opens and closes now.",
      "The disclosure triangle is larger, with a wider area around it to click.",
    ],
  },
  {
    version: "0.84.1",
    date: "2026-09-18",
    pr: 180,
    headline: "Make the vault graph readable when you click a node",
    summary:
      "Two things went wrong when you clicked a node in a vault graph. The name of the node you clicked was drawn on a white box whatever the theme, so in dark mode the label you had just asked for was the one thing you could not read. And selecting a node was meant to keep that note and everything it links to at full strength while the rest of the graph faded back, but the fade was drawn louder than the links around the selection, so the highlight looked as though it were pointing at every note except the one you clicked. Both are fixed, in the global graph and the Local graph pane, in light and dark.",
    fixed: [
      "A selected node's name is written on a panel that follows the theme instead of a white box, so it stays readable in dark mode.",
      "Selecting a node now fades the rest of the graph back rather than bringing it forward, so the links out of the selected note are the ones that stand out.",
    ],
  },
  {
    version: "0.84.0",
    date: "2026-09-17",
    pr: 176,
    headline: "See an Obsidian vault as a graph of its notes, links and tags",
    summary:
      "Clicking an Obsidian vault's row in the folder browser now opens a graph of the vault in a tab: every note as a node, every link between notes as a line, with pictures and other attachments, tags and links to notes that do not exist yet available from chips above the graph. Search highlights matching notes and Enter centres on the best one. Click a node to see what it links to, double-click a note to open it, and double-click a link to a missing note to create that note where Obsidian would put it. A Local graph pane under the folder browser follows the note you are editing and shows its neighbours, one to three links away, and folds away to its header. The graph is built when a vault opens and when you press refresh, keeps itself up to date as you save, create and rename notes in Trypthos, and shows its progress while a large vault is read. Changes made in Obsidian while Trypthos is open appear after a refresh. Vaults opened from GitHub do not have a graph yet.",
    added: [
      "A graph of an Obsidian vault, opened by clicking the vault's row, with chips for notes, attachments, tags, unresolved links and orphans, and a search box.",
      "A Local graph pane under the folder browser, following the open note, with a depth of one to three links.",
      "Double-click a link to a missing note in either graph to create it in Obsidian's default location for new notes.",
      "Indexing progress for large vaults, and a refresh button to rebuild the graph.",
    ],
  },
  {
    version: "0.83.0",
    date: "2026-09-17",
    pr: 175,
    headline: "Right-click the empty folder browser to open a folder, repository or vault",
    summary:
      "Right-clicking an empty part of the folder browser - below the open folders, or anywhere in it before anything is open - now shows a menu with the same choices as the buttons at the top of the panel, in the same order: Open Obsidian vault when Obsidian is installed, Open GitHub repository, and Open folder. Right-clicking a folder or file still shows that row's own menu. Right-click menus opened near the bottom or right edge of the window now open upwards or leftwards instead of running off it, so every entry can be reached.",
    added: ["A right-click menu on the folder browser's empty space, with Open Obsidian vault, Open GitHub repository and Open folder."],
    fixed: ["A right-click menu opened near the edge of the window no longer runs off it."],
  },
  {
    version: "0.82.0",
    date: "2026-09-17",
    pr: 173,
    headline: "Give the chat more of the window, or all of it",
    summary:
      "A long conversation is hard to read down a third of the window, and the chat used to stop there. Its seam now drags out until the editor is down to its narrowest, so in a wide window the chat can take most of the room. To give it all of the room, use the new double arrow at the left end of the editor's tab strip: the editor folds away to the left and the chat fills the space. A strip at the edge brings the editor back, and so does opening a file, whether from the folder browser, a link in the chat or the recent files. Hiding the editor closes nothing - open files and unsaved changes are there when it comes back - and hiding the chat brings the editor back too. The window remembers whether the editor was hidden.",
    added: ["A button at the left of the editor's tab strip hides the editor so the chat can fill the window."],
    changed: ["The chat panel can be dragged much wider, up to where the editor reaches its narrowest."],
  },
  {
    version: "0.81.0",
    date: "2026-09-16",
    pr: 172,
    headline: "Set how many tool calls each model may make per question",
    summary:
      "Each chat model now has a Tool calls per question setting, in Settings under Chat models: how many times it may read, list or search files for one question before it is asked to answer with what it has. Every model used to be held to 10, which could stop a model reviewing a repository before it had read what it needed. The limit now starts at 100, for new models and for the ones you already have, and has no upper limit - each call sends the conversation again, so what really limits a model is its context window, and a model with a very large one can be given room for a long review. A model that reaches its limit is still asked to answer from what it has read.",
    added: ["A Tool calls per question setting on each chat model, 100 by default with no upper limit."],
    changed: ["Chat models are no longer held to 10 tool calls per question; existing models start at 100."],
  },
  {
    version: "0.80.0",
    date: "2026-09-16",
    pr: 171,
    headline: "Chat can find its way around a whole repository",
    summary:
      "Attaching a folder to chat now tells the model about the folders inside it, not only the files, so it knows there is more below - before, a model attached to a repository root saw a few top-level files and nothing to say the code was one level down, and files had to be attached by hand. A model with tool calling can now list every readable file below a folder in a single call, as paths it can read straight away, instead of listing one folder per call; each call counts toward how many one question may make, so walking a tree folder by folder could use them all up before anything was read. It is also told to search for which files mention something rather than reading them one by one. Listing everything below a folder and searching both pass over .git and node_modules, which from a repository root are most of the files and none of the ones you meant; either can still be listed or read directly, and .github is not passed over. A model without tool calling is told it may ask for a file inside one of the listed folders by its path. You can now attach a whole repository and name the folders that matter in your question.",
    added: [
      "The folders directly inside an attached folder are listed for the model beside its files.",
      "list_directory can list every readable file below a folder in one call.",
    ],
    changed: [
      "Listing everything below a folder and searching pass over .git and node_modules.",
    ],
  },
  {
    version: "0.79.4",
    date: "2026-09-16",
    pr: 170,
    headline: "Chat statistics say when token counts cover several requests",
    summary:
      "A reply that calls tools makes one request to the model per tool call, and each request sends the whole conversation again. Chat statistics added those requests up but did not say so, so a reply could show more than 140,000 tokens sent beside about 17,000 of context used, which looked like a contradiction. Both numbers were right. For a reply that made more than one request, Tokens sent, Tokens returned and Total tokens now say how many requests they cover, for example \"138,770 in 10 requests\", and a new row shows what the last request sent. Context used is unchanged: it is how full the model's context is now. The conversation's total response time also no longer shows 0 ms while a reply is still arriving. It says Not yet, or gives the time of the replies that have finished and how many are still arriving.",
    fixed: [
      "Token counts in Chat statistics say how many requests they cover, with what the last request sent shown beside them.",
      "The conversation's total response time no longer shows 0 ms while a reply is still arriving.",
    ],
  },
  {
    version: "0.79.3",
    date: "2026-09-16",
    pr: 168,
    headline: "Replies no longer vanish on servers that mark empty fields as null",
    summary:
      "With some OpenAI-compatible servers every reply ended with \"The model finished without writing an answer\", even though the model had answered - Chat statistics showed the tokens it returned, and the Conversation Log showed its thinking and answer arriving. Since 0.78.0 Trypthos asks a streamed reply to report its token usage, and some servers answer that by marking usage as null on every piece of the reply until the last. They also mark the answer as null on pieces that carry thinking, and the other way round. Trypthos treated each of those pieces as malformed and skipped it, so nothing reached the panel but the final token count. A null is now read as \"nothing here\", the same as a missing field, so the thinking and the answer stream in as they should, with or without streaming.",
    fixed: [
      "Replies from servers that send null for empty fields now appear, instead of the chat saying the model finished without writing an answer.",
    ],
  },
  {
    version: "0.79.2",
    date: "2026-09-16",
    pr: 165,
    headline: "Two tests that failed on some runs and not others now give the same answer every time",
    summary:
      "Nothing changes in the app. Two of Trypthos's automated tests check closing a tab - one by its close button, one with Ctrl+W. Both checked straight after the click or key press, but closing a tab takes a moment even when nothing is unsaved, so they sometimes looked before the tab had gone and failed. They now wait for the tab to close and the editor to update, so they pass or fail on whether closing a tab works, on every run and every machine.",
    fixed: [
      "The tests for closing a tab, from the tab strip and with the keyboard, no longer fail at random.",
    ],
  },
  {
    version: "0.79.1",
    date: "2026-09-16",
    pr: 163,
    headline: "The saved conversations list is no longer cut off",
    summary:
      "The list of saved conversations, opened from the clock icon at the top of the chat panel, now opens entirely inside the panel. Before, it hung from the clock button and reached past the panel's left edge, so the start of each conversation's title and file path was hidden. It now lines up with the right edge of the chat panel's toolbar, as the Chat statistics panel does.",
    fixed: [
      "The saved conversations list opens wholly inside the chat panel, instead of being cut off on the left.",
    ],
  },
  {
    version: "0.79.0",
    date: "2026-09-16",
    pr: 161,
    headline: "See everything a conversation sent and received, in a Conversation Log",
    summary:
      "The Chat statistics panel now has a View conversation log button. It opens a read-only Conversation Log tab with the thread as the chat panel holds it - your questions, the replies, the thinking and the tool calls - followed by every request each reply made, exactly as it went and came back: the address it was sent to, the HTTP status, the full request body, and the response as the endpoint sent it, shown as text rather than formatted. It is for finding out what really happened when a reply looks wrong. For each reply it also says how much answer and how much thinking reached the panel, how many times the panel cleared the reply because it was a request to read a file, what any error said, and what Trypthos did with the response that the response does not show, such as a proposed edit it could not read and dropped. When the endpoint reported tokens returned but no answer text reached the panel, the log says so at the top of that reply. Your API key is never included - Trypthos removes it even from text the endpoint sends back. The log covers the conversation while it is open and is not saved; open it again after another reply to see that reply too. Each request and response is shown up to a million characters.",
    added: [
      "A View conversation log button in Chat statistics, opening a read-only Conversation Log tab with the thread and every request and response each reply made.",
    ],
  },
  {
    version: "0.78.0",
    date: "2026-09-16",
    pr: 160,
    headline: "Chat statistics, and copy a reply as markdown",
    summary:
      "The chat panel's toolbar has two new buttons beside Save. Chat statistics, the i button, shows how the most recent reply went: which model answered and whether it completed, was stopped or failed; the time to first token, the total response time and the writing time between them; tokens per second; the tokens sent, returned and in total; the context used against the model's context window; and how many requests and tool calls the reply took. Below that are totals for the conversation so far. Token counts are the ones your endpoint reports, and Trypthos now asks streamed replies to report them. An endpoint that still does not has the tokens it returned estimated from the text, marked About, and the tokens sent shown as Not reported. Statistics are kept while a conversation is open and are not saved with it. Copy response puts the most recent reply on the clipboard as the markdown the model wrote, so it pastes into a document with its headings, lists and code intact, and shows a tick when it is done. It is unavailable while a reply is still arriving.",
    added: [
      "A Chat statistics button on the chat toolbar, with timings, token counts and context used for the latest reply and totals for the conversation.",
      "A Copy response button on the chat toolbar that copies the latest reply as markdown.",
    ],
    changed: ["Streamed chat requests ask the endpoint to report token usage."],
  },
  {
    version: "0.77.0",
    date: "2026-09-15",
    pr: 159,
    headline: "Open an Obsidian vault from Obsidian's own list",
    summary:
      "If Obsidian is installed, the folder browser now has an Obsidian button to the left of the GitHub one. It lists every vault Obsidian knows about on this computer, by name with its folder underneath, read from Obsidian's own list of vaults each time you open it. Click a vault to open it, or Cancel. A vault whose folder has been moved or deleted since Obsidian last saw it is listed as Folder not found and cannot be chosen. The vault opens as a folder, and behaves exactly as any other folder does - the same tree, right-click menu, rename, refresh and saving - with Obsidian's logo on its row so you can tell it apart, and it reopens as a vault next time you start Trypthos. Choosing a vault that is already open, whether you opened it as a vault or as an ordinary folder, selects it in the browser rather than opening a second copy. Without Obsidian installed the button does not appear.",
    added: [
      "An Obsidian button in the folder browser, shown when Obsidian is installed, that lists its vaults and opens the one you choose.",
      "Obsidian's logo on the row of a folder opened as a vault.",
    ],
  },
  {
    version: "0.76.0",
    date: "2026-09-15",
    pr: 158,
    headline: "Obsidian math, diagrams, embedded notes, and Obsidian's marks while you edit",
    summary:
      "Obsidian notes now render the rest of what Obsidian shows. Mathematics written in LaTeX between dollar signs is typeset, inline and on lines of its own, while a sentence about $5 and $10 stays as written. Mermaid diagrams in a mermaid code block are drawn in any markdown document, as they are on GitHub. An embedded note is shown in place under a link to it - the whole note, one heading with what is under it, or one block by its id - with embeds inside it followed three notes deep and never round in a circle, and pictures inside it read from beside that note. Both libraries are loaded only the first time a document needs them. The Live and Source views now understand Obsidian's marks too: Source colours wiki links, highlights, tags, math and callout types, and Live hides a wiki link's brackets, and its target when it has shown text, and the markers of highlights and math, showing tags and callout types in colour and comments dimmed. Ctrl-click (Cmd-click on a Mac) a wiki link or an embed in Live to open the note it names. The editor also now reads GFM's tables, strikethrough and task lists, which it previously saw as plain text, so Live shows strikethrough struck out. And coloured code in Preview and in chat replies no longer loses its colouring when the window redraws for some other reason, such as typing in the chat box.",
    added: [
      "LaTeX math in Obsidian notes, typeset with KaTeX.",
      "Mermaid diagrams in any markdown document.",
      "Embedded notes shown in place: a whole note, a heading, or a block.",
      "Obsidian's marks coloured in Source and rendered in Live, with Ctrl-click to follow a wiki link or embed.",
    ],
    changed: [
      "The editor reads GFM tables, strikethrough and task lists, and Live shows strikethrough struck out.",
    ],
    fixed: [
      "Coloured code in Preview and in chat replies keeps its colouring when the window redraws, instead of losing it until the text changes.",
    ],
  },
  {
    version: "0.75.0",
    date: "2026-09-15",
    pr: 157,
    headline: "Read Obsidian notes as Obsidian shows them, and GitHub's extras everywhere",
    summary:
      "Preview now renders notes written in Obsidian in their full layout. Files from Obsidian and from GitHub are both .md, so Trypthos decides from what a file contains: wiki links, embeds, highlights, comments, inline footnotes, block ids and Obsidian's callouts all mean Obsidian, and a file inside an Obsidian vault - a folder with an .obsidian folder in it or above it - always is. A chip in the status bar says GFM or Obsidian, explains what decided it when you hover, and lets you choose for that file until the app is closed; choosing never changes the file. In an Obsidian note, Preview shows wiki links that open the note they name wherever it is in the folder, preferring the one nearest, embedded pictures found by name in an attachments folder and drawn at the size given, highlights, tags, callouts of every Obsidian type with titles and folding, inline footnotes, tasks ticked with any mark, and a line break wherever the author made one; comments and block ids are hidden. Some of this is what GitHub itself shows beyond GFM, so every markdown document now gets it: numbered footnotes gathered at the end, GitHub's five alerts, and front matter shown as a table of properties instead of a rule and a heading. Headings can now be linked to within a document. Mathematics, Mermaid diagrams, embedded notes shown in place, and these marks in the Live and Source views come in later releases.",
    added: [
      "A status bar chip naming the markdown flavour - GFM or Obsidian - detected from the file and its folder, and choosable per file.",
      "Obsidian rendering in Preview: wiki links, picture embeds, highlights, comments, tags, callouts with titles and folding, inline footnotes, block ids and line breaks.",
      "Footnotes, GitHub alerts and front matter as a properties table, in every markdown document.",
      "Links to a heading in the same document land on it.",
    ],
    changed: [
      "The Markdown Syntax Guide covers both flavours and what GitHub renders beyond GFM.",
    ],
  },
  {
    version: "0.74.1",
    date: "2026-09-15",
    pr: 156,
    headline: "Apply a chat edit in any view, Preview included",
    summary:
      "When the chat model proposed a change to the open document and the document was in Preview, pressing Apply did nothing to the document, yet the card switched to Applied, so the change was lost with no way to try again. Preview shows the document without an editor behind it, and the change was only ever handed to the editor. Apply now puts the change into the document in every view: in Preview it appears in the rendered page straight away and the document is marked unsaved, and in Live and Source it still lands where your cursor can see it, as one step you can undo.",
    fixed: [
      "Applying an edit the chat model proposed changes the document in Preview, instead of doing nothing while saying Applied.",
    ],
  },
  {
    version: "0.74.0",
    date: "2026-09-15",
    pr: 154,
    headline: "Saving a chat works, asks for a name, and keeps what was attached",
    summary:
      "Save this conversation did nothing for most conversations: a reply that made a tool call or showed its thinking was refused when saving, and nothing on screen said so, so the conversation never appeared under Saved conversations. It saves now, and asks what to call the conversation, starting from the question that began it or from the name it was saved under before. It also says what is kept with it. The text of every attached file is saved inside the conversation, so it still has the same words to go on however the file changes later. An attached folder is saved as its path only, because a folder is only ever sent to a model as a list of names. Opening a saved conversation from the clock icon puts it back in the chat panel: every question and reply, with their tool calls and thinking, the attached files with the text they had, and the folder switched on and chosen again if it is open - if it is not, the panel says so. The panel shows the name of the saved conversation you are in, and saving it again updates it.",
    added: [
      "Saving a conversation asks for a name, and says what is saved with it.",
      "A saved conversation keeps the text of its attached files and the path of its attached folder, and reopening it restores them.",
      "The chat panel shows the name of the saved conversation on screen.",
    ],
    fixed: [
      "Saving a conversation whose replies made tool calls or showed their thinking works, instead of silently doing nothing.",
    ],
  },
  {
    version: "0.73.1",
    date: "2026-09-15",
    pr: 152,
    headline: "Don't Save closes the window again",
    summary:
      "Closing a window with unsaved changes asks whether to save them. Choosing Don't Save did not close the window: the same question came straight back, and kept coming back, so the only ways out were to save the changes or cancel. Trypthos did ask, and did hear the answer, but the part of the app that closes the window was never told that you had already been asked, so it asked again. Don't Save now closes the window and leaves the file as it was on disk, in the main window and in a document opened in its own window.",
    fixed: [
      "Choosing Don't Save when closing a window with unsaved changes closes it, instead of asking again.",
    ],
  },
  {
    version: "0.73.0",
    date: "2026-09-15",
    pr: 150,
    headline: "Rename files and folders, open them in Explorer, and a chat box that grows as you type",
    summary:
      "Right-click a file or folder in a local workspace and two new entries are there. Rename opens a small window with the current name, the part before the extension already selected, and Save and Cancel. It says straight away when the name is already used in that folder - whatever its case - or is one Windows cannot hold: a name with \\ / : * ? \" < > |, a device name such as CON or NUL, a trailing dot, or a name that is too long. The same rule applies on macOS, so a folder you share with a Windows machine stays usable there. Changing only the case of a name works. A file that is open keeps its tab and any unsaved changes, and saves to its new name; renaming a folder keeps what you had expanded inside it. If the rename is refused - the name was taken since, or another program has the file open - the window stays open and says why. Open in Explorer (Open in Finder on a Mac) opens a folder, or the folder a file is in with the file selected; it is also on the workspace's own row. Neither is offered in a GitHub repository, where a rename would be a commit, and the workspace folder itself cannot be renamed. The chat box now starts two lines tall and grows as you type, up to twelve lines, then scrolls.",
    added: [
      "Rename on the right-click menu of a local file or folder, checking the name is free in its folder and valid on Windows.",
      "Open in Explorer, or Open in Finder on macOS, on the right-click menu of a local file, folder or workspace.",
    ],
    changed: [
      "The chat box grows with what you type, up to twelve lines, and then scrolls.",
      "A file Trypthos does not open now has a right-click menu too, for renaming it or finding it on disk.",
    ],
  },
  {
    version: "0.72.1",
    date: "2026-09-14",
    pr: 149,
    headline: "Hold files the model reads for itself to the same budget, and say when one is cut",
    summary:
      "A file the model reads for itself from the folder you gave it was sent whole however large it was: a limit written for these reads had never actually been applied, and nothing tied them to the model's context window. They now follow the same budget attachments do - nine tenths of the model's context window when one is set, or about 60,000 characters when it is not. A read that has to be cut tells the model it only has the beginning, and is marked in the reply's Tool calls list, on the call itself with how much of the file was sent and on the list's own line so you can see it without opening it. Saved chats keep the mark. The hint beside a model's context window in Settings now also says that the window sizes what chat sends, not only the gauge.",
    fixed: [
      "A file the model reads for itself follows the same budget as attachments, instead of being sent whole.",
      "A read that had to be cut is marked in the reply's Tool calls list, with how much of the file was sent.",
      "The context window hint in Settings says what the window is used for.",
    ],
  },
  {
    version: "0.72.0",
    date: "2026-09-14",
    pr: 147,
    headline: "Set how long to wait for each chat model",
    summary:
      "A chat request used to give up if the model sent nothing for five minutes, a limit built into the networking Trypthos used and not something you could change - so a large model that thinks for a long time before it starts to answer could time out with its answer still coming. Each model in Settings now has a Reply timeout, in minutes: how long to wait while it sends nothing. It is 10 minutes by default and can be anything from 1 to 60, and existing models start at 10. The wait starts again whenever part of a reply arrives, so a long answer that keeps coming is never cut off. When a model does go quiet for longer, the chat says which model and for how long, keeps whatever part of the reply had already arrived, and points you at the setting. Chat requests now also go through the same networking GitHub already used, which follows your system's proxy and certificate settings.",
    added: [
      "A Reply timeout on every chat model: how long to wait while it sends nothing, from 1 to 60 minutes, 10 by default.",
    ],
    changed: [
      "Chat requests no longer give up after five minutes of silence, and follow the system's proxy and certificate settings.",
    ],
  },
  {
    version: "0.71.1",
    date: "2026-09-14",
    pr: 146,
    headline: "Send attachments whole to models with room for them",
    summary:
      "Attached files were cut short or sent empty even to models with a very large context window. The open document, your selection and every attachment shared one fixed budget of about 60,000 characters whatever the model could take, so with a large document open a 36,000-character attachment arrived with only its first few thousand characters and the next one arrived empty. The budget now follows the model: when a model's context window is set in Settings, your document and attachments may use up to nine tenths of it, so a model with a 262,000-token window is sent large files whole. A model with no context window set keeps the old budget. An attachment that still does not fit is now marked on its chip - cut short, or not sent - with the reason on hover, instead of only the model being told.",
    fixed: [
      "Documents and attachments sent to chat are sized to the model's context window, when one is set, instead of a fixed 60,000 characters.",
      "An attachment that does not fit is marked cut short or not sent on its chip.",
    ],
  },
  {
    version: "0.71.0",
    date: "2026-09-14",
    pr: 144,
    headline: "Add files to the chat from the folder browser, and make Attach a file work",
    summary:
      "Choosing a file from the chat's Attach a file list did nothing: the list closed and no attachment appeared. The list named files one way and reading them needed another, so every pick was quietly refused. Picks now attach, and a file that cannot be attached - too large, not text, or no longer there - says so beside the attachments instead of vanishing without a word. You can also add a file to the chat straight from the folder browser, either with Add to Chat on the file's right-click menu, which works in any open folder or repository and opens the chat panel if it was hidden, or by dragging the file onto the chat panel, which shows that it will take it while you hold it there. Attachments now show the file's name, with its full path on hover, so a long folder name no longer hides which file it is.",
    added: [
      "Add to Chat on a file's right-click menu in the folder browser.",
      "Drag a file from the folder browser onto the chat panel to attach it.",
    ],
    changed: [
      "An attachment shows the file's name, with its full path on hover.",
    ],
    fixed: [
      "Choosing a file from Attach a file now attaches it, and a file that cannot be attached says why.",
    ],
  },
  {
    version: "0.70.0",
    date: "2026-09-14",
    pr: 142,
    headline: "Move a tab into its own window, unsaved changes and all",
    summary:
      "Right-clicking a file in the folder browser could already open it in a focused window of its own, but only as it was on disk. The tab menu now offers Open in New Window too. It opens that same focused window with the tab's text exactly as it stands, including changes you have not saved, and then closes the tab without asking about unsaved work, because nothing was thrown away. The tab only closes once the new window has the text: if the window does not open, the tab stays put with your changes and Trypthos tells you, and anything you type while the window is opening keeps the tab open as well. Saving from the new window is still checked against the file as the tab last read it, so a file that changed on disk in the meantime is refused rather than overwritten. The entry is offered for files in local folders, not for GitHub repositories or documents that have never been saved.",
    added: [
      "Open in New Window on the tab right-click menu, which moves the tab and its unsaved changes into a focused window.",
    ],
  },
  {
    version: "0.69.0",
    date: "2026-09-14",
    pr: 141,
    headline: "See every tool call a chat reply made, folded away",
    summary:
      "A reply used to end with a single line naming the files the model read. It could not say what else the model did - a folder listing, a search, a comparison - and a search showed up as a blank name in that line. Each reply that used tools now has a Tool calls block under it, folded away like the model's thinking and only there when a tool was actually used. Open it to see every call in the order it was made: the tool's name and what it was aimed at, such as the file it read, the folder it listed or the text it searched for. Saved chats keep the list, and chats saved by earlier versions open with their file reads shown the same way.",
    added: [
      "A folded Tool calls block under each chat reply that used tools, listing every call with what it was aimed at.",
    ],
    changed: [
      "The line naming the files a reply read is replaced by the Tool calls block.",
      "While a reply waits on a tool other than reading a file, the chat says which tool it is using rather than an empty Reading message.",
    ],
  },
  {
    version: "0.68.2",
    date: "2026-09-14",
    pr: 140,
    headline: "Let the folder you attach reach chat tools",
    summary:
      "A model could see the folder you attached, and it could ask to read a file inside it, but the app lost which open workspace that folder belonged to before handling the request. It then answered as though the file was not available. The folder now keeps a private workspace identity for tool requests while the model sees only the ordinary folder path, so reads, listings, searches and comparisons reach the folder you chose without exposing an internal workspace ID in the chat context.",
    fixed: [
      "Chat tools now resolve the attached folder in the correct open workspace, including files a directory listing finds below it.",
    ],
  },
  {
    version: "0.68.1",
    date: "2026-09-14",
    pr: 139,
    headline: "Let a model read the nested file it found",
    summary:
      "A model can list what is in the folder you attached, including folders below it, and then ask to read a file it found. Until now that second step failed unless the file happened to be on the first short list at the top of the folder, which made the listing useful only for names. It can now read any enabled file inside the folder you attached, including one it finds below it. The boundary has not widened: a file outside that folder is still refused, even when it is elsewhere in the same workspace.",
    fixed: [
      "A model can read an enabled file it discovers below the folder you attached, rather than being refused because it was not on the first list.",
    ],
  },
  {
    version: "0.68.0",
    date: "2026-09-14",
    pr: 138,
    headline: "Use complete chat responses when a model streams incomplete tool calls",
    summary:
      "Chat normally streams a reply as it arrives. Some model and server combinations lose part of a tool call while doing that: the model asks to read a file, but the streamed response omits the tool name, so Trypthos cannot run it and the conversation ends there. Every chat model now has a Stream replies switch, on by default. Turn it off for that model when its server has this problem and Trypthos asks for one complete response instead. It then handles the reply, its reasoning and its tool calls in exactly the same way, including reading a file and continuing the conversation, only showing the reply after the server has finished it.",
    added: [
      "A Stream replies switch on every chat model, for endpoints whose streamed tool calls are incomplete.",
    ],
  },
  {
    version: "0.67.0",
    date: "2026-09-14",
    pr: 136,
    headline: "Create files and folders where you are working, or focus a file in its own window",
    summary:
      "The workspace menu now lets you make an empty file or a folder exactly where you are looking, instead of making it elsewhere and finding it afterwards. Right-click a local folder, choose New File or New Folder, give it a name, and it appears in that folder; a new file opens straight away in a tab ready to write. Files also have Open in New Window. It opens the selected local file in a separate native window with only the document on screen: no folder browser, chat panel or tab strip. It remains the same editor, so saving and the warning before unsaved changes are handled just as they are in the main window.",
    added: [
      "New File and New Folder in the local workspace and folder menus.",
      "Open in New Window on local file menus, for a focused document-only window.",
    ],
  },
  {
    version: "0.66.0",
    date: "2026-09-11",
    pr: 135,
    headline: "Refresh a folder or a repository, and see which commit you are on",
    summary:
      "The workspace panel shows a folder as it was when you opened it, and nothing was watching for changes after that - so a file you added, renamed or deleted in File Explorer, or that another program wrote, did not appear until you closed the folder and opened it again. Right-click anywhere in a folder's tree now and choose Refresh. Every folder you have open in it is read again, and what you had expanded stays expanded: new files appear where they belong, and a folder that has been deleted simply goes, rather than being drawn as one that could not be read with a Retry offering to find it. Collapsed folders are left alone, so refreshing a large tree does not walk parts of it you never asked to see, and the rows stay on screen while it happens rather than emptying and redrawing. The menu is about the whole folder wherever you right-click in it, so you do not have to scroll back up to its top row to find it. A GitHub repository refreshes too. It opens pinned to one commit, so the files cannot change while you read them - and until now the only way to see what had been pushed since was to close it and open it again. Refresh moves it to the newest commit on the branch it is reading, and because that changes what the workspace is, it asks first and says what happens: the tree becomes that commit's, and tabs you already have open keep their text, so if one of those files changed on GitHub, saving it is refused as a conflict rather than written over the newer version. If you have unsaved changes in that repository, the question says so. When nobody has pushed, nothing is downloaded again. The repository's own page now says which commit you are on - its short sha, which opens the commit on GitHub, its message, who made it and when - and whether that is the newest on the branch or how many commits behind it is. Below that is the latest update on the branch and how it got there: pushed, or a pull request merged, with the pull request's title linking to it. When GitHub could not be asked, the page says it could not check rather than implying there is nothing newer, and refreshing the repository from the panel reloads the page so it never goes on naming a commit you have left.",
    added: [
      "A right-click menu on each open folder and repository in the workspace panel, with Refresh as its first entry. It reads the open subfolders again, keeping what you had expanded.",
      "Refreshing a GitHub repository moves it to the newest commit on its branch, after a confirmation that explains what that changes for your open tabs.",
      "The repository page names the commit you are on, says whether it is up to date or how many commits behind, and shows the latest update on the branch - pushed, or a merged pull request.",
    ],
  },
  {
    version: "0.65.0",
    date: "2026-09-09",
    pr: 134,
    headline: "Saving to GitHub, at last",
    summary:
      "You can edit a file in a repository and save it. Until now Trypthos would open one and refuse, because there is no mutable file at a path on GitHub the way there is in a folder - a save is a commit on a branch, with history and merge conflicts rather than an overwrite. So the first time you save in a repository, Trypthos asks where those commits should go: a new branch, named after the file and yours to rename, or one that already exists, chosen from the repository's own list, along with the message for this commit. Then it asks nothing else. Every save after that commits straight to the branch you chose, with no dialog and no wait, because a document is saved every couple of minutes and a question whose answer has not changed is not worth asking twice. A new branch is the default deliberately: committing to the default branch by default is how people push to main without meaning to, and where main is protected GitHub refuses the commit anyway, which is a worse way to find out. The workspace follows the branch you commit to, so the tree, the filter box and Find in Files are all looking at the same place your saves are landing. If somebody else has committed to that file since you opened it the save is refused as a conflict, with your text exactly where it was - the same answer a local file gives when it changed on disk, and for the same reason: Trypthos will not report a save it did not make. One thing to expect: a token created for reading cannot write, and that is most tokens connected before today. The refusal says so in as many words rather than hiding behind \"permission denied\", which would send you to check whether you still have access to the repository when what you need is a new token. Opening a pull request from Trypthos is the next piece of this and is not built yet.",
    added: [
      "Saving a file in a GitHub repository, which makes a commit on a branch.",
      "A dialog on the first save in a repository: a new branch or an existing one, and the commit message. Asked once, never again for that repository.",
      "Branch names are checked against git's own rules as you type them, rather than by a request that fails.",
    ],
    changed: [
      "The workspace follows the branch you commit to, so the tree and Find in Files look where your saves land.",
      "A byte order mark a file already had is kept when it is committed, exactly as it is for a file on this machine.",
    ],
    fixed: [
      "A GitHub token that can read but not write now says so, rather than reporting a refusal that reads as losing access to the repository.",
    ],
  },
  {
    version: "0.64.0",
    date: "2026-09-09",
    pr: 133,
    headline: "A repository page worth looking at",
    summary:
      "A repository's page now says who it belongs to. Their picture sits at the top left with the name they go by and their login beside it, and the description underneath is set in the size you read rather than the size a label is set in - it was the smallest text on a page of numbers, which was backwards. There are eight figures across the page instead of six, each with a mark of its own so they can be told apart at a glance: branches and tags have joined stars, forks, issues and pull requests, language, licence and last push. Counting branches and tags is more awkward than it sounds - GitHub has no field that says how many there are - so Trypthos asks for the listing one at a time and reads where it ends. If that request does not come back the card says Unknown rather than showing a repository with no branches, which is impossible as well as wrong. A fork now says what it was forked from, with how far it has moved: so many commits ahead, so many behind. That upstream opens in Trypthos when you click it, which is otherwise out of reach, since the picker lists the repositories you own and the upstream usually belongs to somebody else. Refresh at the top right throws away what the page is holding and asks GitHub again, which is what you want after pushing a commit - and it is there even when the figures failed to load, because a spent rate limit comes back. In the workspace panel, a repository's mark is now a different colour from a folder's: they behave very differently, one can be saved into and the other cannot, and at that size the shape alone was too small a difference down a panel of otherwise identical rows.",
    added: [
      "The repository owner's picture, the name they go by and their login, at the top of the page.",
      "Branch and tag counts, as two more cards. A count that could not be established says Unknown rather than zero.",
      "A mark on every card, so the figures can be told apart at a glance.",
      "What a fork was forked from, with how far ahead and behind it has moved. Clicking it opens that repository in Trypthos.",
      "Refresh, which asks GitHub again rather than showing what the page has been holding since you opened it.",
    ],
    changed: [
      "The description on a repository's page is set in the reading size rather than the label size.",
      "A repository's mark in the workspace panel is a different colour from a folder's.",
    ],
  },
  {
    version: "0.63.0",
    date: "2026-09-09",
    pr: 132,
    headline: "Pictures appear, and folders start put away",
    summary:
      "Pictures in rendered markdown are drawn. They never were: an image written beside its document was asked for from the app rather than from your folder, so every one of them was a broken icon - in a repository's README, and in Preview for your own files just the same. They are now read the way any other file is, which also means a picture in a private repository appears, where a link to it would have needed a token. A picture that is not there, or is too big to open, leaves the broken icon rather than pretending: better an empty frame where something should be than silence. Repository pages also stop reloading themselves - the page is fetched the first time you open it and shown from what it already has after that, so going back to it is instant rather than another round trip and another wait. And your folders come back put away: a workspace reopened at startup starts collapsed, so three open folders no longer fill the panel with everything in them before you have asked. Opening one yourself still expands it, because that is what asking to see a folder means.",
    added: [
      "Pictures in a repository's README, and in Preview for your own markdown, are drawn rather than showing a broken icon.",
    ],
    changed: [
      "Workspaces reopened when the app starts come back collapsed. One you open yourself still expands.",
      "A repository's page is loaded the first time you open it and shown from what it has after that, rather than fetched again on every visit.",
    ],
  },
  {
    version: "0.62.0",
    date: "2026-09-09",
    pr: 130,
    headline: "Every repository has a page of its own",
    summary:
      "Click a repository's row in the browser and it opens its own page in a tab, the way its front page on GitHub would. Six figures sit across the top - stars, forks, issues, language, licence and when it was last pushed to - with the description, its topics, and a badge if it is private or archived. The issue count is labelled as issues and pull requests, because that is what GitHub counts there and a figure labelled only \"issues\" would be a wrong answer. Below them the repository's README is rendered as prose and scrolls under the cards, so the numbers stay put while you read. A repository with no README says so, and one whose README could not be read says that instead - they are different facts. If GitHub cannot be reached the README is still shown with a note about what is missing, rather than an empty page. The row still expands and collapses as it always did.",
    added: [
      "A page of its own for every open repository, opened by clicking its row in the browser.",
      "Six cards: stars, forks, issues and pull requests, language, licence and last push, with the description, topics and a private or archived badge.",
      "The repository's README, rendered as prose and scrolling under the cards.",
    ],
  },
  {
    version: "0.61.4",
    date: "2026-09-09",
    pr: 129,
    headline: "The repository picker stays on the screen",
    summary:
      "If your GitHub account owned more than a screenful of repositories, the picker appeared and then seemed to vanish - leaving the window greyed over with no dialog and nothing said about why, and pressing the button again did nothing at all. It was not closing. It was being drawn below the bottom of the window, while the shade behind it still covered the screen; pressing the button again changed nothing because it had never gone away, and clicking anywhere dismissed it. The dialog was centred against the full height of your repository list rather than against the window, so the longer the list the further down it went - which is why it depended on how many repositories you have, and why it never showed up in testing until the list was made a realistic length. It is now centred against the window whatever the list, with the list scrolling inside it, and it fits a short window down to a few hundred pixels tall. The New file dialog was centred the same way and has been changed with it.",
    fixed: [
      "The GitHub repository picker is drawn on the screen rather than below it when your account owns more repositories than fit in the window.",
      "Both dialogs stay within a short window, with their content scrolling inside rather than pushing the buttons out of reach.",
    ],
  },
  {
    version: "0.61.3",
    date: "2026-09-08",
    pr: 127,
    headline: "The window no longer reloads itself",
    summary:
      "Trypthos could reload its own window while you were using it - everything on screen would vanish, the window would grey for a moment, and it would come back reset with nothing said about why. Open tabs went, and so did any unsaved work in them. It came from a retry meant for one narrow job: when Trypthos is being developed, the app and its interface start together and the app sometimes gets there first, so it tries again. That retry was never switched off once the app had started properly, so any later hiccup - of any kind, from anywhere - reloaded everything. It is now switched off the moment the app has loaded once, and a failure after that is written to the log rather than acted on. This is what was behind the GitHub picker appearing to close by itself with no message: the message went with everything else.",
    fixed: [
      "The window no longer reloads itself while you are using it, which was discarding open tabs and unsaved work.",
      "A load failure after startup is logged rather than silently retried, so there is something to look at when one happens.",
    ],
  },
  {
    version: "0.61.2",
    date: "2026-09-08",
    pr: 125,
    headline: "Update checks work behind a proxy",
    summary:
      "On a machine behind a company proxy, a VPN, or with a company certificate, Trypthos could never find an update - while the releases page opened perfectly well in a browser on that same machine. It was asking over its own networking rather than the machine's, so it knew nothing about the proxy it was meant to go through. It now uses the same network machinery your browser does, for the update check and for downloading the installer alike, which was the other half of it: on macOS the download failed the same way and dropped you on the releases page. This is the same fix 0.61.1 made for GitHub repositories, applied to the last place still doing it the old way. A check that gets no answer at all now gives up after thirty seconds rather than waiting for ever; downloading an installer deliberately has no such limit, because a large download over a slow connection is not a fault and stopping it would be.",
    fixed: [
      "Update checks and installer downloads go through the machine's own network settings, so a proxy, VPN or company certificate no longer stops Trypthos finding an update.",
      "An update check that gets no answer gives up after thirty seconds rather than waiting indefinitely.",
    ],
  },
  {
    version: "0.61.1",
    date: "2026-09-08",
    pr: 123,
    headline: "Connecting to GitHub says what went wrong",
    summary:
      "Connecting an account could leave the repository picker sitting on a loading message for ever - no repositories, no error, and nothing to do but close it and try again. Two things caused that and both are fixed. Trypthos now makes its GitHub requests through the same network machinery your browser uses, so a proxy, a VPN or a company certificate no longer leaves a request hanging with nobody waiting on the answer; and every request gives up after thirty seconds rather than waiting for ever. Behind those, the picker could not report a failure at all: if the request to the app's own background half failed outright, it went on saying it was still working. It now stops and says so, and falls back to the connect form so there is something to do about it. Checking your account and fetching your repositories also say different things while they wait, so a stall now tells you which half it is in.",
    fixed: [
      "The repository picker no longer hangs on a loading message when a request fails - it says something went wrong and offers the connect form again.",
      "GitHub requests go through Electron's network stack, so a proxy, VPN or company certificate no longer leaves them hanging.",
      "A GitHub request that gets no answer is given up on after thirty seconds rather than waiting indefinitely.",
    ],
    changed: [
      "Checking your account and loading your repositories now say different things, so a stall says which one it is.",
    ],
  },
  {
    version: "0.61.0",
    date: "2026-09-08",
    pr: 121,
    headline: "Open a GitHub repository like a folder",
    summary:
      "The browser has only ever opened folders on your own machine. It now opens GitHub repositories too, beside them in the same panel: connect your account once, pick a repository, and it appears as another tree with its own tabs, its own filter results and its own place in Find in Files. Everything you already know about the browser works on it unchanged, because a repository answers the same questions a folder does. Connecting is a personal access token, pasted into Settings > Accounts or into the picker itself; it is encrypted by your operating system, kept apart from your chat keys so deleting a model cannot sign you out, and never leaves the machine or reaches the part of the app that draws the window. The picker lists the repositories you own - public and private, newest push first - with a search box over them and a Refresh for one you have just made. A repository opens at the head of its default branch, pinned to the commit it was at when you opened it, so nobody pushing while you read can change the file under you. It opens read-only: saving to GitHub is a commit rather than a write, and rather than pretend otherwise, Trypthos says so before you open one and refuses a save instead of reporting one it never made. Your open repositories reopen next time you start, exactly as your folders do.",
    added: [
      "Open GitHub repository, from the button beside Open folder in the browser.",
      "Settings > Accounts: connect a GitHub account with a personal access token, and disconnect it again.",
      "The repository picker lists the repositories your account owns, public and private, with a search box and a Refresh.",
      "A repository sits in the browser as another tree - the filter box, Find in Files and the tabs all work on it unchanged.",
      "Open repositories reopen on the next launch, along with your folders.",
    ],
    changed: [
      "The workspace rows say which source they came from, and a repository shows its owner and name rather than a path.",
      "A repository too large for GitHub to describe in one answer says so on its row, rather than quietly showing fewer folders than it has.",
    ],
  },
  {
    version: "0.60.0",
    date: "2026-09-08",
    pr: 120,
    headline: "Read the release notes inside Trypthos",
    summary:
      "Every release has been written up since the first one, and until now there was nowhere in the app to read any of it. Help > Release Notes opens a window on the lot: the recent releases in full at the top, then a card for each earlier chapter with what it covered and how many releases are in it. Open a chapter and you get every release in it exactly as it was written, down to the wording of its bullets - a chapter is a heading over the history, never a replacement for it. The history is fetched when you open the window and not before, so carrying it about costs nothing until you ask to read it. Two buttons leave the title bar in the same release: the cog and the About button. Both are on the menus now - Settings on Tools, About and Release Notes on Help, and on macOS in the Trypthos menu - and one way in is one thing to keep working.",
    added: [
      "Help > Release Notes: the recent releases, and a card for each earlier chapter that opens onto every release in it.",
    ],
    changed: [
      "The Settings cog and the About button have gone from the title bar. Both are on the menus.",
    ],
  },
  {
    version: "0.59.0",
    date: "2026-09-08",
    pr: 118,
    headline: "The filter box searches inside your folders",
    summary:
      "The box above the browser used to hide rows that were already on screen, which meant it could only find a file in a folder you had already expanded - the files it was most useful for were exactly the ones it could not see. It now searches every open folder, however deep, and shows what it found: each match under the folders it lives in, with the folders that contain nothing left out entirely. Windows search wildcards work, because that is what a Windows user has already learned - * matches any run of characters, ? matches exactly one, and a filter using either has to match the whole name, so *.md means ends in .md rather than contains it. Plain text still matches anywhere in a name, and case never matters. While a filter is up the panel is showing results rather than the tree, so those folder rows do not collapse - clear the box and your tree is exactly as you left it. A walk of a large folder is not instant, so it says when it is searching, and says so plainly if it stopped early rather than quietly showing you a short list. Hidden folders such as .git are not searched, exactly as they are not listed.",
    added: [
      "The filter box searches every open folder by name, and shows matches inside folders you have not expanded.",
      "* and ? wildcards in the filter, as in the Windows search box.",
    ],
    changed: [
      "A folder with no matching files is left out while a filter is up, rather than sitting there empty.",
    ],
  },
  {
    version: "0.58.3",
    date: "2026-09-08",
    pr: 119,
    headline: "The release notes have chapters now",
    summary:
      "Eighty releases in one list is not a history anybody reads. The releases up to 0.53.0 are now gathered into three named chapters - An editor, and a way to ship it; Chat, and a real desktop app; Every kind of file, and a model that works in your folder - each with a short summary of what that stretch of work was about. Nothing was rewritten, merged or dropped to make that true: open a chapter and every release in it is listed exactly as it was written, down to the wording of its bullets. A chapter is a heading over the history, never a replacement for it. The releases since then stay where they were, at the top, and that is still the list a new release is added to.",
    changed: [
      "Releases up to 0.53.0 are grouped into three named chapters, each listing every release in it unchanged.",
    ],
  },
  {
    version: "0.58.2",
    date: "2026-09-08",
    pr: 117,
    headline: "The window title no longer looks like a menu",
    summary:
      "In the title bar, the app name and the file you have open sat immediately after File, Edit, Tools and Help in exactly the same colour as them - so Trypthos read as a fifth menu, and it was the obvious one to click when looking for something like Window or View. Nothing happened when you did, which is the worst answer a menu bar can give. The title is now drawn a shade quieter than the menu labels, so the menu bar visibly ends where the menus end and the title reads as what it is: a label saying which file you are in.",
    fixed: [
      "The window title is drawn in a quieter colour than the menu labels, rather than looking like another menu.",
    ],
  },
  {
    version: "0.58.1",
    date: "2026-09-07",
    pr: 115,
    headline: "The first folder inside a workspace is indented again",
    summary:
      "The folders and files at the top of an open folder were drawn at the same indent as the folder itself, so a tree read as though its first level were a sibling of the folder it was inside. Everything deeper was fine, which made it look like a quirk of the top row rather than what it was. They now sit one level in, and every level below steps evenly from there. The indent is the only thing in that panel saying what is inside what, so at the first level it was saying the opposite of the truth - which is worse than saying nothing.",
    fixed: [
      "Folders and files at the top of an open folder are indented under it, rather than level with it.",
    ],
  },
  {
    version: "0.58.0",
    date: "2026-09-07",
    pr: 113,
    headline: "Collapse a whole folder, not just the ones inside it",
    summary:
      "Each open folder's own row now has a chevron, and clicking it collapses that folder away exactly as clicking a folder inside one does. With two or three folders open this is what stops the panel being a long scroll: put the ones you are not using away and the one you are stays at the top. It behaves like every other folder row rather than like something new - one click both collapses it and points chat and Find at it, expanding it lists it again, and a folder that cannot be listed says so on its own row with a retry beside it, which can now happen to a folder you opened weeks ago and have just expanded again. The cross at the end of the row still closes the folder rather than collapsing it. One small thing improved alongside: This folder is empty is now said under the folder it is about, rather than once for the whole panel where it was a claim about neither of two open folders.",
    added: [
      "A workspace's own row collapses and expands, like the folders inside it.",
    ],
    changed: [
      "This folder is empty is said under the folder it describes, and only once that folder has actually been looked in.",
    ],
  },
  {
    version: "0.57.0",
    date: "2026-09-07",
    pr: 112,
    headline: "Open more than one folder at a time",
    summary:
      "Open Folder now ADDS a folder rather than replacing the one you had. Each open folder gets its own row at the top of the browser with its own tree beneath it, and a cross at the end of that row closes it - along with its tabs, asking about anything unsaved first. Every folder you leave open is reopened next time you start, in the order you opened them. This changes something underneath that is worth knowing about, because it is why the rest works: a file is now named by its folder as well as its path, so two files both called notes.md in two different folders are two documents rather than one. The tab strip shows that when it has to - two tabs that would both read notes.md become Notes/notes.md and Work/notes.md - and links, chat and Find in Files all stay inside the folder they started in. Nothing you had is lost: the one folder the app remembered becomes a list of one, and it opens exactly as it did before.",
    added: [
      "Several folders open at once, each with its own tree in the browser.",
      "A close button at the end of each folder's row, which closes its tabs too.",
      "Every open folder is reopened the next time you start.",
    ],
    changed: [
      "Open Folder adds a folder rather than replacing the one you had - so it no longer asks about unsaved work, because it no longer discards anything. Closing a folder asks instead.",
      "A tab shows the folder its file is in when two open files share a name.",
    ],
  },
  {
    version: "0.56.1",
    date: "2026-09-07",
    pr: 111,
    headline: "The find panel goes anywhere in the window",
    summary:
      "The find panel could be dragged, but only within the editor - push it towards the folder browser or the chat panel and it stopped at the edge. That was the wrong place to stop it: every find is about the editor, so the editor is exactly the area you want the panel out of, and the one place it could go was the one place it was in the way. It now moves anywhere across the width of the window and down to the bottom of it. Two limits are deliberately kept. It will not climb above the title bar, because that is where the window buttons are and a panel parked over the close button is a panel in the way. And it still cannot be pushed off the edge of the window - it has no title bar of its own, so one dragged out of sight would be one you could never get back.",
    fixed: [
      "The find panel can be dragged over the folder browser and the chat panel, not only within the editor.",
    ],
  },
  {
    version: "0.56.0",
    date: "2026-09-07",
    pr: 109,
    headline: "Match case, and a find panel you can move",
    summary:
      "Two additions to Find. There is now a Match case option beside Regular expression, and the two are separate choices rather than a mode - a case-sensitive regular expression is an ordinary thing to want, and so is a case-sensitive plain search. It applies to both tabs, so searching a folder for exactly State no longer brings back every state and STATE with it. Off to begin with, which is what the rest of the app does. And the panel can now be dragged: grab the strip the tabs sit on and move it wherever you like. It floats over the document it is reporting on, so it could end up sitting exactly on top of the text you were trying to read, and this is the way out of that. It cannot be dragged off the edge - it has no title bar of its own, so a panel pushed out of sight would be one you could never get back - and where you put it is remembered until you close the app, so it does not go back to covering the same text the next time you press Ctrl+F.",
    added: [
      "Match case, on both the Find and Find in Files tabs.",
      "The find panel can be dragged by the strip its tabs sit on, and stays where you put it.",
    ],
  },
  {
    version: "0.55.0",
    date: "2026-09-07",
    pr: 108,
    headline: "Find, and find in files",
    summary:
      "Ctrl+F, or Edit > Find, opens a small panel in the corner of the editor with two tabs. Find looks through the document you have open, marks every match and steps you through them with Next and Previous - Enter does the same thing, and Shift+Enter goes back, so you can walk a document without reaching for the buttons. The one you are on is marked more strongly than the rest, so a page with a dozen matches still tells you where you are. Find in Files searches the folder you have selected in the browser and everything below it - or, if you have not picked one, the folder the file you are reading lives in. The panel says which before you press Search, because those two can be a long way apart. Every hit opens its file in a tab and marks the line, and Next carries on into the next file. Both tabs take either plain text or a regular expression, and an expression that will not compile says so rather than quietly finding nothing. The panel deliberately does not cover the document: the whole answer is a highlight in the text underneath it. A search in files reads only the file types you have turned on, never leaves the folder you have open, and stops at a sensible size - and when it stops early it says so rather than pretending the list is complete.",
    added: [
      "Edit > Find, or Ctrl+F: a Find panel with a Find and a Find in Files tab.",
      "Find marks every match in the open document and steps through them with Next and Previous, or with Enter and Shift+Enter.",
      "Find in Files searches the selected folder and everything below it, opening each hit in a tab.",
      "Both searches take plain text or a regular expression.",
    ],
    changed: [
      "A document in Preview switches to an editable view while a match is on screen, because Preview has nowhere to draw one - and goes back when the find is closed.",
    ],
  },
  {
    version: "0.54.0",
    date: "2026-09-07",
    pr: 107,
    headline: "Zoom in, and move around",
    summary:
      "Hold Shift and turn the mouse wheel to zoom, hold Shift and drag to move around. It works on the same two things you look at all day and does the right thing for each. Text gets bigger rather than stretched - the document, its line numbers and its headings grow together, and it still wraps to the panel at the size you are reading it at, so a document you have zoomed into is a document you can still read across. A picture is scaled for real: its pixels are multiplied, so the picture gets bigger and there is somewhere to pan to. The wheel steps through set levels with 100% among them, which means turning it back the way you came puts a document at exactly the size it opened at rather than near it. If you would rather not reach for the mouse at all, Ctrl and plus, Ctrl and minus and Ctrl and 0 do the same three things - Cmd on a Mac - and 0 goes straight back to 100% from wherever you are. The level belongs to the document: zooming one file leaves the tab beside it alone, and switching between Live, Source and Preview keeps the size you were reading at. It is not remembered between sessions - a zoom is how you are reading something now, not a setting. One thing it takes away, and it is worth knowing: in the editor, Shift and a click used to extend the selection to where you clicked, and now it starts a pan. Selecting by dragging, by double-click, and with Shift and the arrow keys are all unchanged.",
    added: [
      "Shift and the mouse wheel zooms the document, the rendered preview, or a picture.",
      "Shift and drag moves around whatever you have zoomed into.",
      "Ctrl and plus, Ctrl and minus, and Ctrl and 0 to go back to 100% - Cmd on macOS.",
    ],
    changed: [
      "A picture now opens at its own pixels rather than being shrunk to the width of the panel - Shift and the wheel is how you get it back.",
      "In the editor, Shift and a click now starts a pan rather than extending the selection.",
    ],
  },
  {
    version: "0.53.0",
    date: "2026-09-06",
    pr: 105,
    headline: "The model can show you a file, and make a new one",
    summary:
      "Two more things a model can do when you attach a folder. It can open a file in a tab, which is what you want after asking which file mentions something - it finds it and puts it on your screen. And it can create a NEW file in that folder. That second one is a change worth knowing about: until now nothing a model suggested reached your disk until you pressed Apply, and this is the one exception. It is bounded four ways - inside the folder you attached, a file type you have turned on, a size a person can read through, and it can only ever create. It cannot replace a file that already exists, and that is enforced by the write itself rather than by a check that could be raced. A file it makes is opened in a tab unless it says otherwise, so you see what was made rather than finding it later. Type /tools in the chat box for the full list of what a model can be given.",
    added: [
      "open_file: the model can put a file it found on your screen.",
      "create_file: the model can make a new file in the folder you attached. It cannot replace an existing one.",
    ],
  },
  {
    version: "0.52.0",
    date: "2026-09-06",
    pr: 104,
    headline: "Let the model look around the folder you attached",
    summary:
      "Three new things a model can do when you attach a folder: list what is in a directory, search the text of the files for a word or a pattern, and compare two files line by line. Type /tools in the chat box to see them. Search is the useful one - ask which file mentions something and you get the file and the line number rather than a guess. This widens what a model can see, and it is worth being clear about how far: until now it could read only the files named in the list your folder produced, and now it can find and read anything inside that folder and below it. Not the rest of your workspace, and nothing outside it - the folder you attach is the boundary, checked on every call, and the workspace guard still applies underneath it. Nothing is written: these three only look. Every answer is capped, and a capped answer says so rather than pretending to be complete.",
    added: [
      "list_directory: what is in a directory of the folder you attached.",
      "search_contents: which file and line contains a word or a pattern.",
      "diff_files: the line-by-line difference between two files.",
    ],
  },
  {
    version: "0.51.0",
    date: "2026-09-06",
    pr: 103,
    headline: "Look at the pictures in your folder",
    summary:
      "Images are a file type now - PNG, JPEG, GIF, WebP, BMP, AVIF and ICO - so they are listed in the browser rather than greyed out, and clicking one opens it in a tab. It is a picture, not a document: there are no view buttons, no word count and no editing surface, and it is never written back. It is shown at its own size and scrolls within the panel rather than being shrunk to fit, because a screenshot scaled down to a side panel is a screenshot you cannot read. SVG is deliberately left where it was, with XML, because it is a picture and a text file both and being able to edit it is the more useful of the two answers. Two things worth knowing. An image is not sent to a chat model - asking about a folder still lists it, but the picture itself stays on your machine. And like every file type added after you installed, Images starts switched off in an existing installation: turn it on in Settings, File types.",
    added: [
      "Image files open in a tab: PNG, JPEG, GIF, WebP, BMP, AVIF and ICO.",
    ],
  },
  {
    version: "0.50.0",
    date: "2026-09-06",
    pr: 102,
    headline: "Start a file from the File menu",
    summary:
      "File > New, or Ctrl+N, asks for a name and a type and opens a tab for it. The type is a dropdown of everything you have turned on, so making a .py does not mean knowing that Trypthos calls that Python - and if you type an extension yourself, that is the one that is used. It does NOT ask where the file goes: that question is asked by the save dialog the first time you save, when you know more about where you want it. Until then it is a real tab you can type into, and closing it asks about the work in it like any other. Save it and the tab follows the file to wherever you put it, and from then on Ctrl+S writes straight to it.",
    added: [
      "File > New (Ctrl+N): name a file, pick its type, and start writing before deciding where it goes.",
    ],
  },
  {
    version: "0.49.0",
    date: "2026-09-06",
    pr: 101,
    headline: "Open a file a reply mentions by clicking it",
    summary:
      "When a model names a file in backticks - which is how a model names one - it is now a link. Click it and the file opens in a tab, exactly as a link you had typed yourself would. A web address in backticks opens in your browser, as one written as a link already did. What becomes a link is decided by the same rule the rest of the app uses, so a path outside your folder is not one, nor is a file type you have turned off, nor is anything that is not a file at all - `npm run build` and `and/or` stay as text. Links in replies are also coloured now rather than only underlined, so they read as links before you hover them. Only in replies: your own documents are rendered exactly as you wrote them.",
    added: [
      "File paths a reply names are links that open the file in a tab.",
    ],
    changed: [
      "Links in a chat reply are coloured, not only underlined.",
    ],
  },
  {
    version: "0.48.0",
    date: "2026-09-06",
    pr: 100,
    headline: "Ask the chat box what it can do",
    summary:
      "Two commands you can type into the chat box instead of a question. /commands - or /help - lists what you can type, and /tools lists what the model can be given beyond your question, with a line about which of them it actually gets. Both are answered by Trypthos rather than by a model: they say something about this app, which no endpoint can be expected to know and none should be paid to guess at. Neither the command nor its answer is ever sent to a provider, including in later questions, so asking what the tools are does not become part of what the model thinks it can do. A message counts as a command only when it is nothing but the command, so a question that merely begins with a slash - a path, a fraction, a date - still reaches the model as you wrote it.",
    added: [
      "/commands and /help list what you can type into the chat box.",
      "/tools lists what the model can be given beyond your question.",
    ],
  },
  {
    version: "0.47.0",
    date: "2026-09-06",
    pr: 98,
    headline: "Open the scripts on your machine",
    summary:
      "Batch files are a file type now - .bat and .cmd - which means they open, they are listed in the browser rather than greyed out, and chat can be asked about them. Nothing ships syntax colouring for batch, so Trypthos has its own: comments in both spellings, labels, %VAR% and !VAR! expansion, the control-flow words and the commands cmd.exe carries. Shell gained the extensions it was missing - .fish, and the .command scripts you can double-click on a Mac - and, more usefully, the shell configuration files that have no extension at all: .bashrc, .bash_profile, .zshrc, .profile and their neighbours. PowerShell already covered .ps1, .psm1 and .psd1. As with every other type, the grammar is downloaded only when you open a file that needs it, so none of this costs anything until it is used.",
    added: [
      "Batch files (.bat, .cmd) open and are syntax coloured.",
      "Shell covers .fish and .command, and the shell configuration files that have no extension.",
    ],
  },
  {
    version: "0.46.0",
    date: "2026-09-06",
    pr: 97,
    headline: "Close a run of tabs, and keep your selection while you ask about it",
    summary:
      "Right-click a tab for the five ways of closing: Close, Close Tabs to the Right, Close All, Close Others and Close Saved. Each asks about unsaved work one document at a time, and cancelling stops the rest, so a Close Others cannot shut tabs you were never asked about. An entry that would close nothing - Close Tabs to the Right on the last tab, Close Others with one tab open - is greyed rather than offered. Fixing this turned up something worse: the close button on a tab that was not the one on screen did nothing at all, so a background tab could only be closed by going to it first. That works now. Separately, selecting text in the editor and then clicking into the chat box no longer makes the selection disappear. The selection is what chat sends instead of the whole file, so it stays on screen - a little quieter, to show the caret is elsewhere - while you type the question about it.",
    added: [
      "A right-click menu on a tab: Close, Close Tabs to the Right, Close All, Close Others, Close Saved.",
    ],
    changed: [
      "An editor selection stays visible while you type in the chat box.",
    ],
    fixed: [
      "Closing a tab that is not the one on screen works.",
    ],
  },
  {
    version: "0.45.1",
    date: "2026-09-06",
    pr: 93,
    headline: "Read a long answer while it is still arriving",
    summary:
      "Two fixes in the chat panel. Scrolling up during a long reply no longer snatches you back to the bottom: until now the thread jumped to the newest token every time one arrived - several times a second - so a long answer could not be read until it had finished, and the scrollbar seemed to refuse to go where you put it. The thread still follows the answer down on its own if you have not scrolled away, and asking a new question always brings you back to the bottom. Second, the Folder button no longer names a folder it is not sending: with the button off it reads Folder, as its unpressed state already said, and the folder it would send is on hover.",
    fixed: [
      "Scrolling up while a reply streams stays where you put it.",
      "The chat Folder button names a folder only when that folder is actually being sent.",
    ],
  },
  {
    version: "0.45.0",
    date: "2026-09-06",
    pr: 90,
    headline: "Get back to a file you had open",
    summary:
      "The File menu has an Open Recent list of the last ten files you opened, newest first. Each entry names the folder as well as the file, because the same file name in two folders is two different files - and choosing one opens the folder and the file together, exactly as a right-click in File Explorer does, so it still asks about unsaved work first. A file saved somewhere else goes on the list too, since that is the file you are working in from then on. Nothing checks the disk when the menu opens, so an entry for a file you have since deleted stays until it falls off the end; Clear Recent Files at the bottom of the list is there for that. Separately, the chat Folder button now shows the folder's whole path on hover - the button only has room for the last part of it, and \"Folder: drafts\" does not tell you which drafts.",
    added: [
      "Open Recent on the File menu: the last ten files, each with the folder it was in.",
      "Clear Recent Files, for entries that no longer open anything.",
    ],
    changed: [
      "The chat Folder button shows the folder's whole path on hover.",
    ],
  },
  {
    version: "0.44.0",
    date: "2026-09-06",
    pr: 89,
    headline: "Save a document somewhere else",
    summary:
      "Save As is on the File menu, and on Ctrl+Shift+S (Cmd+Shift+S on a Mac). It opens the usual save dialog beside the file you are editing, writes the document wherever you point it, and the tab follows - so from then on you are editing the new file and the original is left exactly as it was. It also gives two documents that never had anywhere to go a first home: the scratch buffer you start in, and the built-in markdown guide, both of which are copied out rather than moved, so they stay where they are. Saving over a file the dialog already offered to replace goes through without a second question, since you have just answered it. One limit worth knowing: Trypthos saves inside the folder you have open, so a place outside it is declined with a message saying so rather than a puzzling permissions error.",
    added: [
      "Save As on the File menu and on Ctrl+Shift+S, writing the document wherever you choose.",
      "The scratch buffer and the markdown guide can be saved out as real files.",
    ],
  },
  {
    version: "0.43.0",
    date: "2026-09-06",
    pr: 88,
    headline: "See what the model thought, and let it read files on any endpoint",
    summary:
      "Three things, all about chat being straight with you. A model with a reasoning mode now shows its thinking under every reply that has any - folded away, so you open it only when you are interested, and it stays with that reply when you scroll back or reopen a saved chat. It used to appear only when a reply produced no answer at all, so a reply that thought and then answered lost its thinking the moment it answered. Second, reading a file from the folder no longer needs an endpoint that supports tool calling: where it does not, the model asks by writing a small fenced block and Trypthos hands the file over, so the folder is useful everywhere rather than only on some endpoints. Third, the instructions sent with the folder now describe whichever of those two the model actually has - they used to always name the tool, including to models that were never given one, which meant a list of files arrived with an instruction that could not be followed. What may be read has not changed: only the files on the list, and only inside the folder you chose.",
    added: [
      "A reply shows what the model thought, folded away and kept with that reply.",
      "Thinking is saved with a chat, and shortened rather than dropped if it is very long.",
      "Models without tool calling can read a file from the folder by asking for it in a fenced block.",
    ],
    fixed: [
      "The folder instructions describe the way the model can actually ask for a file.",
    ],
  },
  {
    version: "0.42.1",
    date: "2026-09-05",
    pr: 87,
    headline: "Chat can see your folder again",
    summary:
      "Since 0.40.0, turning the Folder button on did nothing: the list of files was never sent, so the model could only see the document you had open and would tell you so. The request for that list was failing before it started, and failing in a way nothing reported - not in the panel, not in a message, not anywhere. It works again. If you turned Folder on and got answers that ignored your folder, that is what was happening, and it was not your setup.",
    fixed: [
      "The chat Folder button sends the folder's files again, instead of silently sending nothing.",
    ],
  },
  {
    version: "0.42.0",
    date: "2026-09-05",
    pr: 86,
    headline: "See which files an answer was based on",
    summary:
      "When a model reads a file from the folder you gave it, the reply now says so: one line at the bottom of that answer naming every file it read, with the full paths on hover. One line however many it read, and it stays with the answer - scroll back to something the model told you last week and you can still see what it was looking at. Until now the only sign was a Reading... message that appeared while you waited and vanished the moment the answer started, so a reply that consulted four files looked exactly like one that consulted none. That message is still there while you wait, since it says what is happening now rather than what happened.",
    added: [
      "One line at the bottom of a reply naming every file it read, with full paths on hover.",
    ],
  },
  {
    version: "0.41.0",
    date: "2026-09-05",
    pr: 83,
    headline: "Ask a model to think before it answers",
    summary:
      "Each configured model now has a Thinking switch and a level - Low, Medium or High - on its page in Settings. Turn it on and Trypthos asks the model to reason before answering, at the level you chose. This is for models that have a reasoning mode: gpt-oss is the one it was built for, and it reasons at exactly those three levels. It is off for every model, including ones you already have, and deliberately so - an endpoint that has never heard of the setting may ignore it or refuse the request outright, which is the same reason tool calling is a switch rather than something Trypthos assumes. The level stays as you set it while Thinking is off, so turning it back on does not make you choose again, and the level is shown but greyed while the switch is off rather than disappearing - a control that vanishes takes with it the answer to what it would do. Trypthos does not show you the model's reasoning; what changes is the answer you get.",
    added: [
      "A Thinking switch on each model, with Low, Medium and High.",
      "The level is sent with every message to that model, as reasoning effort.",
    ],
  },
  {
    version: "0.40.0",
    date: "2026-09-05",
    pr: 82,
    headline: "Chat maps the folder you chose, not always the top one",
    summary:
      "The Folder button beside the chat box sent the list of files at the top level of your workspace, whichever part of it you were actually working in. Now you choose: click a folder in the browser on the left and it becomes the selected one, shown highlighted, and that is the folder chat maps. The button says which - Folder: specs rather than just Folder - so what would be sent is something you read rather than remember. Clicking a folder still opens and closes it as it always did; selecting it is the same click. The selection stays where you put it as you move between files, because which document you are reading and which folder your question is about are different questions. Opening a different workspace puts it back to the top. The model is told which folder it is looking at, and it can still only read the files on that list - the folder is a choice about scope, not permission, and everything stays inside the folder you have open.",
    added: [
      "Clicking a folder in the browser selects it, and the chat Folder button uses it.",
      "The Folder button names the folder it would send.",
    ],
    fixed: [
      "The Folder button no longer always sends the workspace root regardless of where you are working.",
    ],
  },
  {
    version: "0.39.0",
    date: "2026-09-05",
    pr: 81,
    headline: "The folder browser shows your folder as it is",
    summary:
      "Two changes to what the left panel lists. Every file type is now on to begin with, so a new installation shows a folder the way the rest of your machine does rather than one file type's worth of it. If you already have Trypthos, nothing changes: the types you have on stay on, because altering what your folder browser shows without being asked is exactly what the old markdown-only default existed to avoid. Turn types off from the File types page whenever you want a narrower list. And files Trypthos cannot open - a picture, an archive, a type you have turned off - are now listed rather than left out, drawn in grey and not clickable. Hiding them meant the panel disagreed with every other way of looking at the same folder, and a missing file tells you nothing: you could not tell whether Trypthos would not open it or whether it was not there. Hovering one says which it is. The count in the footer still counts only the files your types cover, so it continues to match the types named beside it.",
    changed: [
      "A new installation starts with every file type on. An existing one keeps the types it has.",
      "Files no enabled type covers are listed in grey rather than hidden, and cannot be clicked.",
      "The footer counts only the files your enabled types can open, as it did before.",
    ],
  },
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
