import type { Release } from "./types";

/// Releases since the last closed epoch. THE FILE EVERY PR EDITS: add one entry at the top.
///
/// RECENT[0].version must equal /version.json - releases.test.ts fails the build otherwise.
export const RECENT: Release[] = [
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
