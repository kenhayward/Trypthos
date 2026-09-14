/// The drag type a file row in the folder browser carries: its qualified path.
///
/// A type of the app's own rather than `text/plain`, so the chat panel takes a file dragged from the
/// tree and nothing else. Plain text would also be dropped into the editor as text by CodeMirror,
/// and a path typed into somebody's document by a drag they meant for the chat is a surprise edit.
export const TREE_FILE_TYPE = "application/x-trypthos-file";
