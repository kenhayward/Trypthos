import { describe, expect, it } from "vitest";
import { createSseDecoder } from "./sse";

/// The framing half of a streamed response, with no opinion about what the frames contain.
///
/// Separated from the chat-specific parsing because it is where the awkward cases live: a frame
/// arriving in pieces, a keep-alive comment, a provider that ends lines with CRLF. None of those are
/// about chat, and all of them are about whether a reply appears at all.

const decode = (chunks: string[]) => {
  const decoder = createSseDecoder();
  return chunks.flatMap((chunk) => decoder.push(chunk));
};

describe("createSseDecoder", () => {
  it("reads one complete frame", () => {
    expect(decode(['data: {"a":1}\n\n'])).toEqual(['{"a":1}']);
  });

  it("reads several frames from one chunk", () => {
    expect(decode(["data: one\n\ndata: two\n\n"])).toEqual(["one", "two"]);
  });

  // The case that matters most: a network read boundary falls wherever it likes, and a decoder that
  // assumed whole frames would drop the reply's first token roughly at random.
  it("waits for a frame split across chunks", () => {
    const decoder = createSseDecoder();
    expect(decoder.push("data: hel")).toEqual([]);
    expect(decoder.push("lo\n")).toEqual([]);
    expect(decoder.push("\n")).toEqual(["hello"]);
  });

  it("holds an incomplete trailing frame rather than emitting it early", () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data: {"a":1}\n\ndata: partial')).toEqual(['{"a":1}']);
  });

  it("accepts CRLF line endings", () => {
    expect(decode(["data: one\r\n\r\n"])).toEqual(["one"]);
  });

  it("accepts a data line with no space after the colon", () => {
    expect(decode(["data:tight\n\n"])).toEqual(["tight"]);
  });

  // Providers send these to keep a connection alive. Treated as data they would be parsed as JSON,
  // fail, and - depending on how that failure is handled - either log noise or kill the stream.
  it("ignores comment frames", () => {
    expect(decode([": keep-alive\n\n", "data: real\n\n"])).toEqual(["real"]);
  });

  it("ignores fields other than data", () => {
    expect(decode(["event: message\nid: 7\ndata: real\n\n"])).toEqual(["real"]);
  });

  // The spec joins multiple data lines with a newline. Rare from a chat endpoint, but a frame
  // carrying an error message with a line break in it would otherwise arrive truncated.
  it("joins several data lines in one frame", () => {
    expect(decode(["data: first\ndata: second\n\n"])).toEqual(["first\nsecond"]);
  });

  it("skips an empty frame rather than emitting an empty payload", () => {
    expect(decode(["\n\n", "data: real\n\n"])).toEqual(["real"]);
  });

  it("emits nothing for a stream that never sends anything", () => {
    expect(decode([""])).toEqual([]);
  });
});
