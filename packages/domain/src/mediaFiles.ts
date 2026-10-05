import { type FileTypeId } from "./fileTypes";

/// Video and audio - looked at and listened to, never edited.
///
/// The same shape as `imageFiles.ts` and for the same reason: the read boundary refuses anything
/// binary, which is right for a document and wrong for a recording. What differs is the route out
/// of the shell. A picture crosses IPC as a data URL; a clip is far too large for that, and a data
/// URL cannot be seeked because seeking is byte ranges. So media travels over its own streaming
/// protocol, and this module owns both halves of its URL so the two processes cannot disagree.
///
/// **The format list is measured, not assumed.** Every type below answered "probably" to
/// `canPlayType` in Electron 44.1.0 (Chromium 152); every common format that is absent answered
/// "no" and would have opened a file this app then could not play.

export const VIDEO_TYPE_ID: FileTypeId = "video";
export const AUDIO_TYPE_ID: FileTypeId = "audio";

export type MediaKind = "video" | "audio";

/// `mov` is declared as `video/mp4` deliberately.
///
/// `video/quicktime` is refused by the engine even with an explicit H.264 codec string, and MOV is
/// an ISO base media file exactly as MP4 is - the same demuxer reads both. Leaving it out would
/// leave out every video an iPhone records.
const VIDEO_TYPES: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm",
  // Partially supported, and included knowingly: H.264 and AV1 play, VP9 and AC-3 do not. The
  // player says so plainly rather than showing a black rectangle, which is what makes this
  // defensible - omitting the row would fail the common case to avoid admitting the uncommon one.
  mkv: "video/x-matroska",
  "3gp": "video/3gpp",
};

/// `flac` is `audio/flac`. `audio/x-flac` is refused, and the two differ by one prefix.
const AUDIO_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  // `.ogg` can carry video, but in a folder of notes it essentially never does, and one extension
  // gets one owner - the rule that put `.svg` with XML rather than with pictures.
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  weba: "audio/webm",
};

function extensionOf(name: string): string {
  // `dot <= 0` rather than `=== -1`: a leading dot is a hidden file, not a name that is all
  // extension.
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function mediaKindFor(name: string): MediaKind | null {
  const extension = extensionOf(name);
  if (extension in VIDEO_TYPES) return "video";
  if (extension in AUDIO_TYPES) return "audio";
  return null;
}

/// What the main process tells the window the bytes are, or null when nothing here claims the name.
///
/// Null rather than a default: a declared type is an instruction about how to interpret bytes, and
/// the wrong one tells the engine to read one kind of file as another.
export function mediaTypeFor(name: string): string | null {
  const extension = extensionOf(name);
  return VIDEO_TYPES[extension] ?? AUDIO_TYPES[extension] ?? null;
}

export function isMediaName(name: string): boolean {
  return mediaKindFor(name) !== null;
}

/// The scheme the main process serves media on.
///
/// Its own scheme rather than `file:`, which the renderer cannot reach and should not: `file:` would
/// be the whole disk, and this is one open workspace.
export const MEDIA_SCHEME = "tp-media";

/// Where the window fetches a file from, given its qualified workspace path.
///
/// A FIXED host, with the whole qualified path as a single encoded segment. A hostname is lowercased
/// and character-restricted by the URL parser, and a workspace id is a folder's name - so putting
/// the id in the host would quietly mangle it. One encoded segment also means a slash inside the
/// path cannot become a path separator in the URL, and a `#` or `?` in a filename cannot be read as
/// a fragment or a query. That is the shape of mistake that turns a boundary check into a formality.
export function mediaUrl(qualifiedPath: string): string {
  return `${MEDIA_SCHEME}://workspace/${encodeURIComponent(qualifiedPath)}`;
}

/// The qualified path a URL names, or null when it is not one of ours.
///
/// Total: a malformed URL, a foreign scheme, a wrong host, an empty path or broken percent-encoding
/// all answer null rather than throwing. This runs in the main process on a string the renderer
/// chose, so it is parsing untrusted input and must not have an exceptional path at all.
export function mediaPathFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null;
  if (parsed.hostname !== "workspace") return null;

  // One segment. `pathname` always starts with a slash, and anything after the first segment means
  // the URL was built some other way than by `mediaUrl` - which is not a thing to go along with.
  const segments = parsed.pathname.slice(1).split("/");
  const only = segments.length === 1 ? segments[0] : undefined;
  if (only === undefined || only === "") return null;

  try {
    const decoded = decodeURIComponent(only);
    return decoded === "" ? null : decoded;
  } catch {
    return null;
  }
}
