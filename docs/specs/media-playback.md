# Spec: playing video and audio

**Status: specified, not built.** Nothing here describes code that exists today. It is the design
the work is measured against, written before the first line of it.

Trypthos opens markdown, source files, and pictures. This adds the other thing that sits in a notes
folder and is looked at rather than read: **video and audio**, played in the centre panel with
transport controls and a fullscreen option.

## The decision that shapes everything else

A picture crosses IPC as a base64 data URL capped at 16 MB (`imageFiles.ts`), and that is fine
because a screenshot is a few hundred kilobytes. **A video cannot travel that way.** A one-minute
phone clip is around 100 MB, its data URL is a third larger again, and it would arrive as a single
string handed to a window that has to stay responsive. Worse, it would not scrub: seeking in a media
element is byte ranges, and a data URL has none.

So this feature is not "another `ImageViewer`". It adds **a second route out of the main process** -
a streaming protocol - and that is why it needs a spec rather than a pull request.

Everything below follows from that one fact.

## What will actually play, measured rather than assumed

The format list is not a matter of taste. It is whatever the bundled Chromium can decode, and the
usual published tables are out of date. Electron 44.1.0 (Chromium 152) was asked directly, with
`canPlayType` over explicit container and codec strings:

| Probe | Answer |
| --- | --- |
| `video/mp4; codecs="avc1.42E01E, mp4a.40.2"` | probably |
| `video/mp4; codecs="hvc1.1.6.L93.B0"` (HEVC) | probably |
| `video/mp4; codecs="hvc1.2.4.L120.B0"` (HEVC main10) | probably |
| `video/mp4; codecs="av01.0.04M.08"` | probably |
| `video/mp4; codecs="vp9"` | **no** |
| `video/mp4; codecs="avc1.42E01E, ac-3"` | **no** |
| `video/webm; codecs="vp8, vorbis"` | probably |
| `video/webm; codecs="vp9, opus"` | probably |
| `video/webm; codecs="av01.0.04M.08"` | probably |
| `video/x-matroska; codecs="avc1.42E01E"` | probably |
| `video/x-matroska; codecs="av01.0.04M.08, opus"` | probably |
| `video/x-matroska; codecs="vp9"` | **no** |
| `video/3gpp; codecs="avc1.42E01E, mp4a.40.2"` | probably |
| `video/quicktime; codecs="avc1.42E01E, mp4a.40.2"` | **no** |
| `video/ogg; codecs="theora"` | **no** |
| `video/x-msvideo`, `video/x-ms-wmv`, `video/mpeg`, `video/x-flv` | **no** |
| `audio/mpeg`, `audio/mp4; codecs="mp4a.40.2"`, `audio/aac` | probably |
| `audio/wav; codecs="1"`, `audio/flac` | probably |
| `audio/ogg; codecs="vorbis"`, `audio/ogg; codecs="opus"`, `audio/webm; codecs="opus"` | probably |
| `audio/x-flac` | **no** |
| `audio/aiff`, `audio/x-ms-wma` | **no** |

Three of those answers would have been got wrong from memory, and each changes the design:

- **Theora is gone.** Chromium removed it in 2024, so there is no `.ogv` row. A row for it would
  open a file and then fail to play it, which is worse than not listing it.
- **`video/quicktime` is refused outright**, even with an explicit H.264 codec string.
- **HEVC answers "probably"**, including main10 - so an iPhone recording plays.

### The rows

| Extension | Declared media type |
| --- | --- |
| `mp4`, `m4v` | `video/mp4` |
| `mov` | `video/mp4` - see below |
| `webm` | `video/webm` |
| `mkv` | `video/x-matroska` |
| `3gp` | `video/3gpp` |
| `mp3` | `audio/mpeg` |
| `m4a` | `audio/mp4` |
| `aac` | `audio/aac` |
| `wav` | `audio/wav` |
| `flac` | `audio/flac` - **not** `audio/x-flac`, which is refused |
| `ogg`, `oga`, `opus` | `audio/ogg` |
| `weba` | `audio/webm` |

Deliberately absent: `ogv`, `avi`, `wmv`, `mpg`, `mpeg`, `flv`, `wma`, `aiff`. The engine has no
demuxer for any of them.

`ogg` is treated as audio. The extension can carry video, but in a notes folder it essentially never
does, and one extension gets one owner - the same rule that put `svg` with XML rather than with
images.

### `.mov` is declared as `video/mp4`, on purpose

`video/quicktime` is refused, so a `.mov` served under its own name would never play - and `.mov` is
what every iPhone produces. MOV and MP4 are both ISO base media format and Chromium's MP4 demuxer
reads both, so declaring `video/mp4` works.

This is a conscious exception to the rule written in `imageFiles.ts`, that a media type is decided
from the name and never guessed. The rule's purpose is to stop one kind of file being treated as
another kind; here the two containers genuinely are the same format wearing two names. **It is
recorded as a test**, in the extension map, so the exception is visible at the point it is enforced
rather than remembered.

### `.mkv` is included knowing it will sometimes fail

H.264 and AV1+Opus play; VP9 does not, and neither does AC-3 audio. A Matroska file is a grab bag,
so some will open and then report that they cannot be decoded. That is acceptable **only because the
error path is a real part of this design** (below) rather than a black rectangle. The alternative -
omitting `.mkv` - fails the common H.264 case to avoid admitting the uncommon one.

## The transport

A privileged scheme, `tp-media://`, registered before app-ready and handled with `protocol.handle`.

```js
protocol.registerSchemesAsPrivileged([
  {
    scheme: "tp-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: false,
    },
  },
]);
```

Two of those are load-bearing, for different reasons.

`stream: true` is what lets a media element issue `Range` requests against the scheme and receive a
partial response, which is what seeking is.

`standard: true` is what lets it load at all. **Added after the fact, and worth recording why:**
without it Chromium treats the scheme's URLs as opaque and a media element refuses to load one -
while `fetch` to the very same URL succeeds and returns the right bytes, because the two take
different code paths. Every assertion about the handler passed without it. It was found only by
playing a file in the real app, which is the clearest argument this spec makes for that last
verification step existing at all.

**The handler does four things, in this order:**

1. Decode the qualified workspace path out of the URL.
2. Resolve it through **the same locator every IPC handler uses**, so naming a workspace adds a
   folder to a path and never permission to leave one.
3. Decide the media type **from the name, in the main process**, exactly as `file:readImage` does.
   A name no row claims is refused rather than guessed at.
4. Parse `Range`, and answer 200 with the whole body or 206 with `Content-Range` and a bounded
   stream. A range that starts past the end answers 416.

### There is no size limit, and that is the point

The 16 MB image cap exists because a data URL arrives in one lump. A streamed range response does
not, so memory stays flat whether the file is 4 MB or 4 GB. Adding a cap here would be copying a
constraint from a mechanism this one exists to avoid.

### There are no new IPC channels

The URL is derivable from the qualified path alone, so the renderer builds it and reads nothing over
IPC. The entire new surface is the protocol handler. That is worth saying out loud, because it means
the thing to review in this feature is one file.

### On authority

The URL is guessable. It does not need a token, because what it can reach is **exactly what
`file:read` already grants the renderer**: a file inside a workspace the user currently has open.
A token would imply a stronger guarantee than the app makes anywhere else, and an unenforced
guarantee is worse than an honest absence. Parity with the existing IPC surface is the bar, and the
boundary check is the control.

There is no Content-Security-Policy in the app today, so there is no `media-src` to extend.
`bypassCSP` is nevertheless set to `false`, so that adding a CSP later is a policy change and not a
silent hole.

### One shared registry, extracted

`locateQualified` and the `open` workspace map are module-level in `ipcHandlers.js`. The protocol
handler needs both, and CLAUDE.md is explicit that the boundary check belongs in **one** shared
module rather than being re-implemented per caller. So they move to `openWorkspaces.js` and both
sides import it.

This is the one piece of existing code this feature reshapes, and it is reshaped because the
feature's main risk is a second path to the filesystem that checks the boundary slightly
differently.

## The surface

One new component, `MediaPlayer.tsx`, for both kinds. `ImageViewer.tsx` is untouched.

- **Video**: `<video controls>` filling the panel, `object-contain`, on the sunken background.
- **Audio**: a centred `<audio controls>` beneath the file's name, because an audio file has no
  picture to fill a panel with.
- **No zoom and no pan**, deliberately unlike the image viewer. A screenshot shrunk to a side panel
  is unreadable, which is the whole reason a picture pans. A video is watched at the panel's size,
  and the way to make it bigger is fullscreen.
- **Controls are Chromium's own**: play/pause, a scrub bar, elapsed and total, volume, playback
  speed, Picture-in-Picture, and fullscreen. Keyboard accessible, and labelled by the engine in the
  user's language, for no code of ours. A hand-built bar would mean rewriting all of that
  accessibility to gain colour tokens.
- **Fullscreen** is the native button, which calls the Fullscreen API on the element. This must be
  verified against the frameless window rather than assumed: HTML fullscreen inside a frameless
  `BrowserWindow` is exactly the sort of thing that works everywhere except here.
- `preload="metadata"`: opening a tab fetches the duration and a first frame, not the file.
- **No autoplay.** Opening a file must not start making noise.
- `key={activePath}` on the player. Without it React reuses one `<video>` node across two video
  tabs, and the previous file's playback state leaks into the next one.
- The status bar stays hidden, as it is for pictures. A word count and a caret position are
  questions about text.

### The error line is part of the feature

`onError` reads `MediaError.code`. `MEDIA_ERR_SRC_NOT_SUPPORTED` and `MEDIA_ERR_DECODE` are precisely
the VP9-in-Matroska and AC-3 cases this spec knowingly admits, so the panel says plainly that the
file was found but this computer cannot decode its video or audio coding. A bare `<video>` shows a
black rectangle and explains nothing, which would make the `.mkv` decision indefensible.

`MEDIA_ERR_NETWORK` and `MEDIA_ERR_ABORTED` report as a file that could not be read - the same
language a failed document read already uses.

### What this version does not do

Playback stops when you switch tabs. Remembering a position per tab is state that has to survive a
reopen and belongs to its own decision, not to this one.

## Reach into the rest of the app

| Where | What |
| --- | --- |
| `packages/domain/src/mediaFiles.ts` | **new** - the extension map, `mediaKindFor`, `mediaTypeFor`. Mirrors `imageFiles.ts` in shape and in reasoning. |
| `packages/domain/src/fileTypes.ts` | two rows, `video` and `audio`; `FileTypeKind` gains both; the `images` group becomes `media`, holding Images, Video and Audio |
| `packages/domain/src/settings.ts` | migration to version 22 (below) |
| `apps/desktop/src/openWorkspaces.js` | **new** - the registry and locator, extracted from `ipcHandlers.js` |
| `apps/desktop/src/mediaProtocol.js` | **new** - the handler |
| `apps/desktop/src/mediaRange.js` | **new**, pure - a `Range` header to an offset and a length |
| `apps/desktop/src/main.js` | register the privileged scheme before app-ready |
| `apps/app/src/components/MediaPlayer.tsx` | **new** |
| `apps/app/src/components/EditorPanel.tsx` | `media` becomes `{ source, kind }`; picks viewer or player |
| `apps/app/src/hooks/useWorkspace.ts` | `openPath` builds the URL for video and audio, reading nothing |
| `packages/domain/src/openDocuments.ts` | `media` widens from `string \| null` to `{ source: string; kind: "image" \| "video" \| "audio" } \| null` |
| `apps/app/src/components/WorkspacePanel.tsx` | "Add to chat" excluded for any media, not only pictures |
| `apps/app/src/locales/en.json` | two labels, the group label, the error lines, accessible names |

**Chat needs no change.** `scopeSource` in `App.tsx` already treats any document whose `media` is set
as nothing open, with the reasoning written for pictures and true unchanged for a video.

**The operating system integration does not widen.** `launchTarget.js` and `explorerIntegration.js`
stay as they are, for the reason `file-types.md` already gives: registering an Explorer verb on
`.mp4` would make a markdown editor claim a video file for the whole machine.

### The settings migration, and why it departs from the written rule

`file-types.md` says there is deliberately no migration when types are added: a fresh install enables
everything, an upgrade keeps the list it stored. Applied here, every existing installation would ship
this feature switched off, with nothing in the interface to suggest it exists.

The rule's reasoning is that an upgrade must not change what somebody's folder browser shows without
being asked. That reasoning protects **a choice the user made**. Nobody chose to exclude video,
because there was no video row to leave unticked - the absence is an artefact of when they installed,
not a preference.

So settings migrate to version 22 by appending `video` and `audio` to the stored list, and the
release notes say so in as many words, naming the File types page for anyone who wants a folder of
recordings kept out of their tree. The migration appends and touches nothing else, per the rule each
migration already follows.

## How it is proved

Test-first throughout, each test red before the code that answers it.

**Domain (`vitest`)**
- Every extension maps to the declared type in the table above; an unknown name answers null.
- `.mov` resolves to `video/mp4`, written as its own test so the exception is recorded where it is
  enforced.
- `.flac` resolves to `audio/flac`, never `audio/x-flac`.
- `mediaKindFor` separates video from audio, and answers null for a picture and for a document.
- The settings migration to 22 appends both ids and preserves every other stored field, including a
  list that already contains them.

**Shell (`node --test`)**
- `mediaRange.js`: `bytes=0-`, `bytes=100-199`, a suffix range, a range ending past the file, a range
  starting past the file (416), a malformed header, and multiple ranges (refused - one range is all a
  media element asks for).
- The protocol handler refuses, each as its own test: `..` in the path, a UNC path, a Windows
  drive-relative path, a workspace id that is not open, and a name no media row claims.
- A valid request answers 206 with the right `Content-Range` and `Content-Length`.

**Renderer (`vitest`, jsdom)**
- `<video>` for a video and `<audio>` for audio.
- The error line for each `MediaError` code.
- `EditorPanel` draws the player rather than the image viewer for a video document, and draws no
  mode header and no status bar for either.

**Renderer (`test:browser`)**
- The rendered element carries `controls` and `preload="metadata"`, carries no `autoplay`, and has
  the expected `src`.

**Driving the real Electron app**, which is the only place the transport can be proved:
- A real clip in an invented folder plays, scrubs to the middle, and goes fullscreen and back.
- The fixture is generated with Chromium's own `MediaRecorder` from a canvas inside Electron, so a
  genuine decodable WebM exists without adding a dependency and without any real file of the user's
  entering the repository.
- **Stated limit**: MP4, MOV, MKV and 3GP rest on the codec probe above plus the error path, not on a
  real decode on this machine.

## Release

A functional enhancement, so **0.87.0**, with the full checklist: `version.json` and all mirrors, one
`RECENT[0]` entry, the About-box capability row, the README Features row, the `docs/features.md`
bullet, and `docs/Architecture.md` - that last one is genuinely required here, because this adds a
cross-process transport and a new external surface.

**Deployment surface: needs a release.** This is new behaviour in the shipped editor.
