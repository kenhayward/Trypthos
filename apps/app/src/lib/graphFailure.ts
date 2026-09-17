/// Which message a failure to draw the graph earns.
///
/// Sigma can refuse to come up for many reasons, and only some of them are about this computer:
/// an allocation it could not make, or a WebGL context it could not get. Everything else - a chunk
/// that would not load, a bad option, a reducer that threw - is a drawing failure with a cause this
/// code does not know, and telling the user their graph is too large sends them looking for a
/// problem in their vault that is not there.
///
/// So the message is chosen by what the error says, not by where it was caught. A failure that
/// names no limit gets the honest, smaller claim.
export type GraphFailureKind = "tooLarge" | "drawFailed";

/// What a browser says when it has run out of room: a typed array it could not size, a buffer it
/// could not allocate, or a GL context it could not create or keep.
const LIMIT_REACHED = /webgl|gl context|context lost|out of memory|allocation failed|array buffer|typed array/i;

export function graphFailureKind(error: unknown): GraphFailureKind {
  // A RangeError out of a renderer is an allocation that did not fit - v8 reports an over-sized
  // typed array exactly that way.
  if (error instanceof RangeError) return "tooLarge";
  const message = error instanceof Error ? error.message : String(error);
  return LIMIT_REACHED.test(message) ? "tooLarge" : "drawFailed";
}
