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

## AI chat

The right panel answers questions about the open document, your selection, and the wider folder.

You configure the endpoint, model and parameters yourself, as a list of named profiles you choose
between per message. Requests go directly from Trypthos to the endpoint you named; no Trypthos
server is involved, because there is not one. API keys are held in your operating system's
credential store and are never written into settings files.

Chats are saved on your machine. A chat references the file and workspace it was about rather than
being stored beside them, so it will tell you when that file has since been renamed, moved or
deleted.

## Appearance

Trypthos follows your system's light or dark setting and switches with it while the app is open.

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

Closing the window quits the app. Closing to the tray will be an option once there is somewhere to set
preferences.

## Local by default

No account, no sign-in, no telemetry, no server. Everything Trypthos stores - settings, chats - is a
plain file on your machine.
