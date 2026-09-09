import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMarkdownImages } from "./useMarkdownImages";
import type { ImageResult } from "../lib/workspaceClient";


/// Pictures in rendered markdown.
///
/// An image's source is a path in the workspace, and the page it is drawn on is served from the
/// app's own origin - so nothing resolves it and the browser asks for a file that is not there.
/// These are read through the provider, which applies the workspace boundary guard and refuses
/// anything that is not a picture, and handed to the page as data.

type ReadImage = (path: string) => Promise<ImageResult>;

function fakeClient(
  readImage: ReadImage = async (path: string) => ({
    ok: true as const,
    dataUrl: `data:image/png;base64,${path}`,
  }),
) {
  return { readImage: vi.fn(readImage) };
}

describe("useMarkdownImages", () => {
  it("reads a picture written beside the document", async () => {
    const client = fakeClient();
    const { result } = renderHook(() =>
      useMarkdownImages(["orb.png"], "Notes/README.md", null, client.readImage),
    );

    await waitFor(() => expect(result.current["orb.png"]).toBeDefined());
    expect(client.readImage).toHaveBeenCalledWith("Notes/orb.png");
    expect(result.current["orb.png"]).toBe("data:image/png;base64,Notes/orb.png");
  });

  it("reads one in a folder below the document", async () => {
    const client = fakeClient();
    const { result } = renderHook(() =>
      useMarkdownImages(["docs/orb.png"], "Notes/README.md", null, client.readImage),
    );

    await waitFor(() => expect(result.current["docs/orb.png"]).toBeDefined());
    expect(client.readImage).toHaveBeenCalledWith("Notes/docs/orb.png");
  });

  // A badge is the common case in a README, and fetching it is the browser's business. Left alone
  // rather than resolved, so it keeps whatever the author wrote.
  it("leaves a web address alone", async () => {
    const client = fakeClient();
    const { result } = renderHook(() =>
      useMarkdownImages(["https://example.com/badge.svg"], "Notes/README.md", null, client.readImage),
    );

    await waitFor(() => expect(client.readImage).not.toHaveBeenCalled());
    expect(result.current["https://example.com/badge.svg"]).toBeUndefined();
  });

  // The boundary, which is the domain's to enforce - this must never ask the shell for it.
  it("does not ask for a picture outside the workspace", async () => {
    const client = fakeClient();
    renderHook(() =>
      useMarkdownImages(["../../secret.png"], "Notes/docs/README.md", null, client.readImage),
    );

    await waitFor(() => expect(client.readImage).not.toHaveBeenCalled());
  });

  // A source naming a document is not an image, and reading one as bytes to draw would be a request
  // the provider should never see.
  it("does not ask for a source that is not a picture", async () => {
    const client = fakeClient();
    renderHook(() => useMarkdownImages(["notes.md"], "Notes/README.md", null, client.readImage));

    await waitFor(() => expect(client.readImage).not.toHaveBeenCalled());
  });

  // A picture that cannot be read leaves the tag as the author wrote it. Better a broken image than
  // a wrong one, and there is nothing useful to say in an alt slot.
  it("leaves a picture that could not be read alone", async () => {
    const client = fakeClient(async () => ({ ok: false as const, reason: "too-large" }));
    const { result } = renderHook(() =>
      useMarkdownImages(["orb.png"], "Notes/README.md", null, client.readImage),
    );

    await waitFor(() => expect(client.readImage).toHaveBeenCalled());
    expect(result.current["orb.png"]).toBeUndefined();
  });

  // A README often uses the same picture twice, and a document being re-rendered must not re-read
  // every image in it.
  it("reads each picture once, however often it appears", async () => {
    const client = fakeClient();
    const { rerender } = renderHook(
      ({ sources }) => useMarkdownImages(sources, "Notes/README.md", null, client.readImage),
      { initialProps: { sources: ["orb.png", "orb.png", "logo.png"] } },
    );

    await waitFor(() => expect(client.readImage).toHaveBeenCalledTimes(2));

    rerender({ sources: ["orb.png", "logo.png"] });
    await waitFor(() => expect(client.readImage).toHaveBeenCalledTimes(2));
  });

  // A document that is in no workspace - the scratch buffer, the guide, a chat reply - has nothing
  // to resolve against.
  it("asks for nothing from a document that is in no workspace", async () => {
    const client = fakeClient();
    renderHook(() => useMarkdownImages(["orb.png"], null, null, client.readImage));

    await waitFor(() => expect(client.readImage).not.toHaveBeenCalled());
  });

  it("takes the workspace it is given when the document has none", async () => {
    const client = fakeClient();
    renderHook(() => useMarkdownImages(["/logo.png"], null, "Notes", client.readImage));

    await waitFor(() => expect(client.readImage).toHaveBeenCalledWith("Notes/logo.png"));
  });
});
