# Features

The canonical full feature list. The README carries a one-line summary of each of these, and the
About box carries a shorter table again; all three change together.

## Workspace browser

The left panel shows a workspace as a tree. Open a folder from your machine, expand folders in place,
and click a file to open it in the editor. A filter box narrows the markdown files by name.

Every folder is listed but only markdown files within them, and hidden entries such as `.git` are left
out - they are not what this panel is for. The footer counts the markdown files currently on screen
rather than the whole tree: a recursive count is not free, and measured on a home directory it took
40 seconds across 113,000 folders.

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

## Markdown editor

The centre panel edits markdown in one of three views over the same document:

- **Source** shows every character, colour-coded by role: markers stay dim, while headings,
  emphasis, code and links stand out. Nothing is resized or bolded, so what you read is exactly what
  is stored. Line numbers, undo and redo work as you would expect.
- **Preview** is read-only rendered prose. No caret, no gutter - it stops being an editing surface.
- **Live** hides syntax markers until your cursor reaches a line, which then shows its own
  scaffolding. Reads like a document, edits like text. This is the default view.

  Headings, bold, italic, inline code, links, quotes and list bullets render in place, and the line
  you are editing is tinted. Tables, images, footnotes and fenced code blocks still show as source
  for now - a construct without a decoration renders as
  itself rather than disappearing, so nothing is ever hidden that Trypthos cannot draw.

The header above the editor shows where the document lives, marks it when there is something unsaved,
and reports your cursor position and word count. The strip below names the format, the encoding and
the line endings the file actually uses - measured rather than assumed, so a file that mixes Windows
and Unix line endings is reported as mixed rather than as one or the other.

Switching view never rewrites your file. The bytes on disk are identical in every view, so a
document can be shared between someone who wants to read it and someone who cares about its exact
text, without either being surprised by what the other did to it.

Preview renders whatever the file contains, and a markdown file is untrusted input like any other,
so the rendered HTML is sanitised before it is shown.

## Menus and the right-click menu

The window draws its own title bar, so on Windows the File, Edit, Tools and Help labels sit in that
bar. They open real native menus: native rendering, the platform's own accelerator text, and the
platform's own cut, copy and paste. On macOS the same commands appear where they belong, in the
system menu bar at the top of the screen, and the window draws no menu labels of its own.

- **File** opens a folder, saves the current file, closes the window and quits.
- **Edit** carries undo, redo, cut, copy, paste and select all.
- **Tools** carries Settings. On macOS this lives in the application menu instead, which is where
  that platform expects it.
- **Help** carries About and Check for Updates.

Nothing on a menu is a separate implementation: each item drives the same thing its button or
shortcut does, so they cannot drift apart.

Right-clicking text opens a menu suited to what you clicked. In an editable field that is cut, copy,
paste and select all, with anything you cannot currently do greyed out rather than offered. Over a
misspelled word it also lists corrections, and offers to add the word to your dictionary - the
spelling suggestions have no other route into the app. Right-clicking ordinary text with a selection
offers to copy it; right-clicking with nothing to offer opens nothing at all, rather than a menu of
dead items.

## AI chat

The right panel answers questions about the open document, your selection, and the wider folder.

You configure the endpoint, model and parameters yourself, as a list of named models you choose
between per message. Preferences has a Chat models section for this: each entry carries a name you
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

Preferences carries one system prompt, sent ahead of every conversation. It ships with a default
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

Tick **This endpoint supports tool calling** on the model in Preferences. Measured against one local
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

**Folder** sends the *list* of markdown files in your workspace - the paths, never the contents. A
notes folder can be thousands of files; sending them would bury the document your question was
actually about, and on a hosted endpoint it would cost real money. The list is enough for the model
to say "that will be in notes/plan.md", and you can then attach it. Hidden folders, and the ones
nobody means by their notes - `node_modules`, `dist`, `.git` - are skipped, and a very large folder is
listed up to a limit and says it stopped.

**Your document keeps its place.** Everything shares one budget, and the file you are editing is
served first: an attachment that would push it out is shortened instead, and one there was no room
for at all is still named, so the model knows it exists and did not see it.

Starting a new conversation clears its attachments rather than carrying them into the next one.

Chats are saved on your machine. A chat references the file and workspace it was about rather than
being stored beside them, so it will tell you when that file has since been renamed, moved or
deleted.

## Appearance

Choose Light, Dark, or follow your system, from Preferences - the cog in the title bar. Following the
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

On macOS, Trypthos cannot install its own updates yet - that needs a signed build - so it offers to
open the releases page instead of failing part-way through.

Closing the window quits the app, unless you turn on **Keep running when the window is closed** in
Preferences - then it hides to the notification area and you quit it from the tray icon.

## Local by default

No account, no sign-in, no telemetry, no server. Everything Trypthos stores - settings, chats - is a
plain file on your machine.
