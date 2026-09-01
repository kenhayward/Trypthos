# Features

The canonical full feature list. The README carries a one-line summary of each of these, and the
About box carries a shorter table again; all three change together.

## Workspace browser

The left panel shows a workspace as a single tree. Local folders work today; OneDrive, Google Drive,
Dropbox and GitHub arrive behind the same interface, in that order.

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

  Headings, bold, italic, inline code, links and quotes render in place. Tables, images, footnotes
  and fenced code blocks still show as source for now - a construct without a decoration renders as
  itself rather than disappearing, so nothing is ever hidden that Trypthos cannot draw.

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

## Local by default

No account, no sign-in, no telemetry, no server. Everything Trypthos stores - settings, chats - is a
plain file on your machine.
