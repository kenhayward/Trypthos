import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MediaPlayer from "./MediaPlayer";

/// A recording, played rather than edited.
///
/// The control bar itself is Chromium's and is not worth asserting. What is worth asserting is
/// everything around it that would be wrong by default: a file that starts playing the moment a tab
/// opens, a gigabyte fetched to show a first frame, and a failure that draws a black rectangle and
/// explains nothing.

const VIDEO = {
  source: "tp-media://workspace/Notes%2Fclip.mp4",
  kind: "video" as const,
  name: "Notes/clip.mp4",
};

const AUDIO = {
  source: "tp-media://workspace/Notes%2Fsong.mp3",
  kind: "audio" as const,
  name: "Notes/song.mp3",
};

/// Puts a MediaError on the element and fires the event the browser would fire with it.
///
/// `error` is read-only on a real element, so it is defined rather than assigned - the component
/// reads it off the event target, which is exactly what happens in a window.
function failWith(element: HTMLMediaElement, code: number) {
  Object.defineProperty(element, "error", { value: { code }, configurable: true });
  fireEvent.error(element);
}

describe("MediaPlayer", () => {
  it("draws a video element for a video", () => {
    const { container } = render(<MediaPlayer {...VIDEO} />);
    const element = container.querySelector("video");
    expect(element).not.toBeNull();
    expect(element?.getAttribute("src")).toBe(VIDEO.source);
  });

  it("draws an audio element for a sound, and names the file beside it", () => {
    const { container } = render(<MediaPlayer {...AUDIO} />);
    expect(container.querySelector("audio")).not.toBeNull();
    // A sound has no picture to fill the panel, so without the name this is a control bar floating
    // in an empty rectangle with nothing saying what it plays.
    expect(screen.getByText("Notes/song.mp3")).toBeTruthy();
  });

  it("does not draw a video element for a sound", () => {
    const { container } = render(<MediaPlayer {...AUDIO} />);
    expect(container.querySelector("video")).toBeNull();
  });

  it("offers controls", () => {
    const { container } = render(<MediaPlayer {...VIDEO} />);
    expect(container.querySelector("video")?.hasAttribute("controls")).toBe(true);
    const audio = render(<MediaPlayer {...AUDIO} />);
    expect(audio.container.querySelector("audio")?.hasAttribute("controls")).toBe(true);
  });

  // Opening a tab must not start making noise, and must not pull a whole recording to show a first
  // frame.
  it("does not autoplay, and fetches only the metadata to begin with", () => {
    const { container } = render(<MediaPlayer {...VIDEO} />);
    const element = container.querySelector("video");
    expect(element?.hasAttribute("autoplay")).toBe(false);
    expect(element?.getAttribute("preload")).toBe("metadata");
  });

  it("names the file for assistive technology", () => {
    const { container } = render(<MediaPlayer {...VIDEO} />);
    expect(container.querySelector("video")?.getAttribute("aria-label")).toBe("Notes/clip.mp4");
  });

  // A Matroska file carrying VP9, or an MP4 carrying AC-3, opens and cannot be decoded. Saying so
  // is what makes including those containers defensible at all.
  it("says plainly when the file cannot be decoded", () => {
    const { container } = render(<MediaPlayer {...VIDEO} />);
    failWith(container.querySelector("video") as HTMLMediaElement, 4);
    expect(screen.getByText(/cannot play its video or audio coding/i)).toBeTruthy();
  });

  it("treats a decode failure as undecodable too", () => {
    const { container } = render(<MediaPlayer {...VIDEO} />);
    failWith(container.querySelector("video") as HTMLMediaElement, 3);
    expect(screen.getByText(/cannot play its video or audio coding/i)).toBeTruthy();
  });

  // Not the same message. "It could not be read" would send somebody looking for a missing file
  // when the file is right there and merely uses a coding this computer has no decoder for.
  it("separates a file it cannot read from one it cannot decode", () => {
    const { container } = render(<MediaPlayer {...VIDEO} />);
    failWith(container.querySelector("video") as HTMLMediaElement, 2);
    expect(screen.getByText(/could not be read/i)).toBeTruthy();
  });

  it("replaces the player with the message, rather than leaving a dead element", () => {
    const { container } = render(<MediaPlayer {...VIDEO} />);
    failWith(container.querySelector("video") as HTMLMediaElement, 4);
    expect(container.querySelector("video")).toBeNull();
  });

  it("reports a failure for a sound as well", () => {
    const { container } = render(<MediaPlayer {...AUDIO} />);
    failWith(container.querySelector("audio") as HTMLMediaElement, 4);
    expect(screen.getByText(/cannot play its video or audio coding/i)).toBeTruthy();
  });
});
