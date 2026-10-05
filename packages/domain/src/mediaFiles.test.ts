import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_TYPES, FILE_TYPES, fileTypeFor } from "./fileTypes";
import { AUDIO_TYPE_ID, VIDEO_TYPE_ID, isMediaName, mediaKindFor, mediaTypeFor } from "./mediaFiles";

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
