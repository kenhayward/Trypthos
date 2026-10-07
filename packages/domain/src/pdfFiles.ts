import { type FileTypeId } from "./fileTypes";

/// PDFs - looked at, never edited, and the one kind of file this app cannot draw without help.
///
/// A picture is drawn by the window and needs no rules of its own beyond the name; a PDF is drawn
/// by an engine that has to be brought in, so the app's reach is decided here and the engine's
/// version is recorded in the PR that ships it. The route out of the shell is the recording's, not
/// the picture's: the bytes are streamed over the media protocol rather than crossing IPC as a data
/// URL, because a document of this kind is far too large for one string and a viewer wants ranges.
///
/// One extension, and one only: the catalogue gives an extension one owner, and `.pdf` has never had
/// another. What the engine can open inside a PDF - fonts, encryption, forms - is its question, not
/// this table's.

export const PDF_TYPE_ID: FileTypeId = "pdf";

/// What the main process tells the window the bytes are, or null when nothing here claims the name.
///
/// **Decided from the name, in the main process, and never taken from anywhere else.** A media type
/// is an instruction to the browser about how to interpret bytes; accepting one from an untrusted
/// side would be letting that side say what a file is.
const PDF_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
};

function extensionOf(name: string): string {
  // `dot <= 0` rather than `=== -1`: a leading dot is a hidden file, not a name that is all
  // extension.
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/// The media type for a file name, or null when it is not a PDF this app views.
///
/// Null rather than a guess or a default: a declared type is an instruction about how to interpret
/// bytes, and the wrong one tells the engine to read one kind of file as another.
export function pdfMediaTypeFor(name: string): string | null {
  return PDF_TYPES[extensionOf(name)] ?? null;
}

export function isPdfName(name: string): boolean {
  return pdfMediaTypeFor(name) !== null;
}
