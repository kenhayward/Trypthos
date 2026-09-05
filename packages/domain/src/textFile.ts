/// Whether a file's bytes are text this app can edit, and how to get them back unchanged.
///
/// Trypthos decides what it can open by looking at a name. That is a claim about a file, not a fact
/// about it: a PNG renamed `notes.md` satisfies it perfectly. Reading such a file as UTF-8 turns
/// every byte it cannot represent into U+FFFD, and the next save writes those replacement characters
/// over the original - so the guess is not merely wrong, it is destructive.
///
/// **A file this module cannot represent exactly is a file the app must refuse**, because the only
/// alternative on offer is a lossy copy sitting in an editor with a working Save button.
///
/// Pure, and in the domain, so the shell enforces the same limits the renderer explains. Uint8Array
/// rather than Buffer: this package knows nothing of node, and Buffer is a Uint8Array anyway.

/// The largest file the app will open.
///
/// A cap rather than best effort. The whole file becomes a JavaScript string, crosses IPC, and is
/// handed to CodeMirror - so a file large enough is not slow, it is a window that stops responding
/// and a renderer that can run out of memory. 16 MB is far beyond any document and far below that.
export const MAX_TEXT_FILE_BYTES = 16 * 1024 * 1024;

/// How much of a file is examined for binary content.
///
/// The leading bytes, not the whole file: a NUL this far in says what the file is, and the check
/// runs on every open. A binary whose first 8 KB is clean and which is also valid UTF-8 throughout
/// will be opened, which is the accepted floor - the encoding check below catches the rest.
export const BINARY_SNIFF_BYTES = 8 * 1024;

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/// Why a file was refused. Both are about its CONTENT, which is why neither is a `ProviderError`:
/// a provider handed the bytes over perfectly well.
export type TextRefusal = "not-text" | "unsupported-encoding";

export type DecodedText =
  | { ok: true; content: string; bom: boolean }
  | { ok: false; reason: TextRefusal };

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= UTF8_BOM.length && UTF8_BOM.every((byte, index) => bytes[index] === byte)
  );
}

function hasUtf16Bom(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  const [first, second] = [bytes[0], bytes[1]];
  return (first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff);
}

/// A file's bytes as text, or the reason it cannot be one.
///
/// The order of the three checks is load-bearing:
///
///  1. **UTF-16 first.** Its ASCII is every other byte NUL, so the binary sniff below would answer
///     "not text" about a file that is plainly text - and UTF-16 is what Windows PowerShell writes
///     by default, so `.log` meets this immediately. Only a marked file is caught; unmarked UTF-16
///     is indistinguishable from binary here and falls to the sniff, which is the honest answer.
///  2. **Then the NUL sniff.** NUL is legal UTF-8, so a binary file can decode cleanly and still be
///     nothing a person wants in an editor.
///  3. **Then a strict decode.** `fatal` is the point: without it, invalid bytes become U+FFFD and
///     the corruption is invisible until the file is saved.
export function decodeTextFile(bytes: Uint8Array): DecodedText {
  if (hasUtf16Bom(bytes)) return { ok: false, reason: "unsupported-encoding" };

  const window = bytes.subarray(0, BINARY_SNIFF_BYTES);
  if (window.includes(0)) return { ok: false, reason: "not-text" };

  const bom = hasUtf8Bom(bytes);
  const body = bom ? bytes.subarray(UTF8_BOM.length) : bytes;

  try {
    // `ignoreBOM` is true because the mark has already been removed above. Left false, the decoder
    // would strip a mark of its own accord, and this module would no longer be the one place that
    // decides what happened to it.
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    return { ok: true, content, bom };
  } catch {
    return { ok: false, reason: "unsupported-encoding" };
  }
}

/// Text back to bytes, putting back the mark the editor never showed.
///
/// The caller says whether there was one, and the caller that knows is the shell reading the file
/// already on disk - never the renderer, which is untrusted and has no business asserting a file's
/// encoding.
export function encodeTextFile(content: string, { bom }: { bom: boolean }): Uint8Array {
  const body = new TextEncoder().encode(content);
  if (!bom) return body;

  const out = new Uint8Array(UTF8_BOM.length + body.length);
  out.set(UTF8_BOM, 0);
  out.set(body, UTF8_BOM.length);
  return out;
}

const UNITS = ["bytes", "KB", "MB", "GB"] as const;

/// A size a person reads once, in a refusal.
///
/// Unit symbols rather than words, and therefore not translated - "MB" is "MB" in every catalogue
/// this app is likely to carry, and the alternative is a key per unit for no gain. One decimal, with
/// no trailing ".0", because the number is context for a refusal rather than a measurement.
export function formatBytes(bytes: number): string {
  if (bytes === 1) return "1 byte";

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}
