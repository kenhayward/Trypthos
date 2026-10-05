import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_TYPES, FILE_TYPES, fileTypeFor } from "./fileTypes";
import {
  AUDIO_TYPE_ID,
  VIDEO_TYPE_ID,
  isMediaName,
  mediaKindFor,
  mediaPathFromUrl,
  mediaTypeFor,
  mediaUrl,
} from "./mediaFiles";

/// What this app will play, measured rather than assumed.
///
/// Every type here answered "probably" to `canPlayType` in Electron 44.1.0 (Chromium 152). The
/// absences are measured too: Theora was removed from Chromium in 2024, and there is no demuxer for
/// AVI, WMV, MPEG or FLV. A row for one of those would open a file and then fail to play it.
describe("video files", () => {
  const openedAs = (name: string) => fileTypeFor(name, DEFAULT_FILE_TYPES)?.id ?? null;

  it("opens the containers the engine can demux", () => {
    for (const name of ["a.mp4", "a.m4v", "a.mov", "a.webm", "a.mkv", "a.3gp"]) {
      expect(openedAs(name)).toBe(VIDEO_TYPE_ID);
    }
  });

  it("leaves out the containers the engine cannot demux", () => {
    for (const name of ["a.ogv", "a.avi", "a.wmv", "a.mpg", "a.mpeg", "a.flv"]) {
      expect(openedAs(name)).toBe(null);
    }
  });

  // `video/quicktime` is refused outright, even with an explicit H.264 codec string. MOV and MP4
  // are both ISO base media format, so the MP4 demuxer reads both - and declaring `video/mp4` is
  // the only way a `.mov` plays at all. Recorded here because it is a deliberate exception to the
  // rule that a media type is read from the name and never substituted.
  it("declares a QuickTime file as mp4, because quicktime is refused", () => {
    expect(mediaTypeFor("clip.mov")).toBe("video/mp4");
  });

  it("is its own kind, so nothing tries to edit it", () => {
    expect(FILE_TYPES.find((type) => type.id === VIDEO_TYPE_ID)?.kind).toBe("video");
  });

  it("offers no view modes", () => {
    expect(FILE_TYPES.find((type) => type.id === VIDEO_TYPE_ID)?.modes).toEqual([]);
  });
});

describe("audio files", () => {
  const openedAs = (name: string) => fileTypeFor(name, DEFAULT_FILE_TYPES)?.id ?? null;

  it("opens the formats the engine can decode", () => {
    for (const name of ["a.mp3", "a.m4a", "a.aac", "a.wav", "a.flac", "a.ogg", "a.oga", "a.opus", "a.weba"]) {
      expect(openedAs(name)).toBe(AUDIO_TYPE_ID);
    }
  });

  it("leaves out the formats the engine cannot decode", () => {
    for (const name of ["a.wma", "a.aiff"]) expect(openedAs(name)).toBe(null);
  });

  // `audio/x-flac` is refused and `audio/flac` is not. One prefix, and the difference between a
  // file that plays and one that does not.
  it("declares FLAC as audio/flac, never audio/x-flac", () => {
    expect(mediaTypeFor("song.flac")).toBe("audio/flac");
  });
});

describe("mediaKindFor", () => {
  it("separates the two kinds", () => {
    expect(mediaKindFor("clip.MP4")).toBe("video");
    expect(mediaKindFor("song.Mp3")).toBe("audio");
  });

  it("claims nothing that is not media", () => {
    for (const name of ["notes.md", "photo.png", "a.ts", "noextension", ".gitignore"]) {
      expect(mediaKindFor(name)).toBe(null);
      expect(isMediaName(name)).toBe(false);
    }
  });

  it("answers null rather than guessing a type it does not know", () => {
    expect(mediaTypeFor("movie.rmvb")).toBe(null);
  });
});

describe("the media URL", () => {
  it("round-trips an ordinary path", () => {
    const qualified = "Notes/recordings/standup.mp4";
    expect(mediaPathFromUrl(mediaUrl(qualified))).toBe(qualified);
  });

  // A workspace id is a folder's name, so it can hold spaces, accents and anything else a disk
  // allows. Encoding the whole qualified path as ONE segment is what stops a slash in it becoming
  // a path of its own, and a `#` or `?` from being read as a fragment or a query.
  it("round-trips a path with characters a URL cares about", () => {
    for (const qualified of [
      "Ada's Notes/a b/clip.mp4",
      "Grace/100% done/clip.mp4",
      "Alice/café/sound.mp3",
      "Notes/a#b/clip.mp4",
      "Notes/a?b/clip.mp4",
      "Notes/a&b=c/clip.mp4",
    ]) {
      expect(mediaPathFromUrl(mediaUrl(qualified))).toBe(qualified);
    }
  });

  it("uses a fixed host, because a hostname cannot carry a workspace name", () => {
    expect(mediaUrl("Notes/clip.mp4").startsWith("tp-media://workspace/")).toBe(true);
  });

  it("refuses a URL of another scheme or another host", () => {
    expect(mediaPathFromUrl("https://workspace/Notes%2Fclip.mp4")).toBe(null);
    expect(mediaPathFromUrl("tp-media://elsewhere/Notes%2Fclip.mp4")).toBe(null);
  });

  it("refuses a URL with more than one segment, so no path can be built out of parts", () => {
    expect(mediaPathFromUrl("tp-media://workspace/Notes/clip.mp4")).toBe(null);
  });

  it("refuses an empty path and malformed encoding rather than throwing", () => {
    expect(mediaPathFromUrl("tp-media://workspace/")).toBe(null);
    expect(mediaPathFromUrl("tp-media://workspace/%E0%A4%A")).toBe(null);
    expect(mediaPathFromUrl("not a url at all")).toBe(null);
    expect(mediaPathFromUrl("")).toBe(null);
  });
});
