# Features

The canonical full feature list. The README carries a one-line summary of each of these, and the
About box carries a shorter table again; all three change together.

## Workspace browser

The left panel shows your open folders as trees. Open a folder from your machine or a repository from
GitHub, expand folders in place, and click a file to open it in the editor. Both kinds sit in the
same panel and behave the same way; the icon on a workspace's row says which it is.

**The filter box searches, rather than sieving what is on screen.** Type in it and every open folder
is walked by name, however deep, and what comes back is drawn as a tree of its own: each match under
the folders it lives in, whether or not you had ever expanded them, and folders containing nothing
left out entirely. **Windows search wildcards work** - `*` matches any run of characters, `?` matches
exactly one, and a filter using either has to match the whole name, so `*.md` means "ends in .md"
rather than "contains .md". Plain text with no wildcard in it matches anywhere in a name, and case
never matters either way. While a filter is up the panel is showing results rather than the tree, so
those folder rows do not collapse; clearing the box leaves the tree exactly as you left it. A large
folder takes a moment to walk, so the panel says when it is searching, and says so when a search
stopped at its limit rather than quietly showing a short list. Hidden folders such as `.git` are not
searched, exactly as they are not listed.

**Folders you left open come back put away.** A workspace reopened when the app starts is collapsed:
three open folders filling the panel with everything inside them, before you have asked for anything,
is worst for exactly the people who keep several open. A folder you open yourself still expands,
because choosing a folder is asking to see what is in it.

**Open Folder adds a folder rather than replacing the one you had.** Each open folder gets its own
row at the top of its tree. **That row collapses like any folder inside one**: click it and the whole
folder folds away, which is what keeps the panel usable with two or three open - put the ones you are
not using away and the one you are stays at the top. One click both collapses a folder and points
chat and Find at it, exactly as it does for a folder inside one. A cross at the end of the row closes
the folder instead - taking its tabs with it, and asking about anything unsaved one document at a
time. Every folder you leave open is reopened the
next time you start, in the order you opened them. Opening the same folder twice is one folder, not
two: two trees over one directory would be two sets of tabs for the same files, each with its own
idea of what is in them.

**A file is named by its folder as well as its path.** That is what makes two files both called
`notes.md`, in two different folders, two documents rather than one - and it is why the tab strip
shows `Notes/notes.md` and `Work/notes.md` when it has to tell two tabs apart. Everything that
resolves a path stays inside the folder it started in: a relative link cannot climb out of its
folder into the one beside it, a chat question about a folder is about that folder, and Find in
Files searches the workspace the selected folder belongs to.

Every folder and every file is listed, except hidden entries such as `.git` - they are not what this
panel is for. Files your enabled types cannot open are drawn in grey and cannot be clicked (see
**File types**). The footer names which types are on and counts the openable files currently on
screen rather than the whole tree: a recursive count is not free, and measured on a home directory
it took 40 seconds across 113,000 folders.

If a folder cannot be read, that folder says so on its own row and offers to try again. The rest of
the tree keeps working, because one unreadable folder is a fact about that folder rather than about
your workspace. OneDrive, Google Drive and Dropbox arrive behind the same interface, in that order.

## GitHub repositories

**Connect an account once, then open repositories like folders.** Trypthos asks for a GitHub personal
access token - from Settings > Accounts, or from the repository picker itself if you have not
connected yet. Create one at github.com/settings/tokens with read access to your repositories. The
token is checked by being used: Trypthos asks GitHub who it belongs to and shows that account, so a
token that has been revoked reads as disconnected rather than as an account that is still there. A
token that GitHub refuses is never written to disk.

**Your token never leaves this machine, and never reaches the window.** It is encrypted by your
operating system - DPAPI on Windows, the Keychain on macOS - and kept in its own file, apart from
your chat API keys, so deleting a chat model cannot sign you out of GitHub. Every request to GitHub
is made by the part of Trypthos that holds the token; the part that draws the window never sees it
and there is no way for it to ask. If your machine cannot encrypt the token, Trypthos refuses to
store it rather than writing it out in plain text.

**The picker lists the repositories you own** - public and private, newest push first, with the
description and a Private badge on each. The search box narrows that list as you type, matching the
owner, the name and the description; it filters the list already fetched, so it is instant and works
with no network. Refresh goes back to GitHub, which is what you want just after creating a
repository.

**A repository opens at the head of its default branch, pinned to the commit it was on** when you
opened it. Nobody pushing while you read can change a file underneath you. The whole listing arrives
in one request, so expanding folders, the filter box and Find in Files are as quick on a repository
as on a folder. A repository too large for GitHub to describe in one answer says so on its row rather
than quietly showing fewer folders than it has. Symlinks and submodules are not listed, exactly as
they are not followed in a local folder.

**Every repository has a page of its own.** Clicking a repository's row in the browser opens it in a
tab, the way its front page on GitHub would: six cards across the top - stars, forks, issues and pull
requests, language, licence and when it was last pushed to - with the description, its topics, and a
badge if it is private or archived. The issue figure is labelled **issues and pull requests**, because
that is what GitHub counts there; there is no field separating them without another request, and a
card labelled only "issues" would be a wrong answer given confidently.

Below the cards the repository's README is rendered as prose and scrolls under them, so the numbers
stay put while you read. A repository with no README says so, and one whose README could not be read
says that instead - they are different facts and only one of them is a fault. If GitHub cannot be
reached at all the README is still shown, with a note saying what is missing. The row still expands
and collapses as it always did; opening the page does not take that over.

**A repository's page is loaded once.** The statistics and the README are fetched the first time you
open it and shown from what the app already has after that, so going back to the page is instant
rather than another request against an hourly budget and another wait.

**Pictures in a README are drawn.** An image written relative to the document is read from the
repository the way any other file is, so one in a **private** repository appears too - a link to it
would have needed a token. A picture that is missing, or too large to open, leaves the broken frame
rather than quietly vanishing. The same is true of Preview for your own markdown, where images never
appeared either.

**Repositories are read-only for now.** Saving to GitHub is a commit on a branch, with history and
merge conflicts rather than an overwrite, and that is not built yet. Rather than pretend otherwise,
Trypthos says so before you open one and refuses a save instead of reporting one it never made. Save
As is refused for the same reason: there is no folder to save into.

Open repositories reopen the next time you start, exactly as your folders do.

Saving is deliberate: press Ctrl+S (Cmd+S on macOS), and an asterisk beside the file name shows when
there is something unsaved. If the file changed on disk since you opened it - another program, or
another window - the save is **refused** rather than applied, and your edits stay exactly where they
are. Trypthos will not decide for you which version wins.

**File > New** (Ctrl+N, Cmd+N on macOS) asks for a name and a type and opens a tab for the file. The
type is a dropdown of everything you have turned on in **File types**, so making a `.py` does not
mean knowing that Trypthos calls that Python - and if you type an extension into the name yourself,
that is the one used, because the name is the more specific of the two answers. The name it will
have is shown before you press Create.

**It does not ask where the file goes.** That question is asked by the save dialog the first time you
save, when you know more about where you want it than you did when you named it. Until then the file
is a real tab you can type into, and closing it asks about the work in it exactly as it would for any
other document. Save it and the tab follows the file to wherever you put it; from then on Ctrl+S
writes straight to it, and cancelling the save dialog leaves it exactly as it was.

**Save As** writes the document somewhere else: File > Save As, or Ctrl+Shift+S (Cmd+Shift+S on
macOS). The usual save dialog opens beside the file you are editing, and once it is written the tab
follows - you are editing the new file from then on, and the original is left exactly as it was.
Replacing a file the dialog already offered to replace goes through without a second question, since
you have just answered it.

Two documents have nowhere to be saved until you do this: the scratch buffer you start in, and the
built-in markdown guide. Both are **copied** out rather than moved, so they stay where they are and
the copy opens as an ordinary file you can edit.

Trypthos saves inside the folder you have open, and nowhere else. Pick a place outside it and the
save is declined with a message saying so - it is the same boundary everything else in the app
respects, and it is not a permissions problem with the folder you picked.

Local and cloud look like one tree to you, but they behave differently underneath: cloud listings are
paged, slow, and can fail part-way through. Trypthos shows that on the node it affects rather than
blanking the whole panel, so a directory that is still loading, or that failed, says so in place.

## File types

Trypthos opens markdown, and the **File types** page of Settings decides what else it opens. Markdown
is always on and cannot be turned off - it is what the app is. Everything else starts **on** in a new
installation, so a folder looks the way it does everywhere else on your machine; turn types off when
you want a narrower list:

| Group | Types |
| --- | --- |
| Documents | Markdown (always on), Plain text |
| Markup and data | JSON, YAML, TOML, INI and properties, XML and SVG, HTML, CSS and preprocessors |
| Images | PNG, JPEG, GIF, WebP, BMP, AVIF, ICO |
| Programming languages | JavaScript and TypeScript, Python, Shell, PowerShell, Batch, SQL, Rust, Go, C and C++, C#, Java and Kotlin, PHP, Ruby |
| Utility | Diff and patch, Dockerfile, Makefile, LaTeX, R, Lua, Perl, Swift, Scala, Dart |

Some rows carry more than one language, where the difference is not one you would want to tick a box
about. **JavaScript and TypeScript** is one choice covering `.js`, `.ts`, `.jsx` and `.tsx`;
**CSS and preprocessors** covers SCSS, Sass and LESS; **Java and Kotlin** and **C and C++** each
cover both. Trypthos works out which from the file's name.

**The scripts on your machine are covered by three rows.** **Shell** takes `.sh`, `.bash`, `.zsh`,
`.ksh`, `.fish` and `.command`, and also the configuration files that have no extension at all -
`.bashrc`, `.bash_profile`, `.zshrc`, `.profile` and their neighbours. **PowerShell** takes `.ps1`,
`.psm1` and `.psd1`. **Batch** takes `.bat` and `.cmd`, and is the one type here whose colouring
Trypthos writes itself: no batch grammar exists to use, so there is one in the app - comments in both
spellings, labels, `%VAR%` and `!VAR!` expansion, the control-flow words and the commands `cmd.exe`
carries.

**An image is the one type Trypthos does not edit.** Click a picture and it opens in a tab, drawn at
its own size and scrolling within the panel rather than shrunk to fit - a screenshot scaled down to a
side panel is a screenshot you cannot read. Hold Shift and turn the wheel to zoom it, and Shift and
drag to move around it (see **Zoom and pan** below). There are no view buttons, no word count and no
editing surface, because all three are questions about text, and nothing is ever written back.

**SVG is deliberately not an image here.** It is a picture and a text file both, and the catalogue
cannot let two rows claim one extension - so it stays with XML, where you can edit it, which is the
more useful of the two answers.

**An image is not sent to a chat model.** Asking about a folder still lists it by name, and the
picture itself stays on your machine.

**Dockerfile and Makefile are matched by name**, not by extension, because neither has one. Makefile
is the only type Trypthos does not colour: no grammar for it exists. It has a row anyway, because
the first thing a file type does is make the file appear and open at all - the same reason Plain
text has one.

Every type is **coloured by role** - keywords, strings, comments, numbers, types and names - using
the same palette as the rest of the app, so the editor follows your light or dark theme instead of
being painted on top of it. As in Source view, colour stands in for meaning: nothing is resized or
made bold. A grammar is fetched only the first time you open a file that needs one, so types you
never turn on cost you nothing.

### Code inside your notes

A **fenced code block** in a markdown document is coloured by the language its fence names, in the
same colours a file of that language gets on its own:

````
```python
def greet(name):
    return f"hello {name}"
```
````

The tags you would expect all work - the short ones (`py`, `ts`, `rs`, `sh`, `yml`) and the
written-out ones (`typescript`, `kotlin`, `c++`).

This follows your File types setting rather than working for everything. A fence naming a language
you have not turned on still reads as a code block, in the code colour markdown has always given it;
it simply is not broken up by role. So the setting governs the inside of a document as much as which
files appear on the left.

Preview colours them too, and so do **replies in the chat panel** - the same colours, from the same
list of file types. The colouring appears a moment after the text, because the language is fetched
only when something needs it, exactly as in the editor. Your code is untouched down to the
character, and anything that looks like markup inside a code block stays text.

A type that is off is not merely uncoloured, it is absent. Its files do not appear in the folder
browser, cannot be opened by clicking a link to one, and are not among the files chat is offered or
allowed to read. Turning a type on is therefore a decision about what you want to see: point Trypthos
at a folder full of that type and the list on the left gets a great deal longer.

The footer under the folder browser says which types are on - the type's name when there is one, a
count when there are more - and clicking it goes straight to the page that changes them.

Your choice is remembered between launches, and **upgrading never changes it**. A Trypthos that has
been showing you markdown alone carries on doing exactly that until you say otherwise - only a new
installation starts with everything on, because it has nobody to surprise.

A file no enabled type covers - a picture, an archive, or a type you have turned off - is **listed
in grey** rather than left out, and cannot be clicked. Hovering it says why. Leaving such files out
made the panel disagree with every other way of looking at the same folder, and a file that is
simply absent tells you nothing: "Trypthos will not open this" and "this is not there" look
identical. The count in the footer still counts only the files your enabled types can open, so it
matches the types named beside it.

A file that is not markdown opens in **Source** and stays there. Live and Preview are markdown ideas
- Live hides markdown punctuation, Preview renders markdown as prose - so neither means anything over
a stylesheet, and the view buttons are simply not drawn for a document with one view. The formatting
toolbar goes with them, since its buttons write markdown.

Two things about editing change with the file as well. Lines wrap only in prose, because in code and
in logs the column a character sits in is information. And spelling is checked only in prose, because
otherwise every identifier in a source file is underlined in red.

## Markdown editor

The centre panel edits markdown in one of three views over the same document:

- **Source** shows every character, colour-coded by role: markers stay dim, while headings,
  emphasis, code and links stand out. Nothing is resized or bolded, so what you read is exactly what
  is stored. Line numbers, undo and redo work as you would expect.
- **Preview** is read-only rendered prose. No caret, no gutter - it stops being an editing surface.
- **Live** hides syntax markers until your cursor reaches a line, which then shows its own
  scaffolding. Reads like a document, edits like text. This is the view documents open in unless you
  choose another on the Editor page of Settings - so if you work in Source, files open in Source
  rather than needing a click each time. The header still switches view for the document in front of
  you, and that choice lasts until you open another document.

  Headings, bold, italic, inline code, links, quotes and list bullets render in place, and the line
  you are editing is tinted. Tables, images, footnotes and fenced code blocks still show as source
  for now - a construct without a decoration renders as
  itself rather than disappearing, so nothing is ever hidden that Trypthos cannot draw.

The row above the editor holds the open files on the left and the state of the one you are in on the
right: a pill when it has unsaved changes, and three icon buttons for Live, Source and Preview, whose
names appear on hover. The strip along the bottom names the view you are in, your cursor position and
word count, and the format, encoding and line endings the file actually uses - measured rather than
assumed, so a file that mixes Windows and Unix line endings is reported as mixed rather than as one
or the other.

### The formatting toolbar

Source view carries a row of buttons above the document, one for every construct Trypthos renders:
bold, italic, strikethrough and inline code; links and images; heading levels one to three; quotes,
bulleted lists, numbered lists and task lists; code blocks, tables and horizontal rules. Hovering a
button names it, and the buttons are grouped by what they act on.

They act on what you are doing rather than simply inserting characters:

- A **heading** button works on the line the cursor is on, whether or not anything is selected.
  Press it once to make that line a heading, press the same level again to turn it back into a
  paragraph, or press a different level to change level. Select several lines and it acts on all of
  them.
- **Bold**, **italic**, **strikethrough** and **inline code** wrap the text you have selected, and
  the text stays selected afterwards - so pressing the same button again removes the markers. With
  nothing selected they act on the word the cursor is in, and on nothing at all they insert the pair
  of markers with the cursor between them.
- **Link** and **image** turn a selection into `[text](url)` with the address selected ready to type
  over, and a link that is already a link is unlinked rather than wrapped in another.
- The three **list** buttons and **quote** prefix every line the selection touches, and remove the
  prefix when every line already has it. They convert one kind of list into another rather than
  stacking markers, so a bulleted list becomes a numbered one in one press.
- **Code block**, **table** and **horizontal rule** insert a block. A rule or a table goes below the
  line you are on rather than into the middle of it, and a table arrives with its first heading
  selected.

Each press is a single change, so one Ctrl+Z (Cmd+Z on macOS) undoes it, and the cursor goes back
into the document afterwards. The toolbar is in Source view only: Live hides the markers a press
writes, so the same button there would insert punctuation that vanished as it landed, and Preview is
not an editing surface.

## Find, and find in files

**Ctrl+F, or Edit > Find.** A small panel opens in the corner of the editor with two tabs. It is
deliberately not a modal over the window: the whole answer is a highlight in the document underneath
it, so a dialog that covered the document would report three matches and show none of them.

**Find** looks through the document you have open. Every match is marked, and the one you are on is
marked more strongly, so a page with a dozen of them still tells you where you are. **Next** and
**Previous** walk the list and wrap round at both ends. **Enter** in the box does the same thing -
it searches the first time and steps after that, and **Shift+Enter** goes back - so a document can
be walked without reaching for the buttons.

**Find in Files** searches the folder selected in the browser and everything below it. If you have
not selected a folder, it searches the folder the file you are reading lives in; if you are not
reading a file either, it searches the whole folder you have open. **The panel says which before you
press Search**, because those can be a long way apart and a search that quietly looked somewhere else
would be worse than one that refused. Every hit opens its file in a tab and marks the line, and Next
carries straight on into the next file.

**Both take plain text or a regular expression**, chosen with the checkbox. Plain text means the
characters themselves - searching for `a.b` finds `a.b` and not `axb` - and an expression that will
not compile says so rather than quietly finding nothing, because "that is not a pattern" and "the
text is not there" send you in opposite directions.

**Match case** is a second, separate checkbox. The two are independent rather than a mode: a
case-sensitive regular expression is an ordinary thing to want, and so is a case-sensitive plain
search. It starts off, which is what the rest of the app's searching does - turn it on when the
difference matters, as it does in a source file, where `state`, `State` and `STATE` are three things
in code and one thing in prose.

**The panel can be moved.** Grab the strip the tabs sit on and drag it anywhere in the window -
across the folder browser, across the chat panel, and down to the bottom. It floats over the document
it is reporting on, so it can end up sitting exactly on top of the text you were trying to read, and
this is the way out of that; confining it to the editor would leave the one place it could go being
the one place it is in the way.

Two limits are kept. It will not climb above the title bar, because that is where the window buttons
are and a panel parked over the close button is a panel in the way of the only chrome this window
has. And it cannot be pushed off the edge of the window - it has no title bar of its own, so one
dragged out of sight would be one you could never get back.

Where you put it is remembered until you close the app, so it does not go back to covering the same
text the next time you press Ctrl+F. The buttons on that strip still work; only a press that starts
on the strip itself moves the panel.

Three things a search in files will not do. It **never leaves the folder you have open** - the
boundary is checked where the files are read, not in the window that asked. It **reads only the file
types you have turned on**, so a type you have switched off is not searched any more than it is
listed. And it **stops at a sensible size** rather than walking a fifty-thousand-file tree - and when
it stops early it says so, because a list silently cut short is a wrong answer given confidently.

One consequence worth knowing: **a document in Preview switches to an editable view while a match is
on screen.** Preview has no caret and no place to draw a highlight, so a search there would report
matches and show none of them. It goes back to Preview when you close the find.

## Zoom and pan

**Hold Shift and turn the wheel to zoom, hold Shift and drag to pan.** The same two gestures work
wherever the pointer is - the editing surface, rendered prose, or a picture - and what they do
underneath is what each of those needs:

- **Text is zoomed by size, not by scale.** The document's text, its line numbers and its heading
  scale all grow together, and the text still wraps to the panel at the size you are reading it at.
  Nothing is stretched, because nothing is being scaled: it is the same document at a larger size.
- **A picture is zoomed for real.** Its own pixels are multiplied, so its box on screen grows with
  it and there is something to pan around. That is the difference between a zoom and a magnifying
  glass: a picture painted larger inside a box that stayed the same size could not be moved.

The wheel steps through a ladder of levels rather than multiplying by a fraction each notch, and 100%
is on it - so turning the wheel back the way you came puts a document back at exactly the size it
opened at rather than near it.

**The level belongs to the document, not to the window.** Zooming one file does not resize the one in
the tab beside it, and switching between Live, Source and Preview keeps the level you were reading
at - a view of a document, in both senses. It is not saved: a zoom is how you are reading something
now rather than a setting, so a file opens at its own size every time.

**The keyboard does the same three things.** **Ctrl and plus** and **Ctrl and minus** step the same
ladder the wheel does, and **Ctrl and 0** goes straight back to 100% from wherever you are on it -
the one thing the wheel cannot do in a press. On macOS they are Cmd. They act on the document on
screen wherever the cursor is, so you do not have to put the pointer over anything first.

**Dragging with Shift held pans instead of selecting.** That is the one thing it takes away: in the
editor, Shift and a click would otherwise extend the selection to where you clicked. Selecting by
dragging, by double-click, and with Shift and the arrow keys all work as they did.

## The markdown Trypthos speaks

Trypthos reads and renders **GitHub Flavored Markdown**: the CommonMark specification, plus the
GitHub extensions for tables, task lists, strikethrough and automatic links. Footnotes, definition
lists, mathematics and YAML front matter are not part of that and are left as plain text.

**Help > Markdown Syntax Guide** opens a guide to all of it in a tab, with each construct shown as
markdown and as what it produces. It is part of the app rather than a file in your folder, so it is
read-only and is never saved: nothing you do to it can change it, and closing it asks nothing. Read
it in Preview to see the examples rendered, or in Source to see how they are written.

## Tabs

Every file you open gets a tab. Clicking a file in the folder browser opens it in a new tab, or - if
it is already open - goes to the tab it is in, without reading the file again, so anything you had
typed is exactly as you left it. The same is true of a link you follow from one document to another.

A tab shows the file's own name, cut short with an ellipsis when it does not fit, and the whole path
on hover. Two open files with the same name grow just enough folder to tell them apart, and only
those two - the rest of the strip stays short. With more files open than the row can hold, the tabs
scroll, and the one you switch to is brought into view.

A tab that has scrolled out of sight is a file you would otherwise have to go looking for, so the
button at the end of the strip lists every open file at once: each one named, with the folder it
lives in underneath it, the file you are looking at highlighted, and a dot beside any with unsaved
changes. Choose one and you go to it. There is more room for a folder name here than there is on a
tab, which is what makes the list worth having even when every tab does fit.

Close a tab with the x on it, with a middle click, or with Ctrl+W (Cmd+W on macOS), which closes the
one you are in. If that file has unsaved changes you are asked about it by name, which matters when more than
one is unsaved: closing the window asks about each in turn, and cancelling any of them stops the
close. A file with unsaved changes that you are not looking at shows a dot on its tab, since the pill
in the header speaks only for the file on screen.

**Right-click a tab** for the five ways of closing: **Close**, **Close Tabs to the Right**, **Close
All**, **Close Others** and **Close Saved** - saved meaning any tab with nothing unsaved in it,
including the one you right-clicked. Each of them asks about unsaved work one document at a time, and
cancelling stops the rest, so a Close Others cannot shut tabs you were never asked about; whatever
closed before the cancel stays closed, because you agreed to each of those. An entry that would close
nothing is greyed rather than offered - Close Tabs to the Right on the last tab, Close Others when
there is only one.

Coming back to a tab puts you back where you were - the same caret position, and the same place in
the document, rather than the top of it. Each file also keeps the view you were reading it in, so a
file you switched to Source stays in Source while you work in Live elsewhere. The folder browser
marks every open file, and marks the one on screen more strongly, so it is clear which click will
open something and which will simply take you there.

Switching view never rewrites your file. The bytes on disk are identical in every view, so a
document can be shared between someone who wants to read it and someone who cares about its exact
text, without either being surprised by what the other did to it.

Preview renders whatever the file contains, and a markdown file is untrusted input like any other,
so the rendered HTML is sanitised before it is shown.

### Following a link

A link goes where it points, and never over the top of Trypthos. A web address opens in your own
browser and leaves the app exactly where it was - a page loaded inside a window with no address bar
and no back button is a place with no way out of it. A link to another markdown file in the open
folder opens that file in the editor, resolved relative to the document you are reading, exactly as
clicking it in the folder browser would; a link to a file that has since been renamed, moved or
deleted reports that rather than doing nothing. Anything else - a picture, a PDF, a path that leads
outside your folder - does nothing at all.

Hovering a link shows where it goes, which is how you tell a file in your folder from a page on the
internet before you click. This holds in Preview, in the chat panel's replies and in the About box.
Live mode is the one difference: link text there is still text you are editing, so a plain click
places the cursor and Ctrl+click (Cmd+click on macOS) follows the link.

## File Explorer, on Windows

Trypthos can put itself in File Explorer's right-click menu: **Open folder in Trypthos** on a folder,
or on the empty space inside one, and **Open in Trypthos** on a markdown file. It also appears in
Explorer's **Open with** list, so you can make it the default for markdown if you want to.

It is off until you ask for it, on the Window page of Settings, and the same switch takes it away
again. Nothing is written outside your own user account, so it needs no administrator rights and
changes nothing for anybody else who uses the machine.

**On Windows 11 the entries appear under "Show more options"**, not on the first menu that opens.
That menu is reserved for apps that ship a signed handler of a particular kind, which Trypthos does
not yet - the same signing work that makes SmartScreen stop warning. Settings says so beside the
switch, so a right-click that seems to show nothing is not a mystery.

Opening a folder this way opens it as your workspace. Opening a **file** opens the folder it lives in
and the file itself, because every document Trypthos edits lives inside one open folder. If Trypthos
is already running, whatever you opened arrives in the window you already have - a file in the folder
you are already in simply becomes another tab, and one from somewhere else opens that folder instead,
asking about unsaved work first exactly as opening a folder from the button does.

macOS has no equivalent for folders, and Trypthos does not yet register itself for markdown files
there. That is outstanding work rather than a decision.

## Menus and the right-click menu

The window draws its own title bar, so on Windows the File, Edit, Tools and Help labels sit in that
bar. They open real native menus: native rendering, the platform's own accelerator text, and the
platform's own cut, copy and paste. On macOS the same commands appear where they belong, in the
system menu bar at the top of the screen, and the window draws no menu labels of its own.

- **File** makes a new file, opens a folder, saves the current file, saves it somewhere else, reopens a recent file, closes the window and quits.
- **Edit** carries undo, redo, cut, copy, paste and select all.
- **Tools** carries Settings. On macOS this lives in the application menu instead, which is where
  that platform expects it.
- **Help** carries the Markdown Syntax Guide, Release Notes, Check for Updates and About.

Nothing on a menu is a separate implementation: each item drives the same thing its shortcut does,
so they cannot drift apart.

**The menus are the way to Settings, About and the release notes.** The title bar carried a cog and
an About button until 0.60.0; both are gone, because a second way in is a second thing to keep
working, and the bar is now the window's chrome and nothing else. On macOS all three live where that
platform expects them - Settings and About in the Trypthos menu, Release Notes under Help.

## Release notes

**Help > Release Notes** opens the app's own history. The releases since the last chapter are listed
in full at the top: what each one was about, and what was added, changed or fixed. Below them is a
card for each earlier **chapter** - a named stretch of work, with the number of releases it covers and
the dates it ran between. Open a chapter and you get every release in it, exactly as it was written
when it shipped.

A chapter is a heading over the history, never a replacement for it. Nothing is merged, shortened or
dropped to make a summary read better, and the release you find under a chapter heading is the one
that was published, down to the wording of its bullets.

The full history is fetched only when you open the window, and the older releases only when you open
the chapter they are in. It grows with every release, and carrying it about would otherwise cost
something on every start for a page most people open rarely.

**Open Recent**, under File, lists the last ten files you opened, newest first. Each entry names the
folder as well as the file, because the same file name in two folders is two different files.
Choosing one opens the folder and the file together - the same act as a right-click in File Explorer,
so it asks about unsaved work first, and reports a file that is no longer there the way any other
open does. A file you saved somewhere else goes on the list too, since that is the file you are
working in from then on.

Nothing checks the disk when the menu opens, so an entry for a file you have since deleted or moved
stays on the list until it falls off the end. **Clear Recent Files**, at the bottom of the same
submenu, is there for that.

Right-clicking text opens a menu suited to what you clicked, in every field you can type in - the
document, the chat box, the system prompt, a settings field. In an editable field that is undo, redo,
cut, copy, paste and select all, with anything you cannot currently do greyed out rather than
offered. Over a misspelled word it also lists corrections, and offers to add the word to your
dictionary - the spelling suggestions have no other route into the app. Right-clicking ordinary text
with a selection offers to copy it; right-clicking with nothing to offer opens nothing at all, rather
than a menu of dead items.

Spelling is checked as you type, and misspelled words are underlined, in the document and in the
prose you write elsewhere - your questions to chat, and the system prompt. Trypthos checks in your
system's language where a dictionary exists for it, another dialect of that language where one does
not, and English otherwise. Fields that hold an address, a model name or a key are left alone: a URL
is not prose, and underlining one would only be noise.

## AI chat

The right panel answers questions about the open document, your selection, and the wider folder.

**It is not in the window until you have a model to chat with.** A panel with nothing behind it can
only tell you to go and configure one, so on a fresh installation there is no panel and the editor
has the width; the moment you save your first model in Settings it appears, without anybody
having to find a setting. The Chat models section carries a **Show the chat panel** switch for the
times that rule gets it wrong - turn it off to keep a plain editor and folder browser with models
configured, or on to have the panel there while you are still setting one up. Once you use the
switch it is your answer, and Trypthos stops deciding for you.

You configure the endpoint, model and parameters yourself, as a list of named models you choose
between per message. Settings has a Chat models page for this: each entry carries a name you
read, the address of an OpenAI-compatible endpoint, the model slug that endpoint expects, and
optional temperature and token limits. One is marked as the model new chats start on.

Requests go directly from Trypthos to the endpoint you named; no Trypthos server is involved,
because there is not one.

An API key is stored per endpoint, so two models at the same provider share one key. Keys are
encrypted by Windows or macOS and held outside your settings file, which means a settings file you
copy, sync or attach to a bug report carries no key with it. Trypthos will tell you whether a key is
stored and let you replace or remove it, but it will not show you a stored key - nothing in the app
can read one back. If your computer cannot encrypt the key, Trypthos says so and does not store it,
rather than falling back to writing it in plain text. Removing a model, or pointing it at a different
endpoint, deletes the key nothing uses any more.

The panel itself works: type a question, press Enter, and the reply streams in as the model writes
it. The model that answers is chosen from the picker at the top of the panel, which starts on the one
marked as the default. While a reply is arriving the send button becomes a stop button in the same
place, so an endpoint that accepts a request and then goes quiet is never a panel with no way out.
Replies render as markdown, and are sanitised before they are shown - a model's output is text
Trypthos did not write, and is treated with the same suspicion as a file from your workspace.

### How full the context is

A ring at the end of the scope bar fills as the conversation grows. It counts everything the next
question will carry - the system prompt, the document or your selection, any attached files, the
folder outline, the conversation so far, and what you have typed but not yet sent - so it moves as
you write, in the document as well as in the chat box. Hover it for the amount and the total.

**Every number it shows is an estimate, and the wording says so.** Counting tokens exactly needs the
provider's own tokeniser, and an OpenAI-compatible endpoint has none to offer: it reports its own
count in the reply, which is after the question the dial exists to inform. Trypthos counts roughly
four characters to a token, which is close on English prose and less so on code.

The total comes from the **Context window** box on each chat model, which you fill in from your
provider's documentation. There is no way to ask an endpoint how large its window is, so leaving the
box empty is a real answer: the ring then stays empty and the hover gives the amount without claiming
to know how much room is left. Past the end, the ring fills and turns red, and the hover says what
usually happens next - an endpoint typically drops the oldest of the conversation rather than
refusing outright.

### What the model is told

Every question carries the document with it, decided by one small rule:

- **A selection, if you have made one.** Selecting a passage and then asking about it is a clear way
  of saying which part you mean, so the selection replaces the file rather than being added to it.
- **Otherwise the whole open file**, as it stands in the editor - including edits you have not saved,
  because the file on disk is not what you are looking at.
- **Otherwise nothing.** With no file open and nothing selected, chat answers from the conversation
  alone.

A very large document is shortened before it is sent, and the model is told that it was, so an answer
never implies the document ended where the cut fell. The document is fenced and labelled as reference
material: a markdown file can contain text addressed at an assistant, and the model is told to treat
it as data rather than as instructions.

Selection is read from the editor, so Preview mode reports none and chat falls back to the whole
file - which is the right answer for a mode you cannot edit in.

**A selection stays visible while you type the question about it.** Click into the chat box and the
highlight is still there, drawn a shade quieter to show the caret is elsewhere. It is the only thing
on screen saying whether the model will get the passage or the whole file, so it is the last thing
that should vanish at the moment you are asking.

### The system prompt

Settings carries one system prompt, sent ahead of every conversation. It ships with a default
written for markdown work: answer in the document's own conventions, keep the document's own words
for names and figures when summarising, and return a rewrite as the markdown itself rather than
wrapped in an explanation of what changed.

Edit it however you like. Clearing it entirely is allowed, for an endpoint that already has its own
prompt, and nothing will put one back. Reset restores the default, and is offered only when the
prompt has actually been changed.

Until you edit it, Trypthos does not keep a copy of the prompt - it simply remembers that you have
not written one. That is what lets an improved default reach you in a later version. Once you edit
it, the text is yours and no update will touch it; Reset is how you go back to following the
built-in prompt again.

### Changing the document

Ask for a change rather than an answer - "summarise this in 50 words under a Summary heading, before
Objectives" - and the reply comes back as a card. The card names where the change would go, shows
exactly the markdown that would be written, and does nothing until you press **Apply**.

Five kinds of change are possible: insert before a heading, insert directly under one, replace a
whole section, replace the passage you have selected, and add to the end of the document.

Some deliberate behaviour worth knowing:

- **Nothing is written until you click.** This is not politeness. Your document is sent to the model,
  and a markdown file can contain text written to look like instructions to an assistant, so a change
  that applied itself would be a way for a document to edit itself. You are the step that prevents it.
- **An applied change is one undo step.** If you dislike what arrived, Ctrl+Z once gives your document
  back.
- **The target is checked at the moment you click**, against the document as it stands. If the heading
  has been renamed or deleted since the model saw it, the card says so rather than offering a button.
- **Two headings with the same name means the change is refused**, not placed under the first one.
  Guessing would put text in the wrong section while looking like it worked.
- **A change is never written to disk.** It edits the document in the editor; you still save it
  yourself, and the conflict check still applies.

If the model gets the format wrong, the block simply stays on screen as ordinary markdown that you
can copy by hand. A confused model costs a copy and paste, never the answer.

Trypthos is deliberately forgiving about how a proposal is written: models close a fenced block in
several ways, and some forget to close it at all. Any of those is accepted once the reply has
finished. A card only appears at that point, never part-way through a reply, so a change can never
be applied with half a sentence in it.

### A more reliable route, where your endpoint supports it

Describing a format in words and hoping the model follows it is the part of this that varies most
between models. If your endpoint supports **tool calling**, Trypthos can ask for the change as a
structured call instead, which removes that variance.

Tick **This endpoint supports tool calling** on the model in Settings. Measured against one local
model asked for a summary before a named heading: without it, roughly half the attempts produced no
usable proposal at all; with it, every attempt did.

It is **off by default and stays off** for models you configured earlier, because there is no way to
ask an endpoint whether it supports tools. Several accept the request, ignore it, and answer in
prose - which looks exactly like a model that simply chose not to use one. If you turn it on and
chat stops proposing changes, turn it back off.

Everything after that is the same: the same card, the same Apply, the same single undo. The tool call
is the proposal and nothing else - Trypthos never sends a result back, and no change is ever made
without you pressing the button.

### When a model answers with nothing

Some models - the ones that think before replying - occasionally finish a turn having done all their
thinking and written no answer. Trypthos says so, and offers to unfold what the model was thinking,
rather than showing you an empty message. Asking again usually works; it is a habit of the model
rather than a fault in the request.

### Following a reply to the file it names

A model names a file in backticks - it is how every model names one - and those are **links**. Click
one and the file opens in a tab, exactly as a link you had typed yourself would. A web address in
backticks opens in your browser, as one written as a link already did.

What becomes a link is decided by the same rule the rest of the app uses for a link, so the answer is
the same wherever you click it: a path outside your folder is not a link, a file type you have turned
off is not a link, and anything that is not a file at all stays as text - `npm run build`, `and/or`,
`--force`. A path to a file that has since moved is still a link, and clicking it says so the way any
other missing file does.

**Replies only.** Your own documents are rendered exactly as you wrote them; turning their code spans
into links would change how your prose reads.

### What a model can do with the folder you attached

Attaching a folder gives the model more than a list of names. It can:

| Tool | What it does |
| --- | --- |
| `get_file_contents` | Read one of the files on the list. |
| `list_directory` | List what is in a directory of that folder, or one below it. |
| `search_contents` | Search the text of those files for a word or a pattern, and say which file and line each match is on. |
| `diff_files` | Compare two of those files line by line. |
| `open_file` | Open one of those files in a tab, so you can see it. |
| `propose_edit` | Suggest a change to your open document, as a card you can apply or ignore. |
| `create_file` | Make a **new** file in that folder. It cannot replace one that already exists. |

`/tools` in the chat box shows the same list.

**How far this reaches, plainly.** Until listing and searching existed, a model could read only the
files named in the list your folder produced - ten of them by default. Now it can find and read
anything **inside the folder you attached, and below it**. Not the rest of your workspace, and
nothing outside it: the folder you attach is the boundary, it is checked on every call, and the
workspace guard that stops any path leaving your open folder still applies underneath. Attaching a
folder is the moment you decide this, which is why the tools are not offered until you do.

Only the file types you have turned on are searched, so a search never mentions a file the browser
would not show you.

**One of these writes to your disk, and it is worth being clear about which.** Everything a model
suggests about a file you already have arrives as a card you press Apply on - that has not changed.
`create_file` is the exception: it makes a **new** file without asking. It is bounded four ways -
inside the folder you attached, a file type you have turned on, a size a person can read through,
and it can only ever create. **It cannot replace a file that already exists**, and that is enforced
by the write itself rather than by a check that could be raced: the write says "there should be
nothing here", and the app refuses when there is.

A file it makes is opened in a tab unless the model says otherwise, so you see what was made rather
than finding it later.

Every answer is capped - so many entries in a listing, so many matching lines, so many lines of
difference - and a capped answer **says so**. A model told it has everything when it has the first
sixty matches will answer confidently and wrongly.

### Commands you can type instead of a question

Two, so far:

| Command | What it does |
| --- | --- |
| `/commands`, `/help` | Lists what you can type into the chat box. |
| `/tools` | Lists what the model can be given beyond your question, and says which of them it actually gets. |

Both are answered by Trypthos rather than by a model. They say something about this app, which no
endpoint can be expected to know and none should be paid to guess at - so nothing is sent, nothing
streams, and there is no wait.

**Neither the command nor its answer ever reaches a provider**, including in the questions that
follow. Asking what the tools are does not become part of what the model thinks it can do. They stay
in the thread and are kept when you save the chat, because that is what you were shown.

A message counts as a command only when it is **nothing but** the command. A leading slash is an
ordinary way to start a sentence - a path, a fraction, a date - so `/usr/local/bin - what lives
there?` reaches the model exactly as you wrote it.

### Keeping a conversation

Save a chat from the button at the top of the panel and it is kept between launches. It is named
after the question that started it, so nothing asks you to invent a title. The clock icon lists what
you have saved, with the file each conversation was about, and lets you reopen or delete any of them.

Saving a conversation you reopened **updates** it rather than making a second copy. Clearing the
panel starts a fresh one, so the next save is a new conversation rather than an overwrite of the
last.

Conversations are plain JSON files in Trypthos's own application-data folder, one per chat. They are
deliberately **not** in the folder you are editing: that would put files you did not create into a
tree you curate, and in a synced folder it would invite sync conflicts on files you never asked to
sync.

The cost of that choice is that a conversation only **references** the file it was about. Rename or
delete that file, or open the chat against a different folder, and the conversation still opens - it
is your own words and still worth reading - with a line saying which file it was about. Conversations
also do not travel when a folder does: they live with Trypthos, not with your notes.

### Looking beyond the open document

A row above the message box shows what chat can see, and nothing is included unless you ask for it.
A reply that quietly consulted five files, or quietly did not, is one you cannot judge.

**Attach a file** and it is sent in full alongside your document, so you can ask how two notes relate
without pasting one into the other. Attachments are read when you attach them, so editing a file
afterwards does not silently change what an earlier answer was about.

A model with a **reasoning mode** shows its thinking under any reply that has some, **folded away**:
open it when you are interested, and it stays closed otherwise. It belongs to that reply, so it is
still there when you scroll back, and it is kept when you save the chat - shortened rather than
dropped if it ran very long, and the fold says when it was. Thinking is shown as plain text and is
never turned into a change you can apply: a model working out *whether* to propose an edit writes
something that looks exactly like one, and offering Apply for a change it never proposed would be
worse than not showing the thinking at all.

Reading a file works **whether or not your endpoint supports tool calling**. Where it does, the model
calls for the file; where it does not, it asks by writing a small fenced block and Trypthos hands the
file over and lets it carry on. Either way it can only read the files on the list, from the folder
you chose. The instructions sent with the folder describe whichever of the two your model has.

When the model reads a file from the folder you gave it, the reply says so: **one line at the bottom
of that answer** naming every file it read, with the full paths on hover. One line however many it
read, and it stays with the answer - scroll back to something from last week and you can still see
what it was looking at. While you are waiting, the bubble still says which file is being read, since
that is what is happening now rather than what happened.

A model with a **reasoning mode** can be asked to think before it answers. Each model has a Thinking
switch on its page in Settings, with a level - Low, Medium or High - and Trypthos sends that with
every message to it. gpt-oss is the model this was built for, and it reasons at exactly those three
levels. It is **off** for every model, including ones you already have: an endpoint that has never
heard of the setting may ignore it or refuse the request outright, which is the same reason tool
calling is a switch rather than an assumption. The level stays as you set it while Thinking is off,
so turning it back on does not make you choose again. Trypthos does not show you the reasoning - what
changes is the answer.

**Folder** sends the *list* of files in the folder **you selected in the browser** - the names, never
the contents, and only the file types you have turned on. Click a folder on the left and it becomes
the selected one, shown highlighted; the same click still opens and closes it. When the button is on
it names the folder going with your question - the last part of the path, since the button sits beside
the composer where width is scarce. When it is off it reads simply **Folder**, because nothing about
that folder is being sent. Either way, hovering shows the whole path, which is how you find out what
turning it on would send. The selection stays where you put it as you move between files:
which document you are reading and which folder your question is about are different questions.
Opening a different workspace puts it back to the top level. A notes folder can hold a great many files; sending them all would bury the document
your question was actually about, and on a hosted endpoint it would cost real money.

The turn carrying your document also says **what kind of file it is** when it is not markdown, and
the built-in instructions tell the model what to do about that: answer about it as that kind of
file, write anything it proposes in the file's own language rather than in markdown, and use only
the two kinds of change that can be placed in a file with no headings. It says so rather than guess
if neither fits. If you have written your own instructions in Settings, yours are used unchanged.

If your endpoint supports tool calling, the model can then **ask to read** one of those files, and
another, until it has what it needs. The panel says which file it is reading while it does. It can
only read files on that list - anything else is refused, and the model is told why, so it can pick
something else or answer without it. Without tool calling, the list still helps: the model says which
file it would need and you attach it yourself.

How many files the list names is yours to set, on the AI and system prompt page, and defaults to ten. Every entry is a
file the model might ask to read, so a longer list is a more capable chat and a more expensive one.
Only the top level of the folder is listed; files in subfolders are not offered and cannot be read.

There is a limit on how many times the model may read in one turn. Each read sends the conversation
again, so an unbounded loop would be an unbounded bill; when it is reached the model is told plainly
to answer with what it has, rather than being cut off mid-thought.

**Your document keeps its place.** Everything shares one budget, and the file you are editing is
served first: an attachment that would push it out is shortened instead, and one there was no room
for at all is still named, so the model knows it exists and did not see it.

Starting a new conversation clears its attachments rather than carrying them into the next one.

Chats are saved on your machine. A chat references the file and workspace it was about rather than
being stored beside them, so it will tell you when that file has since been renamed, moved or
deleted.

## Unsaved changes

Anything that would throw away unsaved edits asks first: opening another file, opening another
folder, and closing the window. The prompt offers **Save**, **Don't Save** and **Cancel**, and
cancelling leaves everything exactly as it was - the same file, the same text, still unsaved.

If you choose Save and the save cannot be made - the file changed on disk since you opened it, say -
nothing is discarded and nothing closes. The conflict is reported and your text is still in the
editor, which is the whole point of asking.

Two cases deliberately do not ask. **Keeping Trypthos running in the tray** closes nothing: the
window hides and your document is still open behind it, so there is nothing in danger. And the
**scratch buffer** you see before opening a file has never been on disk - it says so - so it is not
treated as unsaved work.

## Settings

Settings opens as a window of its own, with a rail down the left and a page per subject: Appearance,
Window, Chat models, AI and system prompt, Editor, File types, and About. Open it from the cog in the title bar,
from Tools on Windows or the app menu on macOS, or with Ctrl+comma. Escape closes it.

Every setting takes effect the moment you choose it. There is no Save button, and so nothing to
forget: pick Dark and the app is dark behind the window while you are still looking at it. A chat
model is the one exception, because a model is several fields that are only valid together - it has
its own Save, and abandoning the form or leaving the page discards it.

Chat models have a page to themselves. Configured models are listed as cards, and the rail lists them
too while you are on that page, so a model is one click away wherever you are in it. Editing one
opens its form on its own rather than stacking every model's fields on one screen.

About is a page here rather than a box of its own, so what Trypthos says about itself is in one
place. The title bar's version button and the Help menu both open it.

## Appearance

Choose Light, Dark, or follow your system, from Settings - the cog in the title bar. Following the
system means exactly that: Trypthos keeps up if your machine switches at dusk, rather than deciding
once when it started.

The window draws its own title bar, which names the file you have open and carries About alongside
the window buttons - one bar rather than the system's and the app's stacked together. On macOS the
usual red, amber and green buttons stay where macOS puts them.

## Layout, remembered

Drag the seam beside either side panel to resize it, or focus the seam and use the arrow keys. Hide a
panel entirely and a strip stays at the edge to bring it back.

Panel sizes, which panels are hidden, and the folder you had open are remembered between launches -
the folder reopens automatically, and is quietly ignored if it has since been moved or deleted.

If the window is too narrow to fit everything, the side panels give up their space before the editor
does. A cramped file list is workable; a cramped document is not.

## Updates

On starting up, Trypthos checks whether a newer version has been published. If there is one you get a
notification; clicking it downloads and installs the update, with nothing further asked - the click
is the consent. If you are already up to date, startup says nothing: an app that announces good news
every launch is one people learn to dismiss unread.

A Trypthos icon sits in the notification area. Right-click it for **Check for Updates**, which answers
either way and asks before downloading, since you went looking for it deliberately.

On macOS, Trypthos cannot install its own updates yet - that needs a signed build - but it still
downloads the disk image for you and opens it, so the only thing left to do is drag it into
Applications rather than hunting for the right file on a webpage first. If nothing has been published
for your platform, or the download does not go through, Trypthos falls back to opening the releases
page instead of failing part-way through.

Closing the window quits the app, unless you turn on **Keep running when the window is closed** in
Settings - then it hides to the notification area and you quit it from the tray icon.

## Local by default

No account, no sign-in, no telemetry, no server. Everything Trypthos stores - settings, chats - is a
plain file on your machine.
