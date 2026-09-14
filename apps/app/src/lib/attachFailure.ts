/// What to say when a file could not be added to the chat, as a catalogue key.
///
/// Its own keys rather than the editor's `failureKey`: those talk about opening and saving a file,
/// which is not what the user just asked for. Pure, like `failureKey`, so it is tested without
/// rendering, and the component translates at the edge.
export function attachFailureKey(reason: string): string {
  switch (reason) {
    case "too-large":
      return "chat.scope.attachFailed.tooLarge";
    // Two reasons, one sentence: from where the user stands both mean the file has no text chat can
    // read, and telling them apart is a job for the editor, which can show them the difference.
    case "not-text":
    case "unsupported-encoding":
      return "chat.scope.attachFailed.notText";
    case "not-found":
      return "chat.scope.attachFailed.notFound";
    default:
      return "chat.scope.attachFailed.unknown";
  }
}
