/// Server-sent events, framing only.
///
/// A streamed chat reply arrives as SSE, and the read boundaries are wherever the network puts them:
/// a frame can arrive in three pieces, or three frames can arrive at once. This buffers until a frame
/// is complete and hands back the `data` payloads, with no opinion about what they contain - the
/// chat-specific parsing is separate, because the awkward cases here (a split frame, a keep-alive
/// comment, CRLF endings) are not about chat at all.
///
/// In the domain because it is pure, and because it is the kind of code that is only ever wrong in
/// the cases nobody produces by hand.

export interface SseDecoder {
  /// Feeds a chunk of text and returns whatever complete frames it finished.
  push(chunk: string): string[];
}

export function createSseDecoder(): SseDecoder {
  /// Everything received but not yet terminated by a blank line.
  let buffer = "";

  return {
    push(chunk: string): string[] {
      // Normalised so one search finds a frame boundary. A provider that ends lines with CRLF is
      // otherwise never seen to finish a frame at all, and the reply never appears.
      buffer += chunk.replace(/\r\n/g, "\n");

      const payloads: string[] = [];
      let separator = buffer.indexOf("\n\n");

      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");

        const data: string[] = [];
        for (const line of frame.split("\n")) {
          // A line beginning with a colon is a comment - providers send them to hold the connection
          // open. Parsed as data it would fail as JSON on every keep-alive.
          if (line.startsWith(":")) continue;
          if (!line.startsWith("data:")) continue;
          // The single optional space after the colon is part of the framing, not the payload.
          data.push(line.slice("data:".length).replace(/^ /, ""));
        }

        // The spec joins multiple data lines with a newline. Rare from a chat endpoint, but an error
        // message containing a line break would otherwise arrive truncated.
        if (data.length > 0) payloads.push(data.join("\n"));
      }

      return payloads;
    },
  };
}
