import { type FileTypeId } from "./fileTypes";

/// Images - the first thing this app opens that it does not edit.
///
/// Everything else in the catalogue is text on its way into CodeMirror. An image is looked at, and
/// that difference reaches further than it sounds: the read boundary refuses anything binary, which
/// is exactly right for a document and exactly wrong for a picture, so an image takes a different
/// route out of the shell entirely.

export const IMAGE_TYPE_ID: FileTypeId = "image";

/// The largest image this app will draw, in bytes.
///
/// Its own limit rather than the text one, for its own reason: an image crosses IPC as a data URL,
/// which is a third larger than the file, and arrives as a single string. Sixteen megabytes covers
/// anything a camera or a screenshot produces; past that the cost is paid in one lump by a window
/// that has to stay responsive.
export const MAX_IMAGE_FILE_BYTES = 16 * 1024 * 1024;

/// What a data URL tells the window to do with the bytes that follow.
///
/// **Decided from the name, in the main process, and never taken from anywhere else.** A media type
/// is an instruction to the browser about how to interpret bytes; accepting one from an untrusted
/// side would be letting that side say what a file is.
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/// The media type for a file name, or null when it is not an image this app draws.
///
/// Null rather than a guess or a default: a data URL that says the wrong thing about its bytes is a
/// data URL telling the browser to treat one kind of file as another.
export function imageMediaType(name: string): string | null {
  return MEDIA_TYPES[extensionOf(name)] ?? null;
}

export function isImageName(name: string): boolean {
  return imageMediaType(name) !== null;
}
