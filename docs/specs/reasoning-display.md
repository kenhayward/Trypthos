# Spec: showing what the model thought

**Status: specified, not built.** Nothing here describes code that exists today, except where it says
what already does.

Trypthos can ask a model to reason before answering (0.41.0, the Thinking switch). What it cannot do
is show that reasoning back, except in one narrow case. This specifies showing it for every reply
that has any - **collapsed by default, expandable when the reader is interested**.

## What already works, and what does not

More of this exists than one would guess, which changes the shape of the work: the wire is done and
the display is not.

| Already built | Where |
| --- | --- |
| Both wire spellings parsed - `delta.reasoning` and `delta.reasoning_content` | `chatCompletion.ts`, `ChunkSchema` |
| A `{ type: "reasoning" }` stream event | `chatCompletion.ts`, `StreamEvent` |
| That event carried across IPC, schema-checked | `ipc.ts`, `ChatEventSchema` |
| Accumulated in the renderer | `useChat`, the `reasoning` state |
| Shown in a `<details>` disclosure, with `chat.showThinking` | `ChatPanel` |

So the gap is narrow and specific:

- **Reasoning is not attached to a turn.** `useChat` keeps ONE string, for the reply in flight, and
  clears it on the next send.
- **It is shown only when a reply produced no content at all** - which is a real case (measured at
  roughly half of runs against one local model) but is the exception, not the rule. A reply that
  thought and then answered loses its thinking the moment it answers.
- **It is not persisted**, so a saved chat reopens with none of it.
- **There is no sign of it while a reply streams**, which is exactly when a reader most wants to know
  something is happening.

## The decision this turns on: where reasoning lives

`Turn` in `lib/conversation.ts` is a type alias for `ChatTurn`, the **wire format**. The panel's
conversation and the provider's request are the same array of objects. That is why reasoning is kept
outside it today, and it is the decision to make now.

Three ways, and the second is the one to take:

1. **Widen `ChatTurn` with an optional `reasoning`.** Simplest to write, wrong shape: it puts a
   display concern into the type whose whole job is to describe what a provider receives.
2. **Give the panel its own type.** A `Reply` (or `DisplayTurn`) of `{ role, content, reasoning }`,
   with wire turns derived from it where a request is built. The panel's model and the provider's
   model stop being the same object, which they never should have been once one of them grew a field
   the other must not see.
3. **A parallel map keyed by turn index.** No wire risk, but index-keyed state is fragile across
   retry, replace and clear - three operations this panel already has.

**A safety property worth knowing before choosing:** `ChatTurnSchema` is `.strict()`, and both
`SendChatRequest` and `ChatSessionSchema` build on it. An extra field on a turn is therefore already
a **loud parse failure** at the IPC boundary and at save, not a silent leak. Option 2 keeps that
property and makes the conversion explicit; option 1 relies on remembering to strip.

## Rules

### Reasoning is never sent back to the provider

Not in the next turn's messages, not ever. Three reasons, any one sufficient:

- **It is not conversation.** The model's working is not something it said.
- **Cost.** Chain of thought is frequently longer than the answer, and every turn would carry every
  previous one.
- **gpt-oss says so.** The harmony format's guidance is that prior reasoning is dropped between
  turns; feeding it back is not a neutral choice.

Assert it: a test that builds a request from a conversation whose replies carry reasoning, and checks
no message content contains it.

### Reasoning is never parsed for edit blocks

**This is the one that would do damage.** A reply's content goes through the part splitter that turns
` ```trypthos-edit ` blocks into cards with an Apply button. A model reasoning about whether to
propose an edit will write something that looks exactly like one - that is what reasoning IS - and a
reader would be shown an Apply button for a change the model never proposed and may have decided
against.

So reasoning is **plain text**, rendered as text, and never goes near `conversation.ts`'s splitting
or `renderMarkdown`. That also settles a question that would otherwise be open on its own merits:

- Markdown rendering would make half-formed markdown flicker as it streams.
- Reasoning is the model's working, not a document. `<pre>` with wrapping says so.
- It costs nothing to leave the code colouring out of scratch text.

### Everything else

- **Collapsed by default**, per the request, and **per turn**: expanding one reply's thinking says
  nothing about the next. Expansion is view state and is **not persisted** - reopening a chat should
  not reopen six disclosures.
- **Nothing is drawn when there is no reasoning.** An empty disclosure is a control that lies about
  having something behind it.
- **The no-answer case folds into the general one.** `chat.noAnswer` still explains the empty reply;
  the disclosure beside it becomes the same disclosure every other reply has, rather than a special
  one.
- **`<details>`/`<summary>`, not a hand-rolled toggle.** It is what the panel already uses, and it
  brings keyboard behaviour and the expanded/collapsed state to assistive technology for free.
- **Reasoning is data, never instructions** - the same rule as a reply and a workspace file. It is
  model output, and it is displayed, never acted on.
- **Copying an answer must not copy the thinking.** Whatever copy affordance exists takes `content`.
- **The context dial does not count it.** `contextUsage` estimates what is SENT; reasoning is not
  sent, and counting it would make the dial wrong in the direction that matters.

## While it streams

A reply that is thinking looks identical to one that has stalled, which is the thing worth fixing
beyond the disclosure itself.

- Show a **live affordance** on the reply in flight - the existing `activity` line is the precedent,
  and this is the same idea for a different reason to wait.
- Keep it **collapsed** while streaming too. Auto-expanding would move the composer under the
  reader's cursor as the text grew, and the request was for collapsed by default.
- **Do not animate a token count or a timer** unless it is measured rather than estimated. "Thought
  for 4s" is worth having, but only if the duration comes from the stream's own timestamps.

## Persistence

Saved chats keep reasoning, so reopening a conversation shows what it showed. That means:

- `ChatSessionSchema.turns` stops being `array(ChatTurnSchema)`, since that schema is strict and
  describes the wire.
- **`CHAT_SESSION_VERSION` goes to 2**, with the first real entry in `CHAT_SESSION_MIGRATIONS` -
  which has been an empty array since the format was written. A version 1 file loads with no
  reasoning on any turn, which is exactly what it had.
- A **cap** is wanted. Chain of thought can be enormous, chats are plain files in the app-data
  directory, and a conversation whose file is mostly discarded thinking is a poor trade. Cap what is
  persisted per turn, mark it truncated, and say so in the disclosure rather than silently shortening
  it.

The alternative - dropping reasoning on save - is cheaper and worse: a chat that looked one way while
it was open and another when reopened is a chat the user cannot trust as a record.

## What is out of scope

- **Reasoning from inline `<think>` tags.** Some setups stream chain of thought inside the content
  itself rather than a separate field. Detecting it means parsing model output for markers, and a
  false positive eats real answer text. The structured fields are unambiguous; inline tags are a
  guess, and a guess about which half of a reply is the answer is not one to make.
- **Editing, quoting or re-sending reasoning.** It is a record of what happened, not an input.
- **A global "always expand" preference.** Worth revisiting once the disclosure exists and somebody
  has lived with it; a setting added at the same time as the thing it configures is a setting nobody
  has needed yet.

## Tests

- **Domain:** a request built from a conversation carrying reasoning contains none of it. Session
  version 2 round-trips; a version 1 file loads with empty reasoning; the persisted cap truncates and
  says so.
- **Renderer (jsdom):** reasoning attaches to the reply it arrived with, and a second reply does not
  inherit the first's; the disclosure is closed on mount; it is absent entirely when there is no
  reasoning; expanding one reply leaves another closed; reasoning containing ` ```trypthos-edit `
  renders **no** Apply button - the test that matters most here, and one that must be seen to fail.
- **The no-answer path keeps working**, since it is the case that exists today.
