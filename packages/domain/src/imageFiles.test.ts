import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_TYPES, FILE_TYPES, fileTypeFor } from "./fileTypes";
import { IMAGE_TYPE_ID, imageMediaType, isImageName } from "./imageFiles";

/// Images, which are the first file type this app does not EDIT.
///
/// Everything else in the catalogue is text that goes into CodeMirror. An image is looked at, and
/// the whole reason it needs its own rules is that the read boundary refuses anything binary - which
/// is exactly right for a document and exactly wrong for a picture.
describe("image file types", () => {
  const openedAs = (name: string) => fileTypeFor(name, DEFAULT_FILE_TYPES)?.id ?? null;

  it("opens the formats a window can actually draw", () => {
    for (const name of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.bmp", "a.avif", "a.ico"]) {
      expect(openedAs(name)).toBe(IMAGE_TYPE_ID);
    }
  });

  // SVG is a picture AND a text file, and the catalogue cannot let two rows claim one extension.
  // It stays with XML, where it can be edited - which is the more useful of the two answers.
  it("leaves SVG where it is, as text", () => {
    expect(openedAs("logo.svg")).toBe("xml");
  });

  it("is its own kind, so nothing tries to edit it", () => {
    const type = FILE_TYPES.find((candidate) => candidate.id === IMAGE_TYPE_ID);
    expect(type?.kind).toBe("image");
  });

  // No Live, no Source, no Preview: there is nothing to switch between, and a header offering three
  // views of a photograph would be three buttons that do nothing.
  it("offers no view modes", () => {
    expect(FILE_TYPES.find((type) => type.id === IMAGE_TYPE_ID)?.modes).toEqual([]);
  });
});

describe("isImageName", () => {
  it("recognises an image by its name", () => {
    expect(isImageName("photo.PNG")).toBe(true);
    expect(isImageName("notes.md")).toBe(false);
    expect(isImageName("")).toBe(false);
  });
});

/// What the window is told the bytes are.
///
/// Decided from the NAME, in the main process, and never taken from anywhere else: a media type is
/// what a data URL tells a browser to do with the bytes that follow, so it is not a field to accept
/// from something untrusted.
describe("imageMediaType", () => {
  it("names the type for each format", () => {
    expect(imageMediaType("a.png")).toBe("image/png");
    expect(imageMediaType("a.jpg")).toBe("image/jpeg");
    expect(imageMediaType("a.jpeg")).toBe("image/jpeg");
    expect(imageMediaType("a.gif")).toBe("image/gif");
    expect(imageMediaType("a.webp")).toBe("image/webp");
    expect(imageMediaType("a.bmp")).toBe("image/bmp");
    expect(imageMediaType("a.avif")).toBe("image/avif");
    expect(imageMediaType("a.ico")).toBe("image/x-icon");
  });

  it("ignores the case the name was written in", () => {
    expect(imageMediaType("PHOTO.JPG")).toBe("image/jpeg");
  });

  // Null rather than a guess: a data URL saying the wrong thing about its bytes is a data URL
  // telling the browser to treat one kind of file as another.
  it("has no answer for anything that is not an image", () => {
    expect(imageMediaType("notes.md")).toBeNull();
    expect(imageMediaType("noextension")).toBeNull();
  });

  // Every format the catalogue lists has to have one, or opening it produces a URL nothing can draw.
  it("answers for every extension the image type claims", () => {
    const type = FILE_TYPES.find((candidate) => candidate.id === IMAGE_TYPE_ID);
    for (const extension of type?.extensions ?? []) {
      expect(imageMediaType(`a.${extension}`)).not.toBeNull();
    }
  });
});
