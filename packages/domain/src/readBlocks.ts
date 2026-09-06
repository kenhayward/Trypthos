/// Asking for a file without provider tool calling.
///
/// The folder outline is a menu, and a menu you cannot order from is a list of names. Where the
/// model's endpoint supports tool calling it orders with `get_file_contents`; where it does not, it
/// writes a fenced block and the app carries it out - the same reasoning that made the edit
/// transport fenced, which is that the fenced one works everywhere.
///
/// **This is a request, never an instruction.** What may be read is decided by the outline, in the
/// main process, exactly as it is for the tool. The block only says which of those files is wanted;
/// a path that was not offered is refused there, and this module's job ends at reading the path out
/// of the text.

export const READ_FENCE_TAG = "trypthos-read";

/// A closed block whose info string is exactly the tag.
///
/// Three backticks only. The edit format uses four to nest a fence inside its content, so matching
/// them here would let a read be found INSIDE an edit block - carrying out something the user was
/// meant to approve first.
const READ_BLOCK = new RegExp(
  String.raw`(?:^|\n)\x60{3}` + READ_FENCE_TAG + String.raw`[^\S\n]*\n([\s\S]*?)\n?\x60{3}(?=\n|$)`,
);

/// A four-backtick fenced region, which is how the edit format nests a fence inside its content.
///
/// Removed before the search below, because a read block written INSIDE an edit block is part of
/// the content the user is being asked to approve - not a request to carry out now. Matching it
/// would read a file on the strength of text the model put in a document.
const NESTING_FENCE = new RegExp(String.raw`(?:^|\n)\x60{4}[^\n]*\n[\s\S]*?\n\x60{4}(?=\n|$)`, "g");

/// A workspace-relative path: one line, no spaces, nothing else.
///
/// Strict on purpose. A model that writes a sentence has not made a request this can act on, and
/// guessing which word in it is the path is how a chat reads a file nobody asked for.
const PATH_ONLY = /^[^\s]+$/;

/// The first file the reply asks for, or null.
///
/// The FIRST, so a model that asks for three gets them one round at a time - which is what makes
/// the per-turn cap mean anything.
///
/// Null for a block that has not closed yet: a request that is still arriving is not a request, and
/// acting on one would read whatever partial path had streamed so far.
export function readRequestIn(reply: string): string | null {
  const match = READ_BLOCK.exec(reply.replace(NESTING_FENCE, ""));
  if (match === null) return null;

  const body = (match[1] ?? "").trim();
  return PATH_ONLY.test(body) ? body : null;
}
