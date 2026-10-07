import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_TYPES, FILE_TYPES, fileTypeFor } from "./fileTypes";
import { PDF_TYPE_ID, isPdfName, pdfMediaTypeFor } from "./pdfFiles";

/// PDFs, which are the file type this app cannot draw without help.
///
/// A picture is drawn by the window; a PDF is drawn by an engine. What is decided here is the app's
/// reach - the name, the route, the refusal - and none of it depends on the engine, which is why
/// these tests can be exact while the engine's version is a measurement for the PR body.
describe("pdf file types", () => {
  const openedAs = (name: string) => fileTypeFor(name, DEFAULT_FILE_TYPES)?.id ?? null;

  it("opens a pdf by its name", () => {
    expect(openedAs("report.pdf")).toBe(PDF_TYPE_ID);
  });

  it("ignores the case the name was written in", () => {
    expect(openedAs("REPORT.PDF")).toBe(PDF_TYPE_ID);
  });

  // The catalogue cannot let two rows claim one extension, and `.pdf` has never had another owner.
  it("takes nothing else's name", () => {
    expect(openedAs("notes.md")).toBe("markdown");
    expect(openedAs("photo.png")).toBe("image");
    expect(openedAs("clip.mp4")).toBe("video");
  });

  it("is its own kind, so nothing tries to edit it", () => {
    const type = FILE_TYPES.find((candidate) => candidate.id === PDF_TYPE_ID);
    expect(type?.kind).toBe("pdf");
  });

  // No Live, no Source, no Preview: there is nothing to switch between, and a header offering three
  // views of a document an engine draws would be three buttons that do nothing.
  it("offers no view modes", () => {
    expect(FILE_TYPES.find((type) => type.id === PDF_TYPE_ID)?.modes).toEqual([]);
  });
});

describe("isPdfName", () => {
  it("recognises a pdf by its name", () => {
    expect(isPdfName("report.PDF")).toBe(true);
    expect(isPdfName("notes.md")).toBe(false);
    expect(isPdfName("")).toBe(false);
  });
});

/// What the main process tells the window the bytes are.
///
/// Decided from the NAME, in the main process, and never taken from anywhere else: a media type is
/// what a protocol tells a browser to do with the bytes that follow, so it is not a field to accept
/// from something untrusted.
describe("pdfMediaTypeFor", () => {
  it("names the type for the format", () => {
    expect(pdfMediaTypeFor("report.pdf")).toBe("application/pdf");
  });

  it("ignores the case the name was written in", () => {
    expect(pdfMediaTypeFor("REPORT.PDF")).toBe("application/pdf");
  });

  // Null rather than a guess: a declared type saying the wrong thing about its bytes is a protocol
  // telling the engine to read one kind of file as another.
  it("has no answer for anything that is not a pdf", () => {
    expect(pdfMediaTypeFor("notes.md")).toBeNull();
    expect(pdfMediaTypeFor("noextension")).toBeNull();
  });

  // Every format the catalogue lists has to have one, or opening it produces a URL nothing can draw.
  it("answers for every extension the pdf type claims", () => {
    const type = FILE_TYPES.find((candidate) => candidate.id === PDF_TYPE_ID);
    for (const extension of type?.extensions ?? []) {
      expect(pdfMediaTypeFor(`a.${extension}`)).not.toBeNull();
    }
  });
});
