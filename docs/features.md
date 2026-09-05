# Features

The canonical full feature list. The README carries a one-line summary of each of these, and the
About box carries a shorter table again; all three change together.

## Workspace browser

The left panel shows a workspace as a tree. Open a folder from your machine, expand folders in place,
and click a file to open it in the editor. A filter box narrows the files by name.

Every folder is listed, but only the files of a type you have turned on (see **File types**), and
hidden entries such as `.git` are left out - they are not what this panel is for. The footer names
which types are on and counts the files currently on screen rather than the whole tree: a recursive
count is not free, and measured on a home directory it took 40 seconds across 113,000 folders.

If a folder cannot be read, that folder says so on its own row and offers to try again. The rest of
the tree keeps working, because one unreadable folder is a fact about that folder rather than about
your workspace. OneDrive, Google Drive, Dropbox and GitHub arrive behind the same
interface, in that order.

Saving is deliberate: press Ctrl+S (Cmd+S on macOS), and an asterisk beside the file name shows when
there is something unsaved. If the file changed on disk since you opened it - another program, or
another window - the save is **refused** rather than applied, and your edits stay exactly where they
are. Trypthos will not decide for you which version wins.

Local and cloud look like one tree to you, but they behave differently underneath: cloud listings are
paged, slow, and can fail part-way through. Trypthos shows that on the node it affects rather than
blanking the whole panel, so a directory that is still loading, or that failed, says so in place.

## File types

Trypthos opens markdown, and the **File types** page of Settings decides what else it opens. Markdown
is always on and cannot be turned off - it is what the app is - and every other type is off until you
turn it on:

| Group | Types |
| --- | --- |
| Documents | Markdown (always on), Plain text |
| Markup and data | JSON, YAML, TOML, INI and properties, XML and SVG, HTML, CSS and preprocessors |
| Programming languages | JavaScript and TypeScript, Python, Shell, PowerShell, SQL, Rust, Go, C and C++, C#, Java and Kotlin, PHP, Ruby |
| Utility | Diff and patch, Dockerfile, Makefile, LaTeX, R, Lua, Perl, Swift, Scala, Dart |

Some rows carry more than one language, where the difference is not one you would want to tick a box
about. **JavaScript and TypeScript** is one choice covering `.js`, `.ts`, `.jsx` and `.tsx`;
**CSS and preprocessors** covers SCSS, Sass and LESS; **Java and Kotlin** and **C and C++** each
cover both. Trypthos works out which from the file's name.

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

**Preview does not colour code blocks yet**, only Source and Live. Preview renders through a
different path from the editor, and reaching it is outstanding work rather than a decision.

A type that is off is not merely uncoloured, it is absent. Its files do not appear in the folder
browser, cannot be opened by clicking a link to one, and are not among the files chat is offered or
allowed to read. Turning a type on is therefore a decision about what you want to see: point Trypthos
at a folder full of that type and the list on the left gets a great deal longer.

The footer under the folder browser says which types are on - the type's name when there is one, a
count when there are more - and clicking it goes straight to the page that changes them.

Your choice is remembered between launches, and upgrading never turns anything on for you: a
Trypthos that has been showing you markdown alone carries on doing exactly that until you say
otherwise.

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

- **File** opens a folder, saves the current file, closes the window and quits.
- **Edit** carries undo, redo, cut, copy, paste and select all.
- **Tools** carries Settings. On macOS this lives in the application menu instead, which is where
  that platform expects it.
- **Help** carries the Markdown Syntax Guide, Check for Updates and About.

Nothing on a menu is a separate implementation: each item drives the same thing its button or
shortcut does, so they cannot drift apart.

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

**Folder** sends the *list* of markdown files at the top level of your workspace - the names, never
the contents. A notes folder can hold a great many files; sending them all would bury the document
your question was actually about, and on a hosted endpoint it would cost real money.

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
