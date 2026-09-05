import { describe, expect, it } from "vitest";
import {
  BINARY_SNIFF_BYTES,
  MAX_TEXT_FILE_BYTES,
  decodeTextFile,
  encodeTextFile,
  formatBytes,
  hasUtf8Bom,
} from "./textFile";

const utf8 = (text: string) => new TextEncoder().encode(text);
const withUtf8Bom = (text: string) => Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(text)]);

describe("decodeTextFile", () => {
  it("decodes ordinary UTF-8", () => {
    const result = decodeTextFile(utf8("# Notes\n"));
    expect(result).toEqual({ ok: true, content: "# Notes\n", bom: false });
  });

  it("decodes an empty file", () => {
    expect(decodeTextFile(new Uint8Array())).toEqual({ ok: true, content: "", bom: false });
  });

  it("decodes text beyond ASCII", () => {
    const result = decodeTextFile(utf8("café — 日本語 \u{1f600}"));
    expect(result).toEqual({
      ok: true,
      content: "café — 日本語 \u{1f600}",
      bom: false,
    });
  });

  // The BOM is reported, not returned in the content. Leaving U+FEFF at offset 0 would put an
  // invisible character in front of the first heading - which stops being a heading - and would
  // shift every caret position the status bar reports by one.
  it("strips a UTF-8 byte order mark and reports that it was there", () => {
    expect(decodeTextFile(withUtf8Bom("# Notes\n"))).toEqual({
      ok: true,
      content: "# Notes\n",
      bom: true,
    });
  });

  it("refuses bytes that are not text", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(decodeTextFile(png)).toEqual({ ok: false, reason: "not-text" });
  });

  it("looks for a NUL only in the leading bytes, not the whole file", () => {
    const bytes = new Uint8Array(BINARY_SNIFF_BYTES + 16).fill(0x61);
    bytes[BINARY_SNIFF_BYTES + 8] = 0x00;
    // Past the window, so the sniff does not see it - but NUL is legal UTF-8, so this still decodes.
    const result = decodeTextFile(bytes);
    expect(result.ok).toBe(true);
  });

  // UTF-16 is what Windows PowerShell writes by default, so a .log file walks straight into this.
  // Checked BEFORE the NUL sniff: UTF-16 ASCII is every other byte NUL, so the sniff would answer
  // "not text" about a file that is plainly text.
  it("refuses UTF-16 by its byte order mark rather than mangling it", () => {
    const le = Uint8Array.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    const be = Uint8Array.from([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
    expect(decodeTextFile(le)).toEqual({ ok: false, reason: "unsupported-encoding" });
    expect(decodeTextFile(be)).toEqual({ ok: false, reason: "unsupported-encoding" });
  });

  // The case that silently corrupted files: a byte sequence that is not valid UTF-8 decodes to
  // U+FFFD, and saving writes the replacement character over the original byte. Refusing is the
  // whole point - a file Trypthos cannot represent exactly is a file it must not open.
  it("refuses bytes that are not valid UTF-8 rather than substituting replacement characters", () => {
    const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    expect(decodeTextFile(latin1)).toEqual({ ok: false, reason: "unsupported-encoding" });
  });

  it("refuses a truncated multi-byte sequence", () => {
    const truncated = Uint8Array.from([0x61, 0xe6, 0x97]);
    expect(decodeTextFile(truncated)).toEqual({ ok: false, reason: "unsupported-encoding" });
  });
});

describe("encodeTextFile", () => {
  it("encodes as UTF-8 with no byte order mark", () => {
    expect(encodeTextFile("hi\n", { bom: false })).toEqual(utf8("hi\n"));
  });

  it("puts a byte order mark back when the file had one", () => {
    expect(encodeTextFile("hi\n", { bom: true })).toEqual(withUtf8Bom("hi\n"));
  });

  // The round trip is the property that matters: what was read is what is written back, byte for
  // byte, including the mark the editor never showed.
  it("round-trips a file with a byte order mark", () => {
    const original = withUtf8Bom("# Notes\n\nBody\n");
    const decoded = decodeTextFile(original);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(encodeTextFile(decoded.content, { bom: decoded.bom })).toEqual(original);
  });

  it("round-trips a file without one", () => {
    const original = utf8("# Notes\n\nBody\n");
    const decoded = decodeTextFile(original);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(encodeTextFile(decoded.content, { bom: decoded.bom })).toEqual(original);
  });
});

describe("hasUtf8Bom", () => {
  it("recognises the mark", () => {
    expect(hasUtf8Bom(withUtf8Bom("x"))).toBe(true);
  });

  it("is not fooled by a short file or a partial match", () => {
    expect(hasUtf8Bom(new Uint8Array())).toBe(false);
    expect(hasUtf8Bom(Uint8Array.from([0xef, 0xbb]))).toBe(false);
    expect(hasUtf8Bom(Uint8Array.from([0xef, 0xbb, 0xbe]))).toBe(false);
    expect(hasUtf8Bom(utf8("# Notes"))).toBe(false);
  });
});

describe("formatBytes", () => {
  it("counts small files in bytes", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(512)).toBe("512 bytes");
  });

  it("steps up a unit at a time", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
  });

  // One decimal, and no trailing ".0": a refusal names a size a person reads once, not a
  // measurement they act on.
  it("keeps one decimal where it says something", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(Math.round(411.5 * 1024 * 1024))).toBe("411.5 MB");
    expect(formatBytes(MAX_TEXT_FILE_BYTES)).toBe("16 MB");
  });
});

describe("the limits", () => {
  // Asserted rather than left implicit: the refusal message names this number, and the shell
  // enforces it. Three places, one constant.
  it("caps a readable file at 16 MB", () => {
    expect(MAX_TEXT_FILE_BYTES).toBe(16 * 1024 * 1024);
  });

  it("sniffs the leading 8 KB for binary content", () => {
    expect(BINARY_SNIFF_BYTES).toBe(8 * 1024);
  });
});
