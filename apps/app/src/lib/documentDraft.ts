import { TakeDraftResponse, type DocumentDraft } from "@trypthos/domain";

/// The unsaved text a document window was opened with, from the shell's answer - or null.
///
/// Checked with the contract's schema rather than trusted: it crossed the IPC boundary. Anything
/// but a well-formed draft means the window opens its file from disk, which is exactly what a
/// window opened from the file tree does - so a missing or garbled answer degrades to the ordinary
/// case rather than to an error.
export function draftFrom(response: unknown): DocumentDraft | null {
  const parsed = TakeDraftResponse.safeParse(response);
  return parsed.success ? parsed.data.draft : null;
}
