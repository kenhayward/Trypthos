import type { Release } from "./types";

/// Releases since the last closed epoch. THE FILE EVERY PR EDITS: add one entry at the top.
///
/// RECENT[0].version must equal /version.json - releases.test.ts fails the build otherwise.
export const RECENT: Release[] = [
  {
    version: "0.104.1",
    date: "2026-10-07",
    pr: 239,
    headline: "Safer upgrades, saves and sign-ins",
    summary:
      "Three fixes that protect your work and your credentials. Running an older Trypthos no longer wipes the settings, sign-ins or chat API keys that a newer version saved, and a file the app cannot read is backed up before it is replaced. Pressing save again while a save to a cloud folder is still in progress no longer reports a conflict with your own save. And if a service redirects a request, a sign-in token or an AI API key is never sent on to a different server.",
    fixed: [
      "Running an older Trypthos no longer wipes the settings, sign-ins or chat API keys a newer version saved. A file the app cannot read is backed up before it is replaced.",
      "Pressing save again while a save is still in progress in a cloud folder no longer shows a conflict about your own save.",
      "A sign-in token or AI API key is never sent to a different server if a service redirects a request.",
    ],
  },
  {
    version: "0.104.0",
    date: "2026-10-07",
    pr: 234,
    headline: "Save to OneDrive",
    summary:
      "Files in a OneDrive folder now open for editing and save back to OneDrive. A save goes through only if the file in OneDrive is still the version you opened: if someone changed it there meanwhile, Trypthos says so and keeps your text rather than overwriting theirs, and a file shows as saved only once OneDrive has confirmed it. Right-click in a OneDrive folder to make a new file or folder, or to rename a file or folder - a change of case alone included; a name already taken in that folder is refused, never replaced, and an open file's tab follows its rename. Chat can create new files in a OneDrive folder the same way, and never replaces one that is there. OneDrive takes a file of up to 4 MB in one request, so a larger file opens read-only. Making a file or folder whose name is already taken now says so in those words, in any folder.",
    added: [
      "Save files in OneDrive folders, refused rather than overwriting when the file changed in OneDrive since you opened it.",
      "New File, New Folder and Rename in OneDrive folders, and chat's create-file tool there.",
    ],
    changed: [
      "A file or folder that could not be made or renamed in a cloud folder now names the service it is on.",
      "OneDrive files over 4 MB open read-only, since OneDrive takes a file of up to 4 MB in one request.",
    ],
    fixed: [
      "Making a file or folder whose name was already taken said the file had changed on disk; it now says the name is taken.",
    ],
  },
  {
    version: "0.103.0",
    date: "2026-10-07",
    pr: 233,
    headline: "Open OneDrive folders, read-only",
    summary:
      "In builds with OneDrive support, the folder browser has a OneDrive button, and the panel's right-click menu has the same choice; with no Microsoft account connected, it offers to connect one. It opens a picker with My files and Shared with me: open My files itself, any folder in it, or a folder someone shared with you, and it opens as another tree beside your other folders, marked with a OneDrive cloud, and comes back the next time you start Trypthos. Files open read-only for now - saving to OneDrive follows in the next release - pictures a note embeds are shown, and videos and audio play and can be seeked, streamed in ranges through the main process so neither your sign-in nor the download address reaches the window. Folders are read as you open them and a listing is kept for a minute; right-click Refresh asks OneDrive again, and Open in OneDrive shows a file, a folder or the whole workspace on onedrive.live.com in your browser. The filter box and Find in Files search only the cloud folders you have opened, and say so. A OneDrive folder remembered under one Microsoft account is not opened under another, and Trypthos says so. Work and school accounts are not supported.",
    added: [
      "Open My files, a folder in it, or a folder shared with you from OneDrive as a read-only workspace, from the OneDrive button or the panel's right-click menu.",
      "Open in OneDrive, Refresh, embedded pictures, and video and audio playback in OneDrive folders.",
    ],
    changed: [
      "The Google Drive and OneDrive folder pickers share one design.",
      "The note under filtered results reads Cloud folders are searched only where you have opened them, since it now covers OneDrive too.",
      "Microsoft refusing the account lookup as forbidden now reads as permission denied rather than an unknown error.",
    ],
  },
  {
    version: "0.102.0",
    date: "2026-10-07",
    pr: 231,
    headline: "Connect a OneDrive account",
    summary:
      "Settings > Accounts has a OneDrive section. Connect opens Microsoft's sign-in page in your browser: sign in with your personal Microsoft account and allow access to your files, and the section shows the account you connected. Trypthos keeps only what it needs to stay signed in, encrypted by your operating system, and talks to Microsoft directly from this machine. Disconnect forgets the sign-in on this computer; to remove Trypthos's access from your Microsoft account as well, visit account.live.com/consent/Manage. Opening OneDrive folders follows in the next release. Work and school accounts are not supported.",
    added: [
      "Connect and disconnect a personal Microsoft account for OneDrive in Settings > Accounts.",
    ],
    changed: [
      "The Google Drive and OneDrive account sections in Settings share one design.",
    ],
    fixed: [
      "Connecting or disconnecting two accounts at the same moment could lose one of them.",
    ],
  },
  {
    version: "0.101.1",
    date: "2026-10-07",
    pr: 230,
    headline: "Security updates for KaTeX and build tools",
    summary:
      "Diagrams now typeset maths with the same, patched KaTeX the rest of the app uses, rather than an older copy with a published advisory, so there is one copy in the app instead of two. Two tools used only to build and test Trypthos, shell-quote and source-map-js, are updated to their fixed releases. Nothing changes on screen.",
    changed: [
      "Mermaid diagrams use the app's own KaTeX 0.18.9 instead of an older copy with a published advisory.",
      "Build and test tools updated: shell-quote 1.12.0 and source-map-js 1.2.2.",
    ],
  },
  {
    version: "0.101.0",
    date: "2026-10-06",
    pr: 229,
    headline: "Folders that cannot be opened stay in the list, greyed out",
    summary:
      "The folders you leave open are reopened the next time you start, and until now one that could not be reopened was forgotten for good: a Google Drive or GitHub workspace started without a network, or a folder on a drive that was not plugged in, simply vanished. It now stays in the folder browser, greyed out and marked Not available, below the folders that did open. Click it to try again once the drive or the network is back, which opens it without a restart, or use its cross to remove it, so a folder that is gone for good is not tried again at every start. Opening the same place from the dialog also takes it off the list. The list of folders is also no longer written while they are still being reopened, so quitting or a crash during start-up can no longer forget them all. Also in this release, test runs that printed warnings on a passing run are quiet again, and a spellchecker failure is logged by its kind only.",
    added: [
      "A remembered folder that cannot be opened at start-up is shown greyed out as Not available; click it to try again, or remove it with its cross.",
    ],
    fixed: [
      "A folder that could not be reopened at start-up, offline or on a drive that was not plugged in, was forgotten (#228).",
      "Quitting or a crash while the remembered folders were reopening could forget all of them (#228).",
      "A spellchecker that could not be configured is logged by the kind of failure only, without its message.",
    ],
  },
  {
    version: "0.100.0",
    date: "2026-10-06",
    pr: 227,
    headline: "New files, new folders, rename and Open in Google Drive",
    summary:
      "A Google Drive workspace now offers the same tree editing as a local folder. Right-click a folder to make a New File or a New Folder in it, and both appear in Drive. Rename works on files and folders, though not on the workspace itself: a renamed folder keeps the folders you had expanded inside it, open tabs follow the rename, a name already used in that folder is refused whatever its capitals, and a rename that changes only the capitals is allowed. A Google Doc is renamed by its title: the box shows the title without .md and Drive receives the new title. Open in Google Drive opens a file, a folder or the whole workspace on drive.google.com, a Doc in Google Docs, in your default browser, where local folders offer Open in Explorer (Open in Finder on macOS). Save As still cannot save into a Drive folder, so a new document from File > New is saved to a local folder; Open in New Window stays local only and Recent files list local files only. A GitHub repository is unchanged, none of these items appear there.",
    added: [
      "New File and New Folder in a Google Drive workspace, from the right-click menu.",
      "Rename a file or folder in Drive; a Google Doc is renamed by its title.",
      "Open in Google Drive for a file, a folder, a Doc or the whole workspace, in your default browser.",
    ],
    changed: [
      "A renamed Drive folder keeps the folders you had expanded inside it, and open tabs follow a rename.",
      "A name already used in a Drive folder is refused whatever its capitals; a case-only rename is allowed.",
    ],
    fixed: [
      "A new file made in a Drive folder while a listing of it was already on its way could be missing from the tree afterwards; the folder is now asked again (#226).",
    ],
  },
  {
    version: "0.99.0",
    date: "2026-10-06",
    pr: 225,
    headline: "Play video and audio from Google Drive, and zoom pictures properly",
    summary:
      "Videos and audio in a Google Drive folder now open in the player and can be seeked. They stream in ranges from Drive through the main process, so the sign-in token never reaches the window, and the size comes from the folder listing, which is kept for up to a minute. Video and audio in a GitHub repository are still not playable. Pictures, in every source, have been reworked: a picture opens at Fit and is never enlarged, so one smaller than the panel shows at 100%, and a toolbar in the bottom right has Fit, 100%, zoom out, the percentage and zoom in. Ctrl+wheel (Cmd+wheel on macOS) and a trackpad pinch zoom about the pointer, continuously, from 10% (lower if Fit is lower) to 800%. A plain drag pans when the picture is larger than the panel, though a press on the scrollbar is left to the scrollbar, and double-click toggles between Fit and 100%. Ctrl/Cmd+0 returns to Fit, Ctrl/Cmd+1 goes to 100%, and Ctrl/Cmd with plus or minus steps. The panel refits on resize while in Fit. For text in the editor and Preview the zoom gesture changed from Shift+wheel to Ctrl+wheel (Cmd on macOS) and pinch, so Shift+wheel scrolls sideways again; Shift+drag still pans text, and Ctrl/Cmd with plus, minus and 0 are unchanged.",
    added: [
      "Video and audio in a Google Drive folder play and can be seeked, streamed from Drive in ranges.",
      "Pictures open at Fit, never enlarged, with a toolbar for Fit, 100%, zoom out, the percentage and zoom in.",
      "Ctrl/Cmd+wheel and trackpad pinch zoom a picture about the pointer, from 10% to 800%; a drag pans and double-click toggles Fit and 100%.",
      "Ctrl/Cmd+0 returns a picture to Fit, Ctrl/Cmd+1 goes to 100%, and Ctrl/Cmd with plus or minus steps.",
    ],
    changed: [
      "Zooming text in the editor and Preview now uses Ctrl+wheel (Cmd on macOS) and pinch instead of Shift+wheel.",
      "Shift+wheel scrolls sideways again.",
      "A picture smaller than the panel is no longer stretched: Fit never enlarges it.",
    ],
  },
  {
    version: "0.98.0",
    date: "2026-10-06",
    pr: 223,
    headline: "Save to Google Drive",
    summary:
      "Files in a Google Drive folder now open for editing and save back to Drive. Before it writes, Trypthos checks that the file has not changed in Drive since you opened it: if it has, nothing is overwritten, your text stays in the editor and you are told, so you can decide what to do. While a save is on its way the file's row in the folder browser and the editor header show a spinner and say Saving, and the file counts as saved only once Drive has confirmed it. The check and the write are two requests, so another person saving in that instant could still be overwritten, but Drive keeps the version that was replaced in its own version history. Google Docs stay read-only, because writing markdown back would turn a Doc into something else, and they are now listed under their own title with a Docs mark instead of as a .md file. The chat can now create a file in a Drive folder. My Drive is tied to the account that opened it, so a My Drive workspace never silently follows a different connected account: one opened under a different account is closed at launch with a message saying so, and you can connect that account or open My Drive again. Right-click Refresh is no longer undone by a folder listing that was already on its way, and failures when saving are worded in Google's terms.",
    added: [
      "Edit and save files in a Google Drive folder, with a check that the file has not changed in Drive since you opened it.",
      "A file that changed in Drive before you save is not overwritten: your text stays in the editor and you are told.",
      "The chat can create a file in a Drive folder.",
      "Google Docs stay read-only, per file; every other Drive file is editable.",
      "A spinner on the file's row and Saving in the editor header while a save is on its way.",
      "My Drive is tied to the account that opened it, and a different connected account closes that workspace at launch with a clear message.",
    ],
    fixed: [
      "Right-click Refresh on a Drive folder is no longer undone by a listing that was already in flight.",
      "Google Docs were listed as .md files, which read as if they were markdown files in Drive; they now show their own title with a Docs mark.",
      "Quitting no longer shows an 'Object has been destroyed' error dialog (#224).",
      "Text typed while a save is still in progress is no longer marked as saved; the tab stays unsaved until that text is saved too (#222).",
    ],
  },
  {
    version: "0.97.0",
    date: "2026-10-05",
    pr: 220,
    headline: "Open a Google Drive folder beside your other folders",
    summary:
      "With a Google account connected, the folder browser has a Google Drive button. It opens a picker over your Drive with Drive-style icons and a breadcrumb to go back up: My Drive, which you can open whole, Shared with me, where each folder shared with you can be opened, and your shared drives, each of which can be opened too. Choose a folder and it opens as another tree beside your local folders and repositories, marked as My Drive, a shared drive, a shared folder or a folder (a shared drive under its own name), and comes back the next time you start Trypthos. Markdown and text files open as they do anywhere else, Google Docs open as markdown, and pictures a note embeds are shown; videos and audio in Drive are not playable yet, and shortcuts, Sheets and Slides are not listed. Folders are read as you open them, with a spinner on a file or folder (in every source) while it loads, and a listing is kept for a minute before right-click Refresh asks Drive again. Because a large Drive is never read all at once, the filter box and Find in Files search only the Drive folders you have opened in this session, and say so; a link or embed that names a note finds it only in folders you have opened too. This release opens Drive folders read-only: the editor does not let you type into a Drive file, and saving to Drive arrives in the next release.",
    added: [
      "Google Drive folders as workspaces: open My Drive, a folder shared with you, or a shared drive from the picker and browse it beside your other folders, read-only for now.",
      "Google Docs open as markdown, and pictures embedded in a Drive note are shown.",
      "A spinner shows on a file or folder while it loads, and in the Drive folder picker.",
      "Open My Drive itself, or a folder shared with you, from the Google Drive picker, which now shows Drive-style icons for My Drive, Shared with me and shared drives.",
      "The filter box and Find in Files search only the Google Drive folders you have opened, and say so.",
      "In the folder browser, each Drive workspace is marked as My Drive, a shared drive, a shared folder or a folder, and a shared drive opens under its own name.",
    ],
  },
  {
    version: "0.96.0",
    date: "2026-10-05",
    pr: 219,
    headline: "Connect a Google account, ready for Google Drive folders",
    summary:
      "The first step towards opening Google Drive folders as workspaces: Settings > Accounts now has a Google Drive section. Connect opens Google's own sign-in page in your browser, where you allow Trypthos to use Google Drive, and the section then shows which account is connected. Trypthos keeps only what it needs to stay signed in, encrypted by your operating system, and every request goes from this machine straight to Google. If you untick Google Drive on Google's page, Trypthos says so rather than pretending to be connected. Disconnect signs out and asks Google to forget the permission. Opening Drive folders in the folder browser arrives in the next release.",
    added: [
      "Settings > Accounts > Google Drive: connect through Google's sign-in page in your browser, see which account is connected, cancel a sign-in you did not finish, and disconnect.",
    ],
  },
  {
    version: "0.95.4",
    date: "2026-10-05",
    pr: 218,
    headline: "The last library Dependabot flagged, brought up to date",
    summary:
      "One advisory was left open against this repository's dependencies, and it is in a library the app never loads. http-cache-semantics parses HTTP cache headers, and here it is reached only through the tool that builds the installer, which downloads the Electron binaries behind it. Through 4.2.0 it did not check a cache entry that had been zeroed for security reasons when a request asked to be served stale through max-stale, so an unauthenticated attacker asking for the same URL could be handed another user's session cookie from a shared cache. The library is now at 4.3.0, which checks those entries. Nothing about how Trypthos looks or behaves changes.",
    fixed: [
      "http-cache-semantics 4.2.0 to 4.3.0 - a security-zeroed shared-cache entry could be served to an unauthenticated request carrying a large max-stale, disclosing another user's Set-Cookie session credentials (GHSA-ch52-4w7c-c8xp, CVE-2026-93748).",
    ],
  },
  {
    version: "0.95.3",
    date: "2026-10-05",
    pr: 217,
    headline: "Three security fixes in the libraries behind the app",
    summary:
      "Three updates Dependabot proposed as its security batch, all of them libraries the app builds and tests with rather than libraries you interact with. fast-uri, used when the packaging tool reads a URL, now validates the port and the IP-literal brackets it serialises and normalises host names consistently, which closes two high-severity and one medium-severity advisory. undici, which the test environment and the native build tool use for network requests, no longer lets a WebSocket server pick a subprotocol nobody asked for, destroys the decompressor once it hits its limit, and checks a resumed download against the framing of the original response; all three were ways to crash the process or corrupt a response. brace-expansion, the pattern matcher inside ESLint and the packaging tool, gets its hardening against patterns crafted to exhaust memory. Nothing about how Trypthos looks or behaves changes.",
    fixed: [
      "fast-uri 3.1.6 to 3.1.8 - authority injection via an unvalidated port, host confusion via misplaced IP-literal brackets, and inconsistent host case normalisation.",
      "undici 6.28.0 to 6.29.0 and 7.29.0 to 7.30.0 - three ways a hostile server could end the process, plus response splitting in the retry interceptor.",
      "brace-expansion 1.1.18 to 1.1.21, with the copies nested inside ESLint, typescript-eslint, electron-builder and the icon tooling, hardened against memory-exhausting patterns.",
    ],
  },
  {
    version: "0.95.2",
    date: "2026-10-05",
    pr: 216,
    headline: "The libraries Trypthos is built on, brought up to date",
    summary:
      "A routine refresh of the libraries underneath the app: the 18 updates Dependabot proposed as its weekly minor-and-patch batch. None is a major upgrade, and nothing here is meant to look or behave differently. What reaches you through the installer is Electron 44.4.5, which carries Chromium's latest security fixes, together with the markdown renderer (marked), its sanitiser (DOMPurify), the math typesetter (KaTeX), the editor's own decoration engine (CodeMirror and Lezer) and the interface wording layer (react-i18next). The icon library gains new glyphs and redraws three it already had, so a small number of icons in the interface are drawn slightly differently. The rest is the tooling that builds and tests the app - Vite, Vitest, ESLint and jsdom - which changes nothing you can see.",
    changed: [
      "Electron 44.4.2 to 44.4.5, with marked, DOMPurify, KaTeX, CodeMirror's state and view, Lezer highlight and react-i18next all updated to their latest patch releases.",
      "Lucide icons 1.47 to 1.48: new glyphs, and map-pinned, mail-pen and card-sim are redrawn, so any of those you use is drawn slightly differently.",
      "The build and test tooling updated: Vite 8.3.1, Vitest 5.0.2, ESLint 10.11, typescript-eslint 8.70.1 and jsdom 30.1.1.",
    ],
  },
  {
    version: "0.95.1",
    date: "2026-10-05",
    pr: 215,
    headline: "Dependency updates now arrive as diffs you can read",
    summary:
      "Nothing in the app changes. Trypthos records every library it is built on in one lock file of over 10,000 lines. That file was committed with Windows line endings, while the tools that rewrite it write Unix ones, so a proposal to update a single library arrived as a rewrite of the entire file with 33 real lines buried inside it - which is not a diff anyone can review. The file is now pinned to one line ending, so a dependency update shows the versions that changed and nothing else. This is housekeeping: it is what makes the regular dependency updates reviewable rather than something you have to wave through.",
    changed: [
      "The dependency lock file is committed with LF line endings and pinned to them, so tools that regenerate it stop rewriting the whole file.",
    ],
  },
  {
    version: "0.95.0",
    date: "2026-10-05",
    pr: 214,
    headline: "Two buttons set every file type at once",
    summary:
      "The File types page of Settings now has Enable all and Disable all across its top. Turning your whole folder browser on used to mean ticking thirty-odd boxes one at a time, and turning it back to notes-only meant finding every one that was ticked. Enable all turns on every type Trypthos knows; Disable all turns off every type that can be turned off - markdown stays on, because it is what the app is. Each button is greyed out when it would change nothing, and the list they write is the same list the boxes write, so nothing about what the setting does changes.",
    added: [
      "Enable all and Disable all buttons at the top of the File types page of Settings.",
    ],
  },
  {
    version: "0.94.0",
    date: "2026-10-05",
    pr: 210,
    headline: "Play video and audio from your folders",
    summary:
      "A folder of notes often has recordings in it, and until now Trypthos could not see them. Video and audio files now appear in the folder browser and open in the centre panel with the usual controls: play and pause, a scrub bar you can drag, volume, playback speed, picture in picture, and a fullscreen button. Nothing is loaded up front, so a long recording opens as quickly as a short one, and dragging the scrub bar jumps straight to that point however large the file - there is no size limit. The formats were chosen by testing what this app can actually decode rather than by listing what exists, so a file that appears in the tree is one it can play. Where a file turns out to use a coding this computer has no decoder for, which happens most often with .mkv, it says so plainly instead of showing a black rectangle. Playback works for folders on this computer; a GitHub repository is not supported yet, and says so rather than failing quietly.",
    added: [
      "Video files open and play in the centre panel: mp4, m4v, mov, webm, mkv and 3gp.",
      "Audio files play too: mp3, m4a, aac, wav, flac, ogg, oga, opus and weba.",
      "Transport controls, playback speed, picture in picture and fullscreen, all reachable from the keyboard.",
      "Dragging the scrub bar seeks straight to that point, however large the file.",
    ],
    changed: [
      "The Images group in File types is now Pictures, video and audio, and the two new rows are switched on for you. Turn either off there if a folder of recordings should stay out of the folder browser.",
    ],
  },
  {
    version: "0.93.0",
    date: "2026-10-05",
    pr: 209,
    headline: "The File types page is a table, one row per type",
    summary:
      "The File types page of Settings listed its types as a stack of names, each with the extensions it matches written on a second line underneath, so thirty-odd types took a couple of screens of scrolling and the only thing you could click was a small box. Every type is now a row of its own: the box, the name, and everything it matches on the same line, in columns that line up across the groups so the whole page reads as one list. Clicking anywhere on a row - the name, the space beside it - turns that type on or off, and the box still works as it always did. What the setting does is unchanged: the same types, the same groups, and markdown still always on.",
    changed: [
      "The File types page of Settings is a table with one row per type, its extensions beside its name rather than under it.",
      "Clicking anywhere on a type's row turns it on or off, not only the box.",
    ],
  },
];
