import type { Release } from "./types";

/// Releases since the last closed epoch. THE FILE EVERY PR EDITS: add one entry at the top.
///
/// RECENT[0].version must equal /version.json - releases.test.ts fails the build otherwise.
export const RECENT: Release[] = [
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
];
